import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import { packageSource, sourceCommit } from "./package-source.ts";
import { git } from "./runtime.ts";

const revision = "a".repeat(40);
const source = { SOURCE_COMMIT: revision, SOURCE_DATE_EPOCH: "1700000000" };

it("returns the full source commit", () => {
  expect(sourceCommit(source)).toBe(revision);
});

it.each([{ SOURCE_COMMIT: "short" }, { SOURCE_COMMIT: "" }, { SOURCE_DATE_EPOCH: "" }])(
  "rejects missing or malformed source identity %o",
  (override) => {
    expect(() => sourceCommit({ ...source, ...override })).toThrow();
  },
);

it("packages the committed source and refuses dirty or mismatched checkout provenance", () => {
  const root = mkdtempSync(join(tmpdir(), "release-source-test-"));
  const output = join(root, "release");
  mkdirSync(join(root, "scripts"));
  writeFileSync(join(root, ".gitignore"), "release/\n");
  writeFileSync(join(root, ".nvmrc"), "v24.21.0\n");
  writeFileSync(join(root, "fixture.txt"), "Pinned input\n");
  writeFileSync(
    join(root, "scripts/release-build.ts"),
    [
      'import { copyFileSync, writeFileSync } from "node:fs";',
      'import { join } from "node:path";',
      'copyFileSync("fixture.txt", join(process.argv[2], "fixture.txt"));',
      'writeFileSync(join(process.argv[2], "package.json"),',
      '  JSON.stringify({name: "game-kit-fixture", version: "0.1.0"}));',
    ].join("\n"),
  );
  git(root, "init", "--quiet");
  git(root, "add", ".");
  git(
    root,
    "-c",
    "user.email=fixture@example.invalid",
    "-c",
    "user.name=Release fixture",
    "commit",
    "--no-verify",
    "--quiet",
    "-m",
    "Pinned release",
  );
  const env = {
    ...process.env,
    SOURCE_COMMIT: git(root, "rev-parse", "HEAD"),
    SOURCE_DATE_EPOCH: git(root, "show", "-s", "--format=%ct", "HEAD"),
  };
  expect(() => packageSource({ ...env, SOURCE_COMMIT: revision }, root, output)).toThrow(/HEAD/);
  expect(() => packageSource({ ...env, SOURCE_DATE_EPOCH: "0" }, root, output)).toThrow(
    /timestamp/,
  );
  writeFileSync(join(root, "fixture.txt"), "Dirty input\n");
  expect(() => packageSource(env, root, output)).toThrow(/clean checkout/);
  expect(existsSync(output)).toBe(false);
  git(root, "restore", "fixture.txt");
  const artifact = packageSource(env, root, output);
  const extract = (file: string) =>
    execFileSync("tar", ["-xOf", artifact, `package/${file}`], { encoding: "utf8" });
  expect(extract("fixture.txt")).toBe("Pinned input\n");
  expect(extract("SOURCE_COMMIT")).toBe(`${env.SOURCE_COMMIT}\n`);
});
