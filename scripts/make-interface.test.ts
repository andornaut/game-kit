import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, it } from "vitest";

it("reports the same declared categories without launching Docker", () => {
  const result = spawnSync("make", ["--no-print-directory", "check-info"], { encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ checks: ["lint", "test", "build"], version: 1 });
});

it("preserves COMMAND and TEST_ARGS literally through Make exports", () => {
  const root = mkdtempSync(join(tmpdir(), "game-kit-make-"));
  mkdirSync(join(root, "tests/container"), { recursive: true });
  copyFileSync(resolve("Makefile"), join(root, "Makefile"));
  writeFileSync(join(root, ".nvmrc"), "24.21.0\n");
  writeFileSync(
    join(root, "tests/container/run"),
    "#!/usr/bin/env node\nconsole.log(JSON.stringify({command:process.env.COMMAND,args:process.env.TEST_ARGS}));\n",
    { mode: 0o755 },
  );
  const literal = "$(error must remain literal)";
  const result = spawnSync(
    "make",
    ["--no-print-directory", "exec", `COMMAND=${literal}`, `TEST_ARGS=${literal}`],
    {
      cwd: root,
      encoding: "utf8",
    },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ args: literal, command: literal });
});
