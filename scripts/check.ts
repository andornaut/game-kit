// Verify types, lint, tests and the compiled artifact in isolated containers.
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CONTAINER_UID,
  containerOptions,
  git,
  main,
  nodeImage,
  NPM_CACHE_MOUNT,
  npmCacheVolume,
  readOnlyMount,
  requireLoad,
  runContainer,
  ScriptError,
} from "./runtime.ts";
import { sourceFingerprint } from "./source-fingerprint.ts";

const EVIDENCE = "/tmp/evidence";
// Written to the evidence directory when the offline install cannot be satisfied from the cache.
const CACHE_MISS = "NPM_CACHE_MISS";

export function check(env: NodeJS.ProcessEnv, root: string): void {
  const cache = npmCacheVolume(env);
  const image = nodeImage(root);
  mkdirSync(join(root, ".claude"), { recursive: true });
  const before = sourceFingerprint(root);
  // CLEANUP (added 2026-11-01): retain artifact evidence until release review accepts it.
  const evidence = mkdtempSync(join(root, ".claude/artifact-check."));
  // The tmpfs mount points must exist in the read-only checkout.
  mkdirSync(join(root, "node_modules"), { recursive: true });
  mkdirSync(join(root, ".worktrees"), { recursive: true });
  const options = [
    ...containerOptions(root),
    ...["--mount", `type=volume,source=${cache},target=${NPM_CACHE_MOUNT}`],
    ...["-e", `npm_config_cache=${NPM_CACHE_MOUNT}`],
    ...["-e", `WORKERS_CI_COMMIT_SHA=${git(root, "rev-parse", "HEAD")}`],
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
      "npm run check",
      "npm run lint",
      "npm test -- --maxWorkers=4",
      "node scripts/release-artifact.mjs",
    ].join("\n"),
  ];
  const runGate = () => runContainer({ copyOut: { from: EVIDENCE, to: evidence } }, gate);
  let failure: unknown;
  try {
    requireLoad();
    console.log("Checking types, lint and tests offline in a fresh container.");
    try {
      runGate();
    } catch (error) {
      const marker = join(evidence, CACHE_MISS);
      if (!existsSync(marker)) {
        throw error;
      }
      rmSync(marker);
      requireLoad();
      console.log("The npm cache is incomplete; populating it in a container.");
      runContainer({}, [
        ...options,
        ...[image, "npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"],
      ]);
      requireLoad();
      console.log("Checking types, lint and tests offline in a fresh container.");
      runGate();
    }
    console.log(`Artifact evidence copied to ${evidence}`);
  } catch (error) {
    failure = error;
  }
  let after;
  try {
    after = sourceFingerprint(root);
  } catch {
    throw new ScriptError("Cannot verify source fingerprints; discard the gate result.");
  }
  if (after !== before) {
    throw new ScriptError("Source changed during verification; discard the gate result.");
  }
  if (failure !== undefined) {
    throw failure;
  }
}

main(import.meta.url, () =>
  check(process.env, resolve(dirname(fileURLToPath(import.meta.url)), "..")),
);
