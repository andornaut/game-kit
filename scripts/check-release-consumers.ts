// Prove one tarball against immutable offline consumer snapshots; preserve evidence.
// GAME_KIT_ARCHIE_CACHE and GAME_KIT_CHIBI_CACHE name each game's populated offline npm cache.
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
  errorMessage,
  git,
  main,
  nodeImage,
  readOnlyMount,
  requireLoad,
  runContainer,
  ScriptError,
} from "./runtime.ts";
import { sourceFingerprint } from "./source-fingerprint.ts";

const SCRATCH = "/tmp/scratch";
const USAGE =
  "Usage: check-release-consumers.ts <artifact.tgz> <sha256> <source-commit> " +
  "<Archie repository> <Archie revision> <Chibi repository> <Chibi revision>\n" +
  "GAME_KIT_ARCHIE_CACHE and GAME_KIT_CHIBI_CACHE must name each game's populated npm cache.";

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const commit = (root: string, revision: string) =>
  git(root, "rev-parse", "--verify", `${revision}^{commit}`);

export function checkReleaseConsumers(env: NodeJS.ProcessEnv, kit: string, args: string[]): void {
  const { GAME_KIT_ARCHIE_CACHE: archieCachePath, GAME_KIT_CHIBI_CACHE: chibiCachePath } = env;
  if (args.length !== 7 || !archieCachePath || !chibiCachePath) {
    throw new ScriptError(USAGE, 2);
  }
  const [artifactPath, hash, source, archiePath, archieRef, chibiPath, chibiRef] = args as [
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
  const archie = realpathSync(archiePath);
  const archieRevision = commit(archie, archieRef);
  const chibi = realpathSync(chibiPath);
  const chibiRevision = commit(chibi, chibiRef);
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw new ScriptError("Expected SHA256 must be 64 lowercase hex digits.", 2);
  }
  if (sha256(artifact) !== hash) {
    throw new ScriptError("Artifact SHA256 mismatch.");
  }
  const commonDir = (root: string) =>
    git(root, "rev-parse", "--path-format=absolute", "--git-common-dir");
  const archieGit = commonDir(archie);
  const chibiGit = commonDir(chibi);
  const archieCache = realpathSync(archieCachePath);
  const chibiCache = realpathSync(chibiCachePath);
  mkdirSync(join(kit, ".claude"), { recursive: true });
  const output = mkdtempSync(join(kit, ".claude/release-consumers."));
  const roots = [kit, archie, chibi];
  const before = sourceFingerprint(roots);
  writeFileSync(join(output, "source.before"), `${before}\n`);
  writeFileSync(
    join(output, "revisions.txt"),
    [
      `artifact_sha256=${hash}`,
      `source=${sourceRevision}`,
      `version=${version}`,
      `archie=${archieRevision}`,
      `chibi=${chibiRevision}`,
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
        ...containerOptions(kit, archie, chibi, archieCache, chibiCache),
        ...["--network", "none"],
        ...readOnlyMount(kit, "/harness"),
        ...readOnlyMount(artifact, "/assets/release.tgz"),
        ...readOnlyMount(archieGit, "/repos/archie.git"),
        ...readOnlyMount(chibiGit, "/repos/chibi.git"),
        ...readOnlyMount(archieCache, "/caches/archie"),
        ...readOnlyMount(chibiCache, "/caches/chibi"),
        ...["-e", `npm_config_logs_dir=${SCRATCH}/npm-logs`],
        ...["-e", `npm_config_userconfig=${SCRATCH}/npm-user-config`],
        ...["-e", `npm_config_globalconfig=${SCRATCH}/npm-global-config`],
        ...[nodeImage(kit), "timeout", "600s", "node", "/harness/scripts/release-consumer-job.ts"],
        ...[hash, sourceRevision, version, archieRevision, chibiRevision],
      ]);
    } finally {
      closeSync(log);
    }
  } catch (error) {
    failure = error;
  }
  let after;
  try {
    after = sourceFingerprint(roots);
  } catch (error) {
    const cause = `Cannot verify source fingerprints: ${errorMessage(error)}`;
    const proof = failure === undefined ? "" : `\nThe proof also failed: ${errorMessage(failure)}`;
    writeFileSync(join(output, "RESULT"), `INVALID: ${cause}${proof}\n`);
    throw new ScriptError(`${cause}${proof}\nRelease consumer evidence: ${output}`);
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
