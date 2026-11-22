// Project checks run directly inside the isolated source snapshot, without nested containers.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";

import { packageSnapshot, sourceCommit } from "./package-source.ts";
import { main, ScriptError } from "./runtime.ts";

export const NPM_CACHE_MISS = "NPM_CACHE_MISS";
export const CHECK_EVIDENCE = "/tmp/check-evidence";
const INSTALL = ["ci", "--ignore-scripts", "--no-audit", "--no-fund"];

export function isNpmCacheMiss(diagnostic: string): boolean {
  const codes = [...diagnostic.matchAll(/^npm (?:ERR!|error) code ([A-Z0-9]+)\s*$/gm)];
  if (codes.length > 0) {
    return codes.every((match) => match[1] === "ENOTCACHED");
  }
  return diagnostic.split(/\r?\n/).some((line) => {
    const message = /^npm (?:ERR!|error) request to .+ failed: (.+)$/.exec(line)?.[1];
    return (
      message !== undefined &&
      /^cache mode is ['"]only-if-cached['"] but no cached response is available\.?$/.test(message)
    );
  });
}

function installOffline(env: NodeJS.ProcessEnv, evidence: string): void {
  const result = spawnSync("npm", [...INSTALL, "--offline"], {
    encoding: "utf8",
    env,
  });
  if (result.error) {
    throw result.error;
  }
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  if (result.status !== 0) {
    const diagnostic = `${result.stderr}\n${result.stdout}`;
    writeFileSync(join(evidence, "npm-ci-offline.log"), diagnostic);
    if (isNpmCacheMiss(diagnostic)) {
      writeFileSync(join(evidence, NPM_CACHE_MISS), "");
    }
    throw new ScriptError("Offline npm ci failed.", result.status ?? 1);
  }
}

export function containerCheck(env: NodeJS.ProcessEnv, args: string[]): void {
  const [task, ...focused] = args;
  if (task === "install-offline" && focused.length === 1) {
    installOffline(env, focused[0]!);
    return;
  }
  const tools = {
    ...env,
    PATH: `${resolve("node_modules/.bin")}${delimiter}${env.PATH ?? ""}`,
    npm_config_cache: env.npm_config_cache ?? "/scratch/npm-cache",
  };
  const run = (command: string, parameters: string[], env = tools) => {
    const result = spawnSync(command, parameters, { env, stdio: "inherit" });
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new ScriptError(`${command} failed.`, result.status ?? 1);
    }
  };
  const test = (paths: string[] = []) => {
    if (paths.some((arg) => /^--(?:max|min)Workers(?:=|$)/.test(arg))) {
      throw new ScriptError("Test worker limits are owned by the container dispatcher.", 2);
    }
    run(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--maxWorkers=4", ...paths]);
  };
  const lint = () => {
    run(process.execPath, ["scripts/typecheck.ts"]);
    run(process.execPath, ["node_modules/prettier/bin/prettier.cjs", "--check", "."]);
    run(process.execPath, ["node_modules/eslint/bin/eslint.js", "--max-warnings", "0", "."]);
    run(process.execPath, ["node_modules/markdownlint-cli2/markdownlint-cli2.mjs"]);
  };
  switch (task) {
    case "test":
      test(focused);
      return;
    case "lint":
      lint();
      return;
    case "working-tree":
      if (focused.length !== 0) {
        break;
      }
      run("npm", [...INSTALL, "--maxsockets=1"]);
      lint();
      test();
      run(process.execPath, ["scripts/release-build.ts", "/scratch/unstamped-distribution"]);
      return;
    case "fill-cache":
      if (focused.length !== 0) {
        break;
      }
      run("npm", INSTALL);
      return;
    case "release": {
      if (focused.length !== 0) {
        break;
      }
      mkdirSync(CHECK_EVIDENCE);
      installOffline(tools, CHECK_EVIDENCE);
      lint();
      test();
      return;
    }
    case "artifact": {
      if (focused.length !== 2) {
        break;
      }
      const releaseEnv = {
        ...tools,
        GAME_KIT_ARTIFACT_EVIDENCE: CHECK_EVIDENCE,
        SOURCE_COMMIT: focused[0],
        SOURCE_DATE_EPOCH: focused[1],
      };
      sourceCommit(releaseEnv);
      mkdirSync(CHECK_EVIDENCE);
      installOffline(tools, CHECK_EVIDENCE);
      const artifact = packageSnapshot(releaseEnv, process.cwd(), join(CHECK_EVIDENCE, "release"));
      run(process.execPath, ["scripts/release-artifact.ts", artifact], releaseEnv);
      return;
    }
  }
  throw new ScriptError(
    "Expected working-tree, release, artifact, fill-cache, install-offline, lint or test.",
    2,
  );
}

main(import.meta.url, (args) => containerCheck(process.env, args));
