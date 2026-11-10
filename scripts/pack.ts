// Build the committed npm-compatible release assets without registry publication.
import { execFileSync } from "node:child_process";
import { mkdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  containerOptions,
  git,
  main,
  nodeImage,
  NPM_CACHE_MOUNT,
  npmCacheVolume,
  runContainer,
  ScriptError,
} from "./runtime.ts";

const OUTPUT = "/tmp/out";

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
  const cache = npmCacheVolume(env);
  const image = nodeImage(root);
  const revision = git(root, "rev-parse", "HEAD");
  const version = committedVersion(root, revision);
  mkdirSync(destination, { recursive: true });
  const output = realpathSync(destination);
  // The committed snapshot reaches the container on stdin; nothing is staged on the host.
  const archive = execFileSync("git", ["-C", root, "archive", revision], { maxBuffer: 1 << 30 });
  runContainer({ copyOut: { from: OUTPUT, to: output }, input: archive }, [
    ...containerOptions(root),
    ...["--network", "none"],
    ...["--mount", `type=volume,source=${cache},target=${NPM_CACHE_MOUNT},readonly`],
    ...["-e", `SOURCE_DATE_EPOCH=${git(root, "show", "-s", "--format=%ct", revision)}`],
    ...["-e", `SOURCE_COMMIT=${revision}`, "-e", `VERSION=${version}`],
    ...["-e", "npm_config_cache=/tmp/npm-cache", "-w", "/tmp"],
    ...[image, "sh", "-ec"],
    [
      `mkdir /tmp/package ${OUTPUT}`,
      "tar -x -C /tmp/package",
      `cp -a ${NPM_CACHE_MOUNT}/. /tmp/npm-cache`,
      "cd /tmp/package",
      "npm ci --offline --ignore-scripts --no-audit --no-fund",
      `node scripts/package-source.ts ${OUTPUT}`,
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
