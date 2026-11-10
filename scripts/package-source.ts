// Compile and pack the source already isolated by the host launcher.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { main, ScriptError } from "./runtime.ts";

export function buildProvenance(env: NodeJS.ProcessEnv): {
  revision: string;
  snapshot:
    { revision: string; sha256: string; dirty: boolean; scope: "private-check-build" } | undefined;
} {
  const revision = env.CHECK_REVISION ?? env.SOURCE_COMMIT;
  if (!revision || !/^[0-9a-f]{40}$/.test(revision)) {
    throw new ScriptError("A full source revision is required to package the kit.");
  }
  if (!env.SOURCE_DATE_EPOCH || !/^[0-9]+$/.test(env.SOURCE_DATE_EPOCH)) {
    throw new ScriptError("SOURCE_DATE_EPOCH must name the source commit timestamp.");
  }
  if (env.CHECK_REVISION === undefined) {
    return { revision, snapshot: undefined };
  }
  if (
    !env.CHECK_SOURCE_SHA256 ||
    !/^[0-9a-f]{64}$/.test(env.CHECK_SOURCE_SHA256) ||
    (env.CHECK_SOURCE_DIRTY !== "true" && env.CHECK_SOURCE_DIRTY !== "false")
  ) {
    throw new ScriptError("Snapshot hash and dirty state are required for an isolated build.");
  }
  if (env.CHECK_EXPORT === "1") {
    if (env.CHECK_SOURCE_DIRTY !== "false") {
      throw new ScriptError("Exported release artifacts require a clean source snapshot.");
    }
    return { revision, snapshot: undefined };
  }
  return {
    revision,
    snapshot: {
      dirty: env.CHECK_SOURCE_DIRTY === "true",
      revision,
      scope: "private-check-build",
      sha256: env.CHECK_SOURCE_SHA256,
    },
  };
}

export function packageSource(env: NodeJS.ProcessEnv, root: string, destination: string): string {
  const provenance = buildProvenance(env);
  const staging = mkdtempSync(join(tmpdir(), "game-kit-package-"));
  mkdirSync(destination, { recursive: true });
  execFileSync(process.execPath, ["scripts/release-build.ts", staging], {
    cwd: root,
    env,
    stdio: "inherit",
  });
  const sourceCommit = provenance.snapshot?.dirty ? "UNCOMMITTED\n" : `${provenance.revision}\n`;
  writeFileSync(join(staging, "SOURCE_COMMIT"), sourceCommit);
  if (provenance.snapshot) {
    writeFileSync(
      join(staging, "SOURCE_CHECK.json"),
      `${JSON.stringify(provenance.snapshot, null, 2)}\n`,
    );
    const file = join(staging, "package.json");
    const manifest = JSON.parse(readFileSync(file, "utf8"));
    manifest.files.push("SOURCE_CHECK.json");
    writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  const packed = execFileSync(
    "npm",
    ["pack", "--offline", "--ignore-scripts", "--json", "--pack-destination", resolve(destination)],
    { cwd: staging, env, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  const metadata = JSON.parse(packed) as { filename: string; version: string }[];
  const item = metadata[0]!;
  const filename = `game-kit-${item.version}.tgz`;
  const artifact = join(destination, filename);
  renameSync(join(destination, item.filename), artifact);
  writeFileSync(join(destination, "pack.json"), packed);
  writeFileSync(join(destination, "SOURCE_COMMIT"), sourceCommit);
  writeFileSync(
    join(destination, "SHA256SUMS"),
    `${createHash("sha256").update(readFileSync(artifact)).digest("hex")}  ${filename}\n`,
  );
  if (provenance.snapshot) {
    writeFileSync(
      join(destination, "SOURCE_CHECK.json"),
      `${JSON.stringify(provenance.snapshot, null, 2)}\n`,
    );
  }
  return artifact;
}

main(import.meta.url, (args) => {
  if (args.length !== 1) {
    throw new ScriptError("Usage: package-source.ts <output-directory>", 2);
  }
  packageSource(process.env, process.cwd(), resolve(args[0]!));
});
