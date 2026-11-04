// Build a committed npm-compatible release asset without registry publication.
import { execFileSync } from "node:child_process";
import { mkdirSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  containerOptions,
  git,
  main,
  nodeImage,
  NPM_CACHE_MOUNT,
  npmCacheVolume,
  requireLoad,
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

export function pack(env: NodeJS.ProcessEnv, root: string, args: string[]): void {
  const [destination] = args;
  if (args.length !== 1 || destination === undefined) {
    throw new ScriptError("Usage: pack.ts <output-directory>", 2);
  }
  const cache = npmCacheVolume(env);
  requireLoad();
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
      "node scripts/release-build.ts release",
      `printf '%s\\n' "$SOURCE_COMMIT" > release/SOURCE_COMMIT`,
      "cd release",
      `npm pack --offline --ignore-scripts --json --pack-destination ${OUTPUT} > ${OUTPUT}/pack.json`,
      `mv "${OUTPUT}/andornaut-game-kit-$VERSION.tgz" "${OUTPUT}/game-kit-$VERSION.tgz"`,
      `cp SOURCE_COMMIT ${OUTPUT}/SOURCE_COMMIT`,
      `cd ${OUTPUT}`,
      `sha256sum "game-kit-$VERSION.tgz" > SHA256SUMS`,
    ].join("\n"),
  ]);
  console.log(`Release artifacts: ${output}`);
}

main(import.meta.url, (args) =>
  pack(process.env, resolve(dirname(fileURLToPath(import.meta.url)), ".."), args),
);
