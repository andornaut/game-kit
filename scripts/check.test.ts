import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it, vi } from "vitest";

import { check } from "./check.ts";
import { NPM_CACHE_MISS } from "./container-check.ts";
import { git, runContainer, ScriptError } from "./runtime.ts";

vi.mock("./runtime.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./runtime.ts")>()),
  runContainer: vi.fn(),
}));

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "legacy-release-gate-"));
  writeFileSync(join(root, ".gitignore"), ".claude/\n");
  writeFileSync(join(root, ".nvmrc"), "v24.21.0\n");
  writeFileSync(join(root, "package.json"), '{"name":"@andornaut/game-kit","version":"0.1.0"}');
  git(root, "init", "--quiet");
  git(root, "config", "user.email", "fixture@example.invalid");
  git(root, "config", "user.name", "Release fixture");
  git(root, "add", ".");
  git(root, "commit", "--no-verify", "--quiet", "-m", "Pinned release");
  const revision = git(root, "rev-parse", "HEAD");
  const destination = join(root, ".claude/output");
  const run = vi.mocked(runContainer);
  run.mockReset();
  return { destination, revision, root, run };
}

it("keeps verification, a cache fill, packaging and proof pinned even if HEAD moves", () => {
  const { destination, revision, root, run } = fixture();
  const pinned: string[] = [];
  run.mockImplementation(({ copyOut, input }) => {
    pinned.push(execFileSync("git", ["get-tar-commit-id"], { encoding: "utf8", input }).trim());
    if (pinned.length === 1) {
      writeFileSync(join(copyOut!.to, NPM_CACHE_MISS), "");
      git(root, "commit", "--allow-empty", "--no-verify", "--quiet", "-m", "Moved HEAD");
      throw new ScriptError("Confirmed offline miss.");
    }
    if (copyOut?.from === "/tmp/out") {
      writeFileSync(join(copyOut.to, "game-kit-0.1.0.tgz"), "fixture archive");
    }
  });
  expect(() => check({}, root, destination)).toThrow(/Source changed/);
  expect(pinned).toEqual(Array<string>(5).fill(revision));
  expect(existsSync(destination)).toBe(false);
});

it("reports a non-cache failure after one offline attempt", () => {
  const { destination, root, run } = fixture();
  const installError = new ScriptError("Offline npm ci failed with EUSAGE.");
  run.mockImplementation(() => {
    throw installError;
  });
  expect(() => check({}, root, destination)).toThrow(installError);
  expect(run).toHaveBeenCalledOnce();
  expect(existsSync(destination)).toBe(false);
});
