// Host orchestration for working-tree verification and committed release proof.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { loadavg, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CHECK_EVIDENCE,
  isWorkingTreePart,
  NPM_CACHE_MISS,
  type WorkingTreePart,
} from "./container-check.ts";
import { pinReleaseSource, requireReleaseCheckout } from "./release-source.ts";
import {
  CONTAINER_UID,
  type ContainerRun,
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
import { isStockExcluded, sourceFingerprint } from "./source-fingerprint.ts";

// A working-tree check runs every part, or only the part named.
type CheckMode =
  | { mode: "working-tree"; part?: WorkingTreePart }
  | { mode: "release"; releaseDirectory: string | undefined };

function memoryLimit(value = "4g"): string {
  const parts = /^([+]?\d+(?:\.\d*)?|[+]?\.\d+)(e[+-]?\d+)? *(b|[kmgtp](?:b|ib)?)?$/i.exec(value);
  const unit = parts?.[3]?.[0]?.toLowerCase() ?? "b";
  const bytes = Number((parts?.[1] ?? "NaN") + (parts?.[2] ?? "")) * 1024 ** "bkmgtp".indexOf(unit);
  if (!Number.isFinite(bytes) || bytes < 1 || bytes > 4 * 1024 ** 3) {
    throw new ScriptError("CHECK_MEMORY must be a positive Docker size at or below 4 GiB.", 2);
  }
  return String(Math.floor(bytes));
}

function allowContainerReads(directory: string): void {
  chmodSync(directory, (statSync(directory).mode & 0o777) | 0o555);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      allowContainerReads(path);
    } else if (entry.isFile()) {
      chmodSync(path, (statSync(path).mode & 0o777) | 0o444);
    }
  }
}

function admitContainer(): void {
  let load = loadavg()[0]!;
  if (!(load < 20)) {
    const deadline = performance.now() + 15 * 60_000;
    const wait = new Int32Array(new SharedArrayBuffer(4));
    console.log(`Waiting for one-minute load below 20 (current ${load}).`);
    while (!(load < 20)) {
      const remaining = deadline - performance.now();
      if (remaining <= 0) {
        throw new ScriptError(
          `One-minute load stayed at or above 20 for 15 minutes (current ${load}).`,
        );
      }
      Atomics.wait(wait, 0, 0, Math.min(remaining, 10_000));
      load = loadavg()[0]!;
    }
  }
  console.log(`Starting check container at one-minute load ${load}.`);
}

function checkFingerprint(
  root: string,
  mode: CheckMode["mode"],
  before: string,
  failure: unknown,
): string {
  const also = failure === undefined ? "" : `\nThe gate also failed: ${errorMessage(failure)}`;
  let after;
  try {
    after = sourceFingerprint([root], mode);
  } catch (error) {
    throw new ScriptError(
      `Cannot verify source fingerprints: ${errorMessage(error)}${also}\nDiscard the gate result.`,
    );
  }
  if (after !== before) {
    throw new ScriptError(`Source changed during verification.${also}\nDiscard the gate result.`);
  }
  return after;
}

