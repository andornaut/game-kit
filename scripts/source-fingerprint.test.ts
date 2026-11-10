import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import { sourceFingerprint } from "./source-fingerprint.ts";

const scripts = dirname(fileURLToPath(import.meta.url));

/** Run check.ts in a checkout whose git lists through `listing` and whose Docker always fails. */
function checkWithFakes(name: string, listing: string) {
  const root = mkdtempSync(join(tmpdir(), "kit-fingerprint-"));
  mkdirSync(join(root, "scripts"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  for (const file of ["check.ts", "pack.ts", "runtime.ts", "source-fingerprint.ts"]) {
    copyFileSync(join(scripts, file), join(root, "scripts", file));
  }
  writeFileSync(join(root, ".nvmrc"), "24.21.0\n");
  // An empty synthetic credential-shaped file, never real credential material.
  mkdirSync(dirname(join(root, name)), { recursive: true });
  writeFileSync(join(root, name), "");
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
  return { result, root: realpathSync(root) };
}

it.each([".env", ".env.fixture", ".ssh/key", ".private/key"])(
  "refuses %s before starting the verification containers",
  (name) => {
    const { result } = checkWithFakes(name, `printf '${name}\\0'`);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Refusing credential path");
    expect(result.stderr).not.toContain("container started");
  },
);

it("reports an unreadable listing before starting the verification containers", () => {
  const { result, root } = checkWithFakes("file", "exit 42");
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(`Cannot read source fingerprint of ${root}: Command failed: git`);
  expect(result.stderr).not.toContain("container started");
});

it("reports both the fingerprint cause and the gate failure after a failed gate", () => {
  // The listing before the gate succeeds; the listing after it fails.
  const { result, root } = checkWithFakes(
    "file",
    'if [ -e "$0.listed" ]; then exit 42; fi; touch "$0.listed"',
  );
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("container started");
  expect(result.stderr).toContain(
    `Cannot verify source fingerprints: Cannot read source fingerprint of ${root}: Command failed: git`,
  );
  expect(result.stderr).toContain("The gate also failed: docker create exited with status 99.");
  expect(result.stderr).toContain("Discard the gate result.");
});

function repository() {
  const root = mkdtempSync(join(tmpdir(), "kit-fingerprint-digest-"));
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args]);
  git("init", "--quiet");
  writeFileSync(join(root, "b.txt"), "tracked");
  writeFileSync(join(root, "clean.txt"), "clean, so not hashed");
  writeFileSync(join(root, "gone.txt"), "deleted later");
  git("add", ".");
  git(
    ...["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid"],
    ...["-c", "core.hooksPath=/dev/null", "commit", "--quiet", "--no-verify", "-m", "Fixture"],
  );
  writeFileSync(join(root, "b.txt"), "edited");
  rmSync(join(root, "gone.txt"));
  symlinkSync("b.txt", join(root, "a-link"));
  writeFileSync(join(root, "c.txt"), "untracked");
  return { git, root };
}

it("hashes the root, HEAD, status and each dirty path's bytes, link target or absence", () => {
  const { git, root } = repository();
  const status = git("status", "--porcelain=v1", "--untracked-files=all", "-z");
  expect(status.toString()).toBe(" M b.txt\0 D gone.txt\0?? a-link\0?? c.txt\0");
  const expected = createHash("sha256")
    .update(`${root}\0`)
    .update(git("rev-parse", "HEAD"))
    .update(status)
    .update("b.txt\0edited")
    .update("gone.txt\0missing\0")
    .update("a-link\0b.txt")
    .update("c.txt\0untracked")
    .digest("hex");
  expect(sourceFingerprint([root])).toBe(expected);
});

it.each<[string, (root: string) => void]>([
  ["a dirty file's bytes", (root) => writeFileSync(join(root, "b.txt"), "edited again")],
  ["an untracked file's bytes", (root) => writeFileSync(join(root, "c.txt"), "changed")],
  [
    "an untracked link's target",
    (root) => {
      rmSync(join(root, "a-link"));
      symlinkSync("c.txt", join(root, "a-link"));
    },
  ],
  ["the status", (root) => writeFileSync(join(root, "d.txt"), "")],
])("changes with %s", (_, change) => {
  const { root } = repository();
  const before = sourceFingerprint([root]);
  change(root);
  expect(sourceFingerprint([root])).not.toBe(before);
});

it("covers every root in order", () => {
  const { root: first } = repository();
  const { root: second } = repository();
  const fingerprints = [[first], [second], [first, second], [second, first]].map((roots) =>
    sourceFingerprint(roots),
  );
  expect(new Set(fingerprints).size).toBe(fingerprints.length);
});
