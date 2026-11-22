// Compatibility entry point for the committed mode of the local check runner.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkLocal } from "./check-local.ts";
import { main, ScriptError } from "./runtime.ts";

/** Verify and prove the committed release, optionally exporting the checked artifacts. */
export function check(env: NodeJS.ProcessEnv, root: string, releaseDirectory?: string): void {
  checkLocal(env, root, { mode: "release", releaseDirectory });
}

main(import.meta.url, (args) => {
  if (args.length > 1) {
    throw new ScriptError("Usage: check.ts [release-directory]", 2);
  }
  check(process.env, resolve(dirname(fileURLToPath(import.meta.url)), ".."), args[0]);
});
