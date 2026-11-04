// Verify types, lint, tests and the compiled artifact in isolated containers.
import { mkdirSync, mkdtempSync } from "node:fs";
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

export function check(env: NodeJS.ProcessEnv, root: string): void {
  const cache = npmCacheVolume(env);
  const image = nodeImage(root);
  mkdirSync(join(root, ".claude"), { recursive: true });
  const before = sourceFingerprint(root);
  // CLEANUP (added 2026-11-01): retain artifact evidence until release review accepts it.
  const evidence = mkdtempSync(join(root, ".claude/artifact-check."));
  // The tmpfs mount point must exist in the read-only checkout.
  mkdirSync(join(root, "node_modules"), { recursive: true });
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
  ];
  let failure: unknown;
  try {
    requireLoad();
    console.log("Populating the project npm cache in a container.");
    runContainer({}, [
      ...options,
      image,
      "npm",
      "ci",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ]);
    requireLoad();
    console.log("Checking types, lint and tests offline in a fresh container.");
    runContainer({ copyOut: { from: EVIDENCE, to: evidence } }, [
      ...options,
      ...["--network", "none", image, "sh", "-ec"],
      [
        `mkdir ${EVIDENCE}`,
        "npm ci --offline --ignore-scripts --no-audit --no-fund",
        "npm run check",
        "npm run lint",
        "npm test -- --maxWorkers=4",
        "node scripts/release-artifact.mjs",
      ].join("\n"),
    ]);
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
