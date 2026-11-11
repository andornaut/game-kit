// Project checks run directly inside the isolated source snapshot, without nested containers.
import { spawnSync } from "node:child_process";
import { delimiter, resolve } from "node:path";

import { main, ScriptError } from "./runtime.ts";

export function containerCheck(env: NodeJS.ProcessEnv, args: string[]): void {
  const [task, ...focused] = args;
  if (!["lint", "test"].includes(task ?? "")) {
    throw new ScriptError("Expected lint or test.", 2);
  }
  const tools = {
    ...env,
    PATH: `${resolve("node_modules/.bin")}${delimiter}${env.PATH ?? ""}`,
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
  if (task === "test") {
    if (focused.some((arg) => /^--(?:max|min)Workers(?:=|$)/.test(arg))) {
      throw new ScriptError("Test worker limits are owned by the container dispatcher.", 2);
    }
    run(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--maxWorkers=4", ...focused]);
  } else {
    run(process.execPath, ["scripts/typecheck.ts"]);
    run(process.execPath, ["node_modules/prettier/bin/prettier.cjs", "--check", "."]);
    run(process.execPath, ["node_modules/eslint/bin/eslint.js", "--max-warnings", "0", "."]);
    run(process.execPath, ["node_modules/markdownlint-cli2/markdownlint-cli2.mjs"]);
  }
}

main(import.meta.url, (args) => containerCheck(process.env, args));
