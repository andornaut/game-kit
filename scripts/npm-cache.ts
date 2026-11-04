// Move the npm cache volume's contents to and from a host directory, such as a CI cache.
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  containerOptions,
  main,
  nodeImage,
  NPM_CACHE_MOUNT,
  npmCacheVolume,
  requireLoad,
  runContainer,
  ScriptError,
} from "./runtime.ts";

const USAGE = "Usage: npm-cache.ts load|save <directory>";

/** Container options mounting the cache volume, writable only for `load`. */
function volumeOptions(cache: string, writable: boolean): string[] {
  const access = writable ? "" : ",readonly";
  return [
    ...containerOptions(),
    ...["--network", "none"],
    ...["--mount", `type=volume,source=${cache},target=${NPM_CACHE_MOUNT}${access}`],
  ];
}

export function npmCache(env: NodeJS.ProcessEnv, root: string, args: string[]): void {
  const [action, directory] = args;
  if (args.length !== 2 || directory === undefined || (action !== "load" && action !== "save")) {
    throw new ScriptError(USAGE, 2);
  }
  const cache = npmCacheVolume(env);
  const image = nodeImage(root);
  requireLoad();
  if (action === "load") {
    // The host directory reaches the container on stdin and extracts as the container user. Its
    // entries are archived rather than ".", whose metadata belongs to the volume.
    const entries = readdirSync(directory);
    const archive = execFileSync("tar", ["-c", "-C", directory, "--", ...entries], {
      maxBuffer: 1 << 30,
    });
    runContainer({ input: archive }, [
      ...volumeOptions(cache, true),
      ...[image, "tar", "-x", "-C", NPM_CACHE_MOUNT],
    ]);
    console.log(`Loaded ${directory} into the ${cache} volume.`);
    return;
  }
  mkdirSync(directory, { recursive: true });
  runContainer({ copyOut: { from: NPM_CACHE_MOUNT, to: realpathSync(directory) } }, [
    ...volumeOptions(cache, false),
    ...[image, "true"],
  ]);
  console.log(`Saved the ${cache} volume to ${directory}.`);
}

main(import.meta.url, (args) =>
  npmCache(process.env, resolve(dirname(fileURLToPath(import.meta.url)), ".."), args),
);
