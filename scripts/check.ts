// Verify types, lint and tests, then pack the committed release and check that exact tarball,
// each in an isolated container.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { NPM_CACHE_MISS } from "./container-check.ts";
import { packSource } from "./pack.ts";
import { pinReleaseSource, requireReleaseCheckout } from "./release-source.ts";
import {
  containerOptions,
  errorMessage,
  git,
  main,
  NPM_CACHE_MOUNT,
  npmCacheVolume,
  readOnlyMount,
  runContainer,
  ScriptError,
} from "./runtime.ts";
import { sourceFingerprint } from "./source-fingerprint.ts";

const EVIDENCE = "/tmp/evidence";
const ARTIFACT = "/assets/release.tgz";
const DISCARD = "Discard the gate result.";
const EXTRACT = ["mkdir /tmp/package", "tar -xf - -C /tmp/package", "cd /tmp/package"];

/**
 * Run the gate. The release artifacts go to `releaseDirectory` when given, so a caller can
 * publish the checked tarball; otherwise they are evidence, kept only when the gate fails.
 */
export function check(env: NodeJS.ProcessEnv, root: string, releaseDirectory?: string): void {
  const cache = npmCacheVolume(env);
  const before = sourceFingerprint([root]);
  const revision = git(root, "rev-parse", "HEAD");
  requireReleaseCheckout(root, revision);
  const source = pinReleaseSource(root, revision);
  mkdirSync(join(root, ".claude"), { recursive: true });
  // The release artifacts and their consumer probe, kept only when the gate fails.
  const evidence = mkdtempSync(join(root, ".claude/artifact-check."));
  const release = join(evidence, "release");
  const options = [
    ...containerOptions(root),
    ...["--mount", `type=volume,source=${cache},target=${NPM_CACHE_MOUNT}`],
    ...["-e", `npm_config_cache=${NPM_CACHE_MOUNT}`],
    ...["-e", `SOURCE_COMMIT=${source.revision}`],
    ...["-e", `GAME_KIT_ARTIFACT_EVIDENCE=${EVIDENCE}`],
    ...["-w", "/tmp"],
  ];
  const gate = [
    ...options,
    ...["--network", "none", source.image, "sh", "-ec"],
    [
      `mkdir ${EVIDENCE}`,
      ...EXTRACT,
      `node scripts/container-check.ts install-offline ${EVIDENCE}`,
      "node scripts/container-check.ts lint",
      "node scripts/container-check.ts test",
    ].join("\n"),
  ];
  const runGate = () =>
    runContainer({ copyOut: { from: EVIDENCE, to: evidence }, input: source.archive }, gate);
  let failure: unknown;
  try {
    console.log("Checking types, lint and tests offline in a fresh container.");
    try {
      runGate();
    } catch (error) {
      const marker = join(evidence, NPM_CACHE_MISS);
      if (!existsSync(marker)) {
        throw error;
      }
      rmSync(marker);
      console.log("The npm cache is incomplete; populating it in a container.");
      runContainer({ input: source.archive }, [
        ...options,
        ...[source.image, "sh", "-ec"],
        [...EXTRACT, "npm ci --ignore-scripts --no-audit --no-fund"].join("\n"),
      ]);
      console.log("Checking types, lint and tests offline in a fresh container.");
      runGate();
    }
    // The cache is complete once the gate has installed from it offline.
    const tarball = packSource(env, root, source, release);
    console.log("Checking the packed tarball offline in a fresh container.");
    runContainer({ copyOut: { from: EVIDENCE, to: evidence }, input: source.archive }, [
      ...options,
      ...readOnlyMount(tarball, ARTIFACT),
      ...["--network", "none", source.image, "sh", "-ec"],
      [
        `mkdir ${EVIDENCE}`,
        ...EXTRACT,
        "npm ci --offline --ignore-scripts --no-audit --no-fund",
        `node scripts/release-artifact.ts ${ARTIFACT}`,
      ].join("\n"),
    ]);
  } catch (error) {
    failure = error;
  }
  const also = failure === undefined ? "" : `\nThe gate also failed: ${errorMessage(failure)}`;
  let after;
  try {
    after = sourceFingerprint([root]);
  } catch (error) {
    console.error(`Artifact evidence: ${evidence}`);
    const cause = errorMessage(error);
    throw new ScriptError(`Cannot verify source fingerprints: ${cause}${also}\n${DISCARD}`);
  }
  if (after !== before) {
    console.error(`Artifact evidence: ${evidence}`);
    throw new ScriptError(`Source changed during verification.${also}\n${DISCARD}`);
  }
  if (failure !== undefined) {
    console.error(`Artifact evidence: ${evidence}`);
    throw failure;
  }
  if (releaseDirectory !== undefined) {
    mkdirSync(releaseDirectory, { recursive: true });
    for (const file of readdirSync(release)) {
      copyFileSync(join(release, file), join(releaseDirectory, file));
    }
    console.log(`Checked release artifacts: ${resolve(releaseDirectory)}`);
  }
  rmSync(evidence, { force: true, recursive: true });
}

main(import.meta.url, (args) => {
  if (args.length > 1) {
    throw new ScriptError("Usage: check.ts [release-directory]", 2);
  }
  check(process.env, resolve(dirname(fileURLToPath(import.meta.url)), ".."), args[0]);
});
