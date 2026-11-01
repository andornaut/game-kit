import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const script = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "sync-into.sh"));

it("syncs committed root payloads, removes obsolete files and checks older nested revisions", () => {
  const scratch = mkdtempSync(join(tmpdir(), "kit-sync-"));
  const repo = join(scratch, "repo");
  const game = join(scratch, "game");
  mkdirSync(join(repo, "scripts"), { recursive: true });
  mkdirSync(game);
  writeFileSync(join(repo, "scripts/sync-into.sh"), script);
  writeFileSync(
    join(repo, "scripts/package-payload.sh"),
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "package-payload.sh")),
  );
  writeFileSync(
    join(repo, "scripts/vendor-manifest.mjs"),
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "vendor-manifest.mjs")),
  );
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  for (const base of ["kit/", ""]) {
    mkdirSync(join(repo, base, "src"), { recursive: true });
    for (const [file, content] of Object.entries({
      "package.json":
        '{"name":"@andornaut/game-kit","devDependencies":{"unused":"1"},"scripts":{"test":"private"}}\n',
      "README.md": "# Package\n",
      LICENSE: "MIT\n",
      "src/value.ts": "export const value = 1;\n",
    }))
      writeFileSync(join(repo, base, file), content);
    git("add", ".");
    git("-c", "core.hooksPath=/dev/null", "commit", "-qm", "Fixture");
    if (base) {
      const legacy = git("rev-parse", "HEAD");
      execFileSync("bash", [join(repo, "scripts/sync-into.sh"), game]);
      expect(readFileSync(join(game, "vendor/game-kit/KIT_COMMIT"), "utf8").trim()).toBe(legacy);
      git("rm", "-qr", "kit");
    }
  }
  execFileSync("bash", [join(repo, "scripts/sync-into.sh"), "--check", game]);
  writeFileSync(join(game, "vendor/game-kit/obsolete.ts"), "old");
  execFileSync("bash", [join(repo, "scripts/sync-into.sh"), game]);
  execFileSync("bash", [join(repo, "scripts/sync-into.sh"), "--check", game]);
  expect(readFileSync(join(game, "vendor/game-kit/KIT_COMMIT"), "utf8").trim()).toBe(
    git("rev-parse", "HEAD"),
  );
  const manifest = JSON.parse(readFileSync(join(game, "vendor/game-kit/package.json"), "utf8"));
  expect(manifest.devDependencies).toBeUndefined();
  expect(manifest.scripts).toBeUndefined();
  writeFileSync(join(game, "outside.txt"), "keep");
  writeFileSync(join(game, "vendor/game-kit/src/value.ts"), "changed");
  expect(() =>
    execFileSync("bash", [join(repo, "scripts/sync-into.sh"), "--check", game], { stdio: "pipe" }),
  ).toThrow();
  expect(readFileSync(join(game, "outside.txt"), "utf8")).toBe("keep");
});
