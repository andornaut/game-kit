// Build the committed npm-compatible release assets without registry publication.
import { mkdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { pinReleaseSource, type ReleaseSource } from "./release-source.ts";
import {
  containerOptions,
  git,
  main,
  NPM_CACHE_MOUNT,
  npmCacheVolume,
  runContainer,
  ScriptError,
} from "./runtime.ts";

const OUTPUT = "/tmp/out";
const PACK_COMMAND = [
  'import { packageSnapshot } from "./scripts/package-source.ts";',
  "packageSnapshot(process.env, process.cwd(), process.argv[1]);",
].join(" ");

/** The exact release version recorded by a committed manifest. */
export function committedVersion(root: string, revision: string): string {
  const manifest = JSON.parse(git(root, "show", `${revision}:package.json`));
  if (manifest.name !== "@andornaut/game-kit") {
    throw new ScriptError("Source revision is not @andornaut/game-kit");
  }
  if (typeof manifest.version !== "string" || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(manifest.version)) {
    throw new ScriptError("Source revision has no exact release version");
  }
  return manifest.version;
}

/**
 * Build the committed HEAD offline into `destination` as `game-kit-<version>.tgz`,
 * `SOURCE_COMMIT` and `SHA256SUMS`, and return the tarball's path.
 */
export function pack(env: NodeJS.ProcessEnv, root: string, destination: string): string {
  return packSource(env, root, pinReleaseSource(root), destination);
}

export function packSource(
  env: NodeJS.ProcessEnv,
  root: string,
  source: ReleaseSource,
  destination: string,
): string {
  const cache = npmCacheVolume(env);
  const version = committedVersion(root, source.revision);
  mkdirSync(destination, { recursive: true });
  const output = realpathSync(destination);
  // The committed snapshot reaches the container on stdin; nothing is staged on the host.
  runContainer({ copyOut: { from: OUTPUT, to: output }, input: source.archive }, [
    ...containerOptions(root),
    ...["--network", "none"],
    ...["--mount", `type=volume,source=${cache},target=${NPM_CACHE_MOUNT},readonly`],
    ...["-e", `SOURCE_DATE_EPOCH=${source.dateEpoch}`],
    ...["-e", `SOURCE_COMMIT=${source.revision}`],
    ...["-e", "npm_config_cache=/tmp/npm-cache", "-w", "/tmp"],
    ...[source.image, "sh", "-ec"],
    [
      `mkdir /tmp/package ${OUTPUT}`,
      "tar -xf - -C /tmp/package",
      `cp -a ${NPM_CACHE_MOUNT}/. /tmp/npm-cache`,
      "cd /tmp/package",
      "npm ci --offline --ignore-scripts --no-audit --no-fund",
      `node --input-type=module -e '${PACK_COMMAND}' ${OUTPUT}`,
    ].join("\n"),
  ]);
  console.log(`Release artifacts: ${output}`);
  return join(output, `game-kit-${version}.tgz`);
}

main(import.meta.url, (args) => {
  const [destination] = args;
  if (args.length !== 1 || destination === undefined) {
    throw new ScriptError("Usage: pack.ts <output-directory>", 2);
  }
  pack(process.env, resolve(dirname(fileURLToPath(import.meta.url)), ".."), destination);
});
