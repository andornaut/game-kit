// Compile and pack the source identified by SOURCE_COMMIT.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { pinReleaseSource, requireReleaseCheckout } from "./release-source.ts";
import { main, ScriptError } from "./runtime.ts";

/** The validated source commit; SOURCE_DATE_EPOCH must name its timestamp. */
export function sourceCommit(env: NodeJS.ProcessEnv): string {
  const revision = env.SOURCE_COMMIT;
  if (!revision || !/^[0-9a-f]{40}$/.test(revision)) {
    throw new ScriptError("SOURCE_COMMIT must name the full source commit.");
  }
  if (!env.SOURCE_DATE_EPOCH || !/^[0-9]+$/.test(env.SOURCE_DATE_EPOCH)) {
    throw new ScriptError("SOURCE_DATE_EPOCH must name the source commit timestamp.");
  }
  return revision;
}

// Used only by packaging paths after extraction from their pinned Git archive.
export function packageSnapshot(env: NodeJS.ProcessEnv, root: string, destination: string): string {
  const revision = sourceCommit(env);
  const staging = mkdtempSync(join(tmpdir(), "game-kit-package-"));
  try {
    mkdirSync(destination, { recursive: true });
    execFileSync(process.execPath, ["scripts/release-build.ts", staging], {
      cwd: root,
      env,
      stdio: "inherit",
    });
    writeFileSync(join(staging, "SOURCE_COMMIT"), `${revision}\n`);
    const packed = execFileSync(
      "npm",
      [
        "pack",
        "--offline",
        "--ignore-scripts",
        "--json",
        "--pack-destination",
        resolve(destination),
      ],
      { cwd: staging, env, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
    );
    const metadata = JSON.parse(packed) as { filename: string; version: string }[];
    const item = metadata[0]!;
    const filename = `game-kit-${item.version}.tgz`;
    const artifact = join(destination, filename);
    renameSync(join(destination, item.filename), artifact);
    writeFileSync(join(destination, "pack.json"), packed);
    writeFileSync(join(destination, "SOURCE_COMMIT"), `${revision}\n`);
    writeFileSync(
      join(destination, "SHA256SUMS"),
      `${createHash("sha256").update(readFileSync(artifact)).digest("hex")}  ${filename}\n`,
    );
    return artifact;
  } finally {
    rmSync(staging, { force: true, recursive: true });
  }
}

export function packageSource(env: NodeJS.ProcessEnv, root: string, destination: string): string {
  const revision = sourceCommit(env);
  requireReleaseCheckout(root, revision);
  const source = pinReleaseSource(root, revision);
  if (source.dateEpoch !== env.SOURCE_DATE_EPOCH) {
    throw new ScriptError("SOURCE_DATE_EPOCH must match the pinned source commit timestamp.");
  }
  const snapshot = mkdtempSync(join(tmpdir(), "game-kit-release-source-"));
  try {
    execFileSync("tar", ["-xf", "-", "-C", snapshot], { input: source.archive });
    symlinkSync(resolve(root, "node_modules"), join(snapshot, "node_modules"), "dir");
    return packageSnapshot(env, snapshot, destination);
  } finally {
    rmSync(snapshot, { force: true, recursive: true });
  }
}

main(import.meta.url, (args) => {
  if (args.length !== 1) {
    throw new ScriptError("Usage: package-source.ts <output-directory>", 2);
  }
  packageSource(process.env, process.cwd(), resolve(args[0]!));
});