export function checkLocal(env: NodeJS.ProcessEnv, checkout: string, options: CheckMode): void {
  const root = realpathSync(checkout);
  const cache = options.mode === "release" ? npmCacheVolume(env) : undefined;
  const before = sourceFingerprint([root], options.mode);
  const scratch = mkdtempSync(join(tmpdir(), "game-kit-check-"));
  let evidence: string | undefined;
  try {
    const revision = options.mode === "release" ? git(root, "rev-parse", "HEAD") : undefined;
    if (revision !== undefined) {
      requireReleaseCheckout(root, revision);
    }
    const release =
      revision === undefined ? undefined : pinReleaseSource(root, revision, isStockExcluded);
    let source = "";
    if (release === undefined) {
      // Keep using the same allowlisted source copy as the stock e2e wrapper.
      source = execFileSync(
        "bash",
        [
          "--norc",
          "-euc",
          [
            'source "$1/tests/container/stock"',
            'stock_begin "$1"',
            "stock_copy_source",
            "trap - EXIT",
            'printf "%s" "$stock_source"',
          ].join("\n"),
          "check-source",
          root,
        ],
        { encoding: "utf8", env: { ...env, BASH_ENV: "/dev/null", TMPDIR: scratch } },
      );
    } else {
      source = join(scratch, "source");
      mkdirSync(source);
      // The stock ShellCheck image only contains its binary. Give it the same pinned bytes.
      execFileSync("tar", ["-xf", "-", "-C", source], { input: release.archive });
      allowContainerReads(source);
      const localEvidence = join(root, ".claude");
      mkdirSync(localEvidence, { recursive: true });
      evidence = mkdtempSync(join(localEvidence, "artifact-check."));
      writeFileSync(join(evidence, "SOURCE_COMMIT"), `${release.revision}\n`);
      const archiveHash = createHash("sha256").update(release.archive).digest("hex");
      writeFileSync(join(evidence, "archive.sha256"), `${archiveHash}\n`);
      console.log(`Pinned release source ${release.revision}, archive SHA-256 ${archiveHash}`);
      writeFileSync(join(evidence, "source.before"), `${before}\n`);
    }
    checkFingerprint(root, options.mode, before, undefined);
    const id = `${CONTAINER_UID}:${CONTAINER_UID}`;
    const nofile = env.CHECK_NOFILE || "256";
    const memory = memoryLimit(env.CHECK_MEMORY || undefined);
    const workOptions = `rw,exec,nosuid,size=${env.CHECK_WORK_SIZE || "2g"},mode=1777`;
    const work = ["--tmpfs", `/work:${workOptions},uid=${CONTAINER_UID},gid=${CONTAINER_UID}`];
    const archive = "tar -xf - -C /work";
    const limits = [
      "--user",
      id,
      "--cpus",
      "4",
      "--memory",
      memory,
      "--ulimit",
      `nofile=${nofile}:${nofile}`,
      "--pids-limit",
      "512",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--env",
      "HOME=/tmp",
      "--env",
      "TMPDIR=/scratch",
      "--workdir",
      "/work",
      "--tmpfs",
      `/scratch:rw,exec,nosuid,size=${env.CHECK_SCRATCH_SIZE || "1g"},mode=1777`,
    ];
    function launch(args: string[], network: "none" | "bridge", run: ContainerRun = {}): void {
      admitContainer();
      runContainer(
        {
          ...run,
          timeout: env.CHECK_TIMEOUT_SECONDS || "900",
        },
        [
          ...limits,
          ...["--network", network],
          ...(run.copyOut === undefined
            ? ["--tmpfs", `/tmp:rw,exec,nosuid,size=${env.CHECK_TMP_SIZE || "1g"},mode=1777`]
            : ["--mount", "type=volume,target=/tmp"]),
          ...args,
        ],
      );
    }
    function node(task: string[], network: "none" | "bridge", copyTo?: string): void {
      const stage = release === undefined ? "cp -R -P /source/. /work/" : archive;
      launch(
        [
          ...(release === undefined ? readOnlyMount(source, "/source") : []),
          ...work,
          ...(cache === undefined
            ? []
            : [
                "--mount",
                `type=volume,source=${cache},target=${NPM_CACHE_MOUNT}`,
                "--env",
                `npm_config_cache=${NPM_CACHE_MOUNT}`,
              ]),
          "--entrypoint",
          "/bin/sh",
          release?.image ?? (env.NODE_IMAGE || nodeImage(source)),
          "-ec",
          `${stage}\nexec sh tests/container/node "$@"`,
          "check-node",
          ...task,
        ],
        network,
        {
          ...(release === undefined ? {} : { input: release.archive }),
          ...(copyTo === undefined ? {} : { copyOut: { from: CHECK_EVIDENCE, to: copyTo } }),
        },
      );
    }
    const part = options.mode === "working-tree" ? options.part : undefined;
    let failure: unknown;
    try {
      const shellcheck = env.SHELLCHECK_IMAGE || "koalaman/shellcheck:v0.11.0";
      if (part === undefined || part === "lint") {
        launch(
          [
            ...readOnlyMount(source, "/work"),
            ...["--entrypoint", "/bin/shellcheck", shellcheck],
            ...[
              "-x",
              "-P",
              "SCRIPTDIR",
              "tests/container/stock",
              "tests/container/check-stock",
              "tests/container/node",
              "tests/container/e2e",
            ],
          ],
          "none",
        );
      }
      if (release === undefined || evidence === undefined) {
        node(["working-tree", ...(part === undefined ? [] : [part])], "bridge");
      } else {
        console.log("Checking types, lint and tests offline in a fresh container.");
        try {
          node(["release"], "none", evidence);
        } catch (error) {
          const marker = join(evidence, NPM_CACHE_MISS);
          if (!existsSync(marker)) {
            throw error;
          }
          rmSync(marker);
          console.log("The npm cache is incomplete; populating it in a container.");
          node(["fill-cache"], "bridge");
          node(["release"], "none", evidence);
        }
        console.log("Packing and checking the tarball offline in a fresh container.");
        node(["artifact", release.revision, release.dateEpoch], "none", evidence);
      }
    } catch (error) {
      failure = error;
    }
    const after = checkFingerprint(root, options.mode, before, failure);
    console.log(`Source fingerprints matched: ${before}`);
    if (evidence !== undefined) {
      writeFileSync(join(evidence, "source.after"), `${after}\n`);
    }
    if (failure !== undefined) {
      throw failure;
    }
    if (
      options.mode === "release" &&
      options.releaseDirectory !== undefined &&
      evidence !== undefined
    ) {
      const destination = resolve(options.releaseDirectory);
      const artifacts = join(evidence, "release");
      mkdirSync(destination, { recursive: true });
      for (const file of readdirSync(artifacts)) {
        copyFileSync(join(artifacts, file), join(destination, file));
      }
      console.log(`Checked release artifacts: ${destination}`);
    }
    if (evidence !== undefined) {
      rmSync(evidence, { force: true, recursive: true });
    }
  } catch (error) {
    if (evidence !== undefined) {
      console.error(`Artifact evidence: ${evidence}`);
    }
    throw error;
  } finally {
    rmSync(scratch, { force: true, recursive: true });
  }
}

main(import.meta.url, (args) => {
  const [part, ...rest] = args;
  if (rest.length !== 0 || (part !== undefined && !isWorkingTreePart(part))) {
    throw new ScriptError("Usage: check-stock [lint|test|build]", 2);
  }
  checkLocal(process.env, resolve(dirname(fileURLToPath(import.meta.url)), ".."), {
    mode: "working-tree",
    ...(part === undefined ? {} : { part }),
  });
});
