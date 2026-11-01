import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

const source = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fixture(name: string) {
  const root = mkdtempSync(join(tmpdir(), "kit-release-version-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "bin"));
  mkdirSync(join(root, ".claude/cache"), { recursive: true });
  for (const file of ["check-release-consumers.sh", "check-runtime.sh"]) {
    copyFileSync(join(source, "scripts", file), join(root, "scripts", file));
  }
  writeFileSync(join(root, ".gitignore"), ".claude/\n");
  writeFileSync(join(root, "bin/uptime"), '#!/bin/sh\necho "load average: 1.00, 0.00, 0.00"\n', {
    mode: 0o755,
  });
  writeFileSync(join(root, "bin/docker"), '#!/bin/sh\nprintf "%s\\n" "$@" > "$CAPTURE"\n', {
    mode: 0o755,
  });
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
  const run = () =>
    execFileSync(
      "bash",
      [
        join(root, "scripts/check-release-consumers.sh"),
        artifact,
        hash,
        revision,
        root,
        revision,
        root,
        revision,
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          CAPTURE: capture,
          GAME_KIT_DOG_CACHE: join(root, ".claude/cache"),
          GAME_KIT_DUCK_CACHE: join(root, ".claude/cache"),
          PATH: `${root}/bin:${process.env.PATH}`,
        },
        stdio: "pipe",
      },
    );
  return { capture, revision, run };
}

it("passes the version from the pinned source rather than current HEAD or artifact", () => {
  const { capture, revision, run } = fixture("@andornaut/game-kit");
  run();
  expect(readFileSync(capture, "utf8").trim().split("\n").slice(-4)).toEqual([
    revision,
    "0.1.0",
    revision,
    revision,
  ]);
});

it("rejects a source revision belonging to another package before launching Docker", () => {
  const { run } = fixture("another-package");
  expect(run).toThrow(/Source revision is not @andornaut\/game-kit/);
});
