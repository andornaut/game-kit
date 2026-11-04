import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import {
  adoptArtifact,
  callerTest,
  unsafeArchiveModes,
  unsafeArchivePaths,
} from "./release-consumer-job.ts";

const source = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fixture(name: string) {
  const root = mkdtempSync(join(tmpdir(), "kit-release-version-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "bin"));
  mkdirSync(join(root, ".claude/cache"), { recursive: true });
  for (const file of [
    "check-release-consumers.ts",
    "pack.ts",
    "runtime.ts",
    "source-fingerprint.ts",
  ]) {
    copyFileSync(join(source, "scripts", file), join(root, "scripts", file));
  }
  writeFileSync(join(root, ".nvmrc"), "24.21.0\n");
  writeFileSync(join(root, ".gitignore"), ".claude/\nbin/\n");
  // Record only the job container's arguments; every other Docker command succeeds silently.
  writeFileSync(
    join(root, "bin/docker"),
    '#!/bin/sh\nif [ "$1" = create ]; then printf "%s\\n" "$@" > "$CAPTURE"; echo fixture; fi\n',
    { mode: 0o755 },
  );
  git("init", "--quiet");
  git("config", "user.name", "Release fixture");
  git("config", "user.email", "release@example.invalid");
  writeFileSync(join(root, "package.json"), JSON.stringify({ name, version: "0.1.0" }));
  git("add", ".");
  git("-c", "core.hooksPath=/dev/null", "commit", "--quiet", "--no-verify", "-m", "Fixture source");
  const revision = git("rev-parse", "HEAD");
  writeFileSync(join(root, "package.json"), JSON.stringify({ name, version: "0.3.0" }));
  git("add", "package.json");
  git("-c", "core.hooksPath=/dev/null", "commit", "--quiet", "--no-verify", "-m", "Fixture head");
  const artifact = join(root, ".claude/release.tgz");
  writeFileSync(artifact, "opaque artifact, not a trusted version source");
  const hash = createHash("sha256").update(readFileSync(artifact)).digest("hex");
  const capture = join(root, ".claude/captured");
  const run = (args = [artifact, hash, revision, root, revision, root, revision]) =>
    spawnSync(process.execPath, [join(root, "scripts/check-release-consumers.ts"), ...args], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        CAPTURE: capture,
        GAME_KIT_DOG_CACHE: join(root, ".claude/cache"),
        GAME_KIT_DUCK_CACHE: join(root, ".claude/cache"),
        // The fake Docker runs nothing heavy, so the result must not depend on host load.
        GAME_KIT_LOAD: "0",
        PATH: `${root}/bin:${process.env.PATH}`,
      },
    });
  return { capture, revision, root, run };
}

it("passes the version from the pinned source rather than current HEAD or artifact", () => {
  const { capture, revision, root, run } = fixture("@andornaut/game-kit");
  expect(run().status).toBe(0);
  const args = readFileSync(capture, "utf8").trim().split("\n");
  expect(args.slice(-4)).toEqual([revision, "0.1.0", revision, revision]);
  expect(args).toContain("--network");
  expect(
    args.filter((arg) => arg.startsWith("type=bind")).every((arg) => arg.endsWith(",readonly")),
  ).toBe(true);
  const [evidence] = readdirSync(join(root, ".claude")).filter((name) =>
    name.startsWith("release-consumers."),
  );
  expect(readFileSync(join(root, ".claude", String(evidence), "RESULT"), "utf8")).toBe("PASS\n");
});

it("rejects a source revision belonging to another package before launching Docker", () => {
  const { capture, run } = fixture("another-package");
  const result = run();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Source revision is not @andornaut/game-kit");
  expect(() => readFileSync(capture)).toThrow();
});

it("validates argument count and checksum shape", () => {
  const { revision, root, run } = fixture("@andornaut/game-kit");
  expect(run([]).status).toBe(2);
  const artifact = join(root, ".claude/release.tgz");
  const result = run([artifact, "ABC", revision, root, revision, root, revision]);
  expect(result.status).toBe(2);
  expect(result.stderr).toContain("64 lowercase hex digits");
});

it.each([
  [
    "current traversal callers",
    ["src/rules/behaviourTraversalGoals.test.ts", "src/view/mapMarks.test.ts"],
    "src/rules/behaviourTraversalGoals.test.ts",
  ],
  ["older renderer callers", ["src/view/mapMarks.test.ts"], "src/view/mapMarks.test.ts"],
  ["missing caller coverage", [], undefined],
] as const)("selects a real test or fails for %s", (_, paths, expected) => {
  const root = mkdtempSync(join(tmpdir(), "kit-consumer-test-selection-"));
  for (const path of paths) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), "");
  }
  if (expected === undefined) {
    expect(() => callerTest("duck", root)).toThrow(/No supported Chibi caller test exists/);
  } else {
    expect(callerTest("duck", root)).toBe(expected);
  }
});

it("refuses archive members outside package/ or with parent segments", () => {
  const listing = ["package/", "package/a.js", "other/b.js", "package/../c", "package/x/.."];
  expect(unsafeArchivePaths(`${listing.join("\n")}\n`)).toEqual(listing.slice(2));
});

it("refuses archive links and special files", () => {
  const modes = ["drwxr-xr-x 0/0 0 package/", "-rw-r--r-- 0/0 1 package/a", "lrwxrwxrwx 0/0 0 x"];
  expect(unsafeArchiveModes(modes.join("\n"))).toEqual([modes[2]]);
});

it("adapts only the declared kit dependency to the exact tarball", () => {
  const root = mkdtempSync(join(tmpdir(), "kit-consumer-manifest-"));
  const manifest = { dependencies: { "@andornaut/game-kit": "1.0.0", other: "2.0.0" }, name: "x" };
  writeFileSync(join(root, "package.json"), JSON.stringify(manifest));
  adoptArtifact("/assets/release.tgz", root);
  expect(JSON.parse(readFileSync(join(root, "package.json"), "utf8"))).toEqual({
    ...manifest,
    dependencies: { "@andornaut/game-kit": "file:/assets/release.tgz", other: "2.0.0" },
  });
  writeFileSync(join(root, "package.json"), "{}");
  expect(() => adoptArtifact("/assets/release.tgz", root)).toThrow(/must declare game-kit/);
});
