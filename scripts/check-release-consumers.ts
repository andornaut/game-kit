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
  "or: check-release-consumers.ts --game <archie|chibi> <artifact.tgz> <sha256> " +
  "<source-commit> <repository> <revision>\n" +
  "GAME_KIT_ARCHIE_CACHE and GAME_KIT_CHIBI_CACHE must name each selected game's populated npm cache.";

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const commit = (root: string, revision: string) =>
  git(root, "rev-parse", "--verify", `${revision}^{commit}`);

export function checkReleaseConsumers(env: NodeJS.ProcessEnv, kit: string, args: string[]): void {
  const single = args[0] === "--game";
  if (args.length !== 7 || (args[0]!.startsWith("--") && !single)) {
    throw new ScriptError(USAGE, 2);
  }
  const game = args[1];
  if (single && game !== "archie" && game !== "chibi") {
    throw new ScriptError(`Unsupported game selection: ${game}\n${USAGE}`, 2);
  }
  const selected = single
    ? [{ game: game!, repository: args[5]!, revision: args[6]! }]
    : [
        { game: "archie", repository: args[3]!, revision: args[4]! },
        { game: "chibi", repository: args[5]!, revision: args[6]! },
      ];
  const caches = selected.map(({ game }) => {
    const name = `GAME_KIT_${game.toUpperCase()}_CACHE`;
    const cache = env[name];
    if (!cache) {
      throw new ScriptError(USAGE, 2);
    }
    return cache;
  });
  const [artifactPath, hash, source] = args.slice(single ? 2 : 0, single ? 5 : 3) as [
    string,
    string,
    string,
  ];
  const artifact = realpathSync(artifactPath);
  const sourceRevision = commit(kit, source);
  const version = committedVersion(kit, sourceRevision);
  const consumers = selected.map((entry, index) => {
    const repository = realpathSync(entry.repository);
    return {
      game: entry.game,
      repository,
      revision: commit(repository, entry.revision),
      cache: realpathSync(caches[index]!),
      git: git(repository, "rev-parse", "--path-format=absolute", "--git-common-dir"),
    };
  });
  const scope = single ? "incomplete-release-proof" : "complete-release-proof";
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw new ScriptError("Expected SHA256 must be 64 lowercase hex digits.", 2);
  }
  if (sha256(artifact) !== hash) {
    throw new ScriptError("Artifact SHA256 mismatch.");
  }
  mkdirSync(join(kit, ".claude"), { recursive: true });
  const output = mkdtempSync(join(kit, ".claude/release-consumers."));
  const roots = [kit, ...consumers.map(({ repository }) => repository)];
  const before = sourceFingerprint(roots);
  writeFileSync(join(output, "source.before"), `${before}\n`);
  writeFileSync(
    join(output, "revisions.txt"),
    [
      `artifact_sha256=${hash}`,
      `source=${sourceRevision}`,
      `version=${version}`,
      `selected_games=${consumers.map(({ game }) => game).join(",")}`,
      `scope=${scope}`,
      ...consumers.map(({ game, revision }) => `${game}=${revision}`),
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
        ...containerOptions(
          kit,
          ...consumers.flatMap(({ cache, repository }) => [repository, cache]),
        ),
        ...["--network", "none"],
        ...readOnlyMount(kit, "/harness"),
        ...readOnlyMount(artifact, "/assets/release.tgz"),
        ...consumers.flatMap(({ cache, game, git: repository }) => [
          ...readOnlyMount(repository, `/repos/${game}.git`),
          ...readOnlyMount(cache, `/caches/${game}`),
        ]),
        ...["-e", `npm_config_logs_dir=${SCRATCH}/npm-logs`],
        ...["-e", `npm_config_userconfig=${SCRATCH}/npm-user-config`],
        ...["-e", `npm_config_globalconfig=${SCRATCH}/npm-global-config`],
        ...[nodeImage(kit), "timeout", "600s", "node", "/harness/scripts/release-consumer-job.ts"],
        ...(single
          ? ["--game", game!, hash, sourceRevision, version, consumers[0]!.revision]
          : [hash, sourceRevision, version, ...consumers.map(({ revision }) => revision)]),
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
    writeFileSync(
      join(output, "RESULT"),
      failure === undefined
        ? single
          ? `PARTIAL PASS: ${scope}; selected_games=${game}\n`
          : "PASS\n"
        : "FAIL\n",
    );
  }
  console.log(`Release consumer evidence: ${output}`);
  if (failure !== undefined) {
    throw failure;
  }
}

main(import.meta.url, (args) =>
  checkReleaseConsumers(process.env, resolve(dirname(fileURLToPath(import.meta.url)), ".."), args),
);
