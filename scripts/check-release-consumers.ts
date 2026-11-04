// Prove one tarball against immutable offline consumer snapshots; preserve evidence.
// GAME_KIT_DOG_CACHE and GAME_KIT_DUCK_CACHE override populated read-only caches.
import { createHash } from "node:crypto";
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { committedVersion } from "./pack.ts";
import {
  containerOptions,
  git,
  main,
  nodeImage,
  readOnlyMount,
  requireLoad,
  runContainer,
  ScriptError,
} from "./runtime.ts";
import { dirtyFingerprint } from "./source-fingerprint.ts";

const SCRATCH = "/tmp/scratch";
const USAGE =
  "Usage: check-release-consumers.ts <artifact.tgz> <sha256> <source-commit> " +
  "<Dog repository> <Dog revision> <Duck repository> <Duck revision>";

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const commit = (root: string, revision: string) =>
  git(root, "rev-parse", "--verify", `${revision}^{commit}`);

export function checkReleaseConsumers(env: NodeJS.ProcessEnv, kit: string, args: string[]): void {
  if (args.length !== 7) {
    throw new ScriptError(USAGE, 2);
  }
  const [artifactPath, hash, source, dogPath, dogRef, duckPath, duckRef] = args as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const artifact = realpathSync(artifactPath);
  const sourceRevision = commit(kit, source);
  const version = committedVersion(kit, sourceRevision);
  const dog = realpathSync(dogPath);
  const dogRevision = commit(dog, dogRef);
  const duck = realpathSync(duckPath);
  const duckRevision = commit(duck, duckRef);
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw new ScriptError("Expected SHA256 must be 64 lowercase hex digits.", 2);
  }
  if (sha256(artifact) !== hash) {
    throw new ScriptError("Artifact SHA256 mismatch.");
  }
  const commonDir = (root: string) =>
    git(root, "rev-parse", "--path-format=absolute", "--git-common-dir");
  const dogGit = commonDir(dog);
  const duckGit = commonDir(duck);
  const dogCache = realpathSync(env.GAME_KIT_DOG_CACHE ?? join(dog, ".claude/bus/npm-cache"));
  const duckCache = realpathSync(env.GAME_KIT_DUCK_CACHE ?? join(duck, ".claude/bus/npm-cache"));
  mkdirSync(join(kit, ".claude"), { recursive: true });
  const output = mkdtempSync(join(kit, ".claude/release-consumers."));
  const roots = [kit, dog, duck];
  const before = dirtyFingerprint(roots);
  writeFileSync(join(output, "source.before"), `${before}\n`);
  writeFileSync(
    join(output, "revisions.txt"),
    [
      `artifact_sha256=${hash}`,
      `source=${sourceRevision}`,
      `version=${version}`,
      `dog=${dogRevision}`,
      `duck=${duckRevision}`,
      `harness=${git(kit, "rev-parse", "HEAD")}`,
      "",
    ].join("\n"),
  );
  let failure: unknown;
  try {
    requireLoad();
    const log = openSync(join(output, "container.log"), "w");
    try {
      runContainer({ copyOut: { from: SCRATCH, to: output }, output: log }, [
        ...containerOptions(kit, dog, duck),
        ...["--network", "none"],
        ...readOnlyMount(kit, "/harness"),
        ...readOnlyMount(artifact, "/assets/release.tgz"),
        ...readOnlyMount(dogGit, "/repos/dog.git"),
        ...readOnlyMount(duckGit, "/repos/duck.git"),
        ...readOnlyMount(dogCache, "/caches/dog"),
        ...readOnlyMount(duckCache, "/caches/duck"),
        ...["-e", `npm_config_logs_dir=${SCRATCH}/npm-logs`],
        ...["-e", `npm_config_userconfig=${SCRATCH}/npm-user-config`],
        ...["-e", `npm_config_globalconfig=${SCRATCH}/npm-global-config`],
        ...[nodeImage(kit), "timeout", "600s", "node", "/harness/scripts/release-consumer-job.ts"],
        ...[hash, sourceRevision, version, dogRevision, duckRevision],
      ]);
    } finally {
      closeSync(log);
    }
  } catch (error) {
    failure = error;
  }
  let after;
  try {
    after = dirtyFingerprint(roots);
  } catch {
    writeFileSync(join(output, "RESULT"), "INVALID: source fingerprint unavailable\n");
    throw new ScriptError(`Release consumer evidence: ${output}`);
  }
  writeFileSync(join(output, "source.after"), `${after}\n`);
  if (before !== after || sha256(artifact) !== hash) {
    writeFileSync(join(output, "RESULT"), "INVALID: source or artifact changed during proof\n");
    failure ??= new ScriptError("Source or artifact changed during proof.");
  } else {
    writeFileSync(join(output, "RESULT"), failure === undefined ? "PASS\n" : "FAIL\n");
  }
  console.log(`Release consumer evidence: ${output}`);
  if (failure !== undefined) {
    throw failure;
  }
}

main(import.meta.url, (args) =>
  checkReleaseConsumers(process.env, resolve(dirname(fileURLToPath(import.meta.url)), ".."), args),
);
