// Project checks run directly inside the isolated source snapshot, without nested containers.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { delimiter, resolve } from "node:path";

import { packageSource } from "./package-source.ts";
import { main, ScriptError } from "./runtime.ts";

export function containerCheck(env: NodeJS.ProcessEnv, args: string[]): void {
  const [task, ...focused] = args;
  if (!["lint", "lint-features", "test", "build", "format", "exec"].includes(task ?? "")) {
    throw new ScriptError("Expected lint, lint-features, test, build, format or exec.", 2);
  }
  if (task === "format" && env.CHECK_WRITABLE !== "1") {
    throw new ScriptError("Formatting requires explicit writable container execution.", 2);
  }
  let formatLink = false;
  if (task === "format" && !lstatSync("node_modules", { throwIfNoEntry: false })) {
    symlinkSync("/opt/check/node_modules", "node_modules", "dir");
    formatLink = true;
  }
  if (task !== "exec" && task !== "format" && !existsSync("node_modules")) {
    mkdirSync("node_modules");
    for (const entry of readdirSync("/opt/check/node_modules")) {
      symlinkSync(`/opt/check/node_modules/${entry}`, `node_modules/${entry}`);
    }
  }
  const tools = {
    ...env,
    SOURCE_COMMIT: env.CHECK_REVISION ?? env.SOURCE_COMMIT,
    PATH: `${resolve("node_modules/.bin")}${delimiter}/opt/check/node_modules/.bin${delimiter}${env.PATH ?? ""}`,
    npm_config_cache: env.npm_config_cache ?? "/scratch/npm-cache",
  };
  const run = (command: string, parameters: string[]) => {
    const result = spawnSync(command, parameters, { env: tools, stdio: "inherit" });
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new ScriptError(`${command} failed.`, result.status ?? 1);
    }
  };
  if (task === "format") {
    try {
      run(process.execPath, ["node_modules/prettier/bin/prettier.cjs", "--write", "."]);
      run(process.execPath, ["node_modules/eslint/bin/eslint.js", "--fix", "."]);
    } finally {
      if (
        formatLink &&
        lstatSync("node_modules", { throwIfNoEntry: false })?.isSymbolicLink() &&
        readlinkSync("node_modules") === "/opt/check/node_modules"
      ) {
        unlinkSync("node_modules");
      }
    }
  } else if (task === "exec") {
    if (!env.COMMAND) {
      throw new ScriptError("COMMAND must specify the container command.", 2);
    }
    run("sh", ["-ec", env.COMMAND]);
  } else if (task === "test") {
    if (focused.some((arg) => /^--(?:max|min)Workers(?:=|$)/.test(arg))) {
      throw new ScriptError("Test worker limits are owned by the container dispatcher.", 2);
    }
    run(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--maxWorkers=4", ...focused]);
  } else if (task === "lint" || task === "lint-features") {
    run(process.execPath, ["scripts/typecheck.ts"]);
    run(process.execPath, ["node_modules/prettier/bin/prettier.cjs", "--check", "."]);
    run(process.execPath, ["node_modules/eslint/bin/eslint.js", "--max-warnings", "0", "."]);
    if (task === "lint") {
      run(process.execPath, ["node_modules/markdownlint-cli2/markdownlint-cli2.mjs"]);
    }
  } else {
    const artifact = packageSource(tools, process.cwd(), resolve(".claude/release-output"));
    run(process.execPath, ["scripts/release-artifact.ts", artifact]);
  }
}

main(import.meta.url, (args) => containerCheck(process.env, args));
