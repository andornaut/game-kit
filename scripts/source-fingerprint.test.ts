import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import { sourceFingerprint } from "./source-fingerprint.ts";

const scripts = dirname(fileURLToPath(import.meta.url));

it.each([".env", ".env.fixture", ".ssh/key", ".private/key", "git-failure"])(
  "refuses %s before starting the verification containers",
  (name) => {
    const root = mkdtempSync(join(tmpdir(), "kit-fingerprint-"));
    mkdirSync(join(root, "scripts"));
    const bin = join(root, "bin");
    mkdirSync(bin);
    for (const file of ["check.ts", "runtime.ts", "source-fingerprint.ts"]) {
      copyFileSync(join(scripts, file), join(root, "scripts", file));
    }
    writeFileSync(join(root, ".nvmrc"), "24.21.0\n");
    // An empty synthetic credential-shaped file, never real credential material.
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), "");
    const listing = name === "git-failure" ? "exit 42" : `printf '${name}\\0'`;
    writeFileSync(
      join(bin, "git"),
      [
        "#!/bin/sh",
        'if [ "$1" = -C ]; then shift 2; fi',
        `case "$1" in rev-parse) echo fixture;; status) :;; ls-files) ${listing};; esac`,
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    writeFileSync(join(bin, "docker"), '#!/bin/sh\necho "container started" >&2\nexit 99\n', {
      mode: 0o755,
    });
    const result = spawnSync(process.execPath, [join(root, "scripts/check.ts")], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      name === "git-failure" ? "Cannot read source fingerprint" : "Refusing credential path",
    );
    expect(result.stderr).not.toContain("container started");
  },
);

it("hashes HEAD, status and each sorted path's bytes, link target or absence", () => {
  const root = mkdtempSync(join(tmpdir(), "kit-fingerprint-digest-"));
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args]);
  git("init", "--quiet");
  writeFileSync(join(root, "b.txt"), "tracked");
  writeFileSync(join(root, "gone.txt"), "deleted later");
  git("add", ".");
  git(
    ...["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid"],
    ...["-c", "core.hooksPath=/dev/null", "commit", "--quiet", "--no-verify", "-m", "Fixture"],
  );
  rmSync(join(root, "gone.txt"));
  symlinkSync("b.txt", join(root, "a-link"));
  writeFileSync(join(root, "c.txt"), "untracked");
  const expected = createHash("sha256")
    .update(git("rev-parse", "HEAD"))
    .update(git("status", "--porcelain=v1", "--untracked-files=all", "-z"))
    .update("a-link\0b.txt")
    .update("b.txt\0tracked")
    .update("c.txt\0untracked")
    .update("gone.txt\0missing\0")
    .digest("hex");
  expect(sourceFingerprint(root)).toBe(expected);
});
