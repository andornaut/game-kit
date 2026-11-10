import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

it.each(["", "shellcheck", "markdownlint-cli2"])(
  "runs the direct lint bridge in order and propagates failures from %s",
  (failure) => {
    const root = mkdtempSync(join(tmpdir(), "game-kit-lint-bridge-"));
    const bin = join(root, "bin");
    const calls = join(root, "calls");
    mkdirSync(bin);
    for (const command of ["shellcheck", "markdownlint-cli2", "node"]) {
      writeFileSync(
        join(bin, command),
        [
          "#!/bin/sh",
          `printf "%s" "${command}" >> "$CALLS"`,
          'for arg do printf "|%s" "$arg" >> "$CALLS"; done',
          'printf "\\n" >> "$CALLS"',
          `if [ "${command}" = "$FAIL_COMMAND" ]; then exit 3; fi`,
          "",
        ].join("\n"),
        { mode: 0o755 },
      );
    }
    const result = spawnSync("sh", ["tests/container/check", "lint"], {
      encoding: "utf8",
      env: {
        ...process.env,
        CALLS: calls,
        FAIL_COMMAND: failure,
        PATH: `${bin}:${process.env.PATH}`,
      },
    });
    expect(result.status, result.stderr).toBe(failure ? 3 : 0);
    const commands = readFileSync(calls, "utf8").trim().split("\n");
    const expected = [
      "shellcheck|-x|-P|SCRIPTDIR|tests/container/run|tests/container/check",
      "markdownlint-cli2",
      "node|/work/scripts/container-check.ts|lint-features",
    ];
    expect(commands).toEqual(
      failure === "shellcheck" ? expected.slice(0, 1) : failure ? expected.slice(0, 2) : expected,
    );
  },
);
