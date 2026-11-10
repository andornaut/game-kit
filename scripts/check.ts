// Verify types, lint and tests, then pack the committed release and check that exact tarball,
// each in an isolated container.
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { pack } from "./pack.ts";
import {
  CONTAINER_UID,
  containerOptions,
  errorMessage,
  git,
  main,
  nodeImage,
  NPM_CACHE_MOUNT,
  npmCacheVolume,
  readOnlyMount,
  runContainer,
  ScriptError,
} from "./runtime.ts";
import { sourceFingerprint } from "./source-fingerprint.ts";

const EVIDENCE = "/tmp/evidence";
const ARTIFACT = "/assets/release.tgz";
// Written to the evidence directory when the offline install cannot be satisfied from the cache.
const CACHE_MISS = "NPM_CACHE_MISS";
const DISCARD = "Discard the gate result.";

/**
 * Run the gate. The release artifacts go to `releaseDirectory` when given, so a caller can
 * publish the checked tarball; otherwise they are evidence, kept only when the gate fails.
 */
export function check(env: NodeJS.ProcessEnv, root: string, releaseDirectory?: string): void {
  const cache = npmCacheVolume(env);
  const image = nodeImage(root);
  mkdirSync(join(root, ".claude"), { recursive: true });
  const before = sourceFingerprint([root]);
  // The release artifacts and their consumer probe, kept only when the gate fails.
  const evidence = mkdtempSync(join(root, ".claude/artifact-check."));
  // The tmpfs mount points must exist in the read-only checkout.
  mkdirSync(join(root, "node_modules"), { recursive: true });
  mkdirSync(join(root, ".worktrees"), { recursive: true });
  const options = [
    ...containerOptions(root),
    ...["--mount", `type=volume,source=${cache},target=${NPM_CACHE_MOUNT}`],
    ...["-e", `npm_config_cache=${NPM_CACHE_MOUNT}`],
    ...["-e", `SOURCE_COMMIT=${git(root, "rev-parse", "HEAD")}`],
    ...["-e", `GAME_KIT_ARTIFACT_EVIDENCE=${EVIDENCE}`],
    ...readOnlyMount(root, "/app"),
    ...[
      "--tmpfs",
      `/app/node_modules:exec,uid=${CONTAINER_UID},gid=${CONTAINER_UID}`,
      "-w",
      "/app",
    ],
    // Ignored local state, including private evidence directories and role worktrees, stays
    // outside the gate.
    ...["--tmpfs", "/app/.claude:ro,mode=755"],
    ...["--tmpfs", "/app/.worktrees:ro,mode=755"],
  ];
  const gate = [
    ...options,
    ...["--network", "none", image, "sh", "-ec"],
    [
      `mkdir ${EVIDENCE}`,
      "if ! npm ci --offline --ignore-scripts --no-audit --no-fund; then",
      `  touch ${EVIDENCE}/${CACHE_MISS}`,
      "  exit 1",
      "fi",
      "node scripts/container-check.ts lint",
      "node scripts/container-check.ts test",
    ].join("\n"),
  ];
  const runGate = () => runContainer({ copyOut: { from: EVIDENCE, to: evidence } }, gate);
  let failure: unknown;
  try {
    console.log("Checking types, lint and tests offline in a fresh container.");
    try {
      runGate();
    } catch (error) {
      const marker = join(evidence, CACHE_MISS);
      if (!existsSync(marker)) {
        throw error;
      }
      rmSync(marker);
      console.log("The npm cache is incomplete; populating it in a container.");
      runContainer({}, [
        ...options,
        ...[image, "npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"],
      ]);
      console.log("Checking types, lint and tests offline in a fresh container.");
      runGate();
    }
    // The cache is complete once the gate has installed from it offline.
    const tarball = pack(env, root, releaseDirectory ?? join(evidence, "release"));
    console.log("Checking the packed tarball offline in a fresh container.");
    runContainer({ copyOut: { from: EVIDENCE, to: evidence } }, [
      ...options,
      ...readOnlyMount(tarball, ARTIFACT),
      ...["--network", "none", image, "sh", "-ec"],
      [
        `mkdir ${EVIDENCE}`,
        "npm ci --offline --ignore-scripts --no-audit --no-fund",
        `node scripts/release-artifact.ts ${ARTIFACT}`,
      ].join("\n"),
    ]);
  } catch (error) {
    failure = error;
  }
  if (failure === undefined) {
    rmSync(evidence, { force: true, recursive: true });
  } else {
    console.error(`Artifact evidence: ${evidence}`);
  }
  const also = failure === undefined ? "" : `\nThe gate also failed: ${errorMessage(failure)}`;
  let after;
  try {
    after = sourceFingerprint([root]);
  } catch (error) {
    const cause = errorMessage(error);
    throw new ScriptError(`Cannot verify source fingerprints: ${cause}${also}\n${DISCARD}`);
  }
  if (after !== before) {
    throw new ScriptError(`Source changed during verification.${also}\n${DISCARD}`);
  }
  if (failure !== undefined) {
    throw failure;
  }
}

main(import.meta.url, (args) => {
  if (args.length > 1) {
    throw new ScriptError("Usage: check.ts [release-directory]", 2);
  }
  check(process.env, resolve(dirname(fileURLToPath(import.meta.url)), ".."), args[0]);
});
