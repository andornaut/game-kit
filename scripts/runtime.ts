// Shared host policy for the containers that verify, package and prove the kit.
import { execFileSync, spawnSync, type SpawnSyncOptions } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The dedicated container identity, which owns nothing on the host. */
export const CONTAINER_UID = 19001;
export const MAX_LOAD = 24;
export const DEFAULT_NPM_CACHE_VOLUME = "game-kit-npm-cache";
// Mounted where the image holds a sticky world-writable directory, which a new volume inherits.
export const NPM_CACHE_MOUNT = "/var/tmp";

/** A failure whose message is the whole report, with the process exit status to use. */
export class ScriptError extends Error {
  readonly status: number;
  constructor(message: string, status = 1) {
    super(message);
    this.status = status;
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function nodeImage(root: string): string {
  return `node:${readFileSync(join(root, ".nvmrc"), "utf8").trim().replace(/^v/, "")}`;
}

/** The one-minute load, or `GAME_KIT_LOAD` when a test supplies it. */
export function hostLoad(env: NodeJS.ProcessEnv = process.env): number {
  return env.GAME_KIT_LOAD === undefined ? (loadavg()[0] ?? Number.NaN) : Number(env.GAME_KIT_LOAD);
}

export function requireLoad(load: number = hostLoad()): void {
  if (!(Number.isFinite(load) && load < MAX_LOAD)) {
    throw new ScriptError(
      `One-minute load must be available and below ${MAX_LOAD} before starting a container.`,
    );
  }
}

export function npmCacheVolume(env: NodeJS.ProcessEnv): string {
  const name = env.GAME_KIT_NPM_CACHE || DEFAULT_NPM_CACHE_VOLUME;
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)) {
    throw new ScriptError("GAME_KIT_NPM_CACHE must name a Docker volume, not a path.", 2);
  }
  return name;
}

/** Identity, CPU and read-only options shared by every container; checkout groups grant reads. */
export function containerOptions(...checkouts: string[]): string[] {
  const id = `${CONTAINER_UID}:${CONTAINER_UID}`;
  const groups = new Set(checkouts.map((checkout) => String(statSync(checkout).gid)));
  return [
    ...["--read-only", "--cpus", "4", "--user", id],
    ...[...groups].flatMap((group) => ["--group-add", group]),
    ...["-e", "HOME=/tmp"],
    // A per-run volume rather than tmpfs, so results survive for docker cp after exit.
    ...["--mount", "type=volume,dst=/tmp"],
  ];
}

export function readOnlyMount(source: string, target: string): string[] {
  return ["--mount", `type=bind,source=${source},target=${target},readonly`];
}

export function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

export interface ContainerRun {
  /** Host directory receiving the contents of `from` after the container exits. */
  copyOut?: { from: string; to: string };
  input?: Buffer;
  /** Destination of the container's stdout and stderr: inherited, or an open file descriptor. */
  output?: "inherit" | number;
}

function docker(args: string[], options: SpawnSyncOptions = {}): string {
  const result = spawnSync("docker", args, { encoding: "utf8", ...options });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new ScriptError(`docker ${args[0]} exited with status ${result.status}.`);
  }
  return String(result.stdout ?? "").trim();
}

/** Run one container to completion, copy its results out as the host user, then remove it. */
export function runContainer(
  { copyOut, input, output = "inherit" }: ContainerRun,
  args: string[],
): void {
  const create = input === undefined ? ["create"] : ["create", "--interactive"];
  const id = docker([...create, ...args], { stdio: ["ignore", "pipe", "inherit"] });
  try {
    const start = input === undefined ? ["start", "--attach"] : ["start", "--attach", "-i"];
    const result = spawnSync("docker", [...start, id], {
      input,
      stdio: [input === undefined ? "ignore" : "pipe", output, output],
    });
    if (result.error) {
      throw result.error;
    }
    let copied = true;
    if (copyOut) {
      copied =
        spawnSync("docker", ["cp", `${id}:${copyOut.from}/.`, copyOut.to], { stdio: "inherit" })
          .status === 0;
    }
    if (result.status !== 0) {
      throw new ScriptError(`Container exited with status ${result.status}.`);
    }
    if (!copied) {
      throw new ScriptError(`Cannot copy ${copyOut?.from} out of the container.`);
    }
  } finally {
    spawnSync("docker", ["rm", "--force", "--volumes", id], { stdio: "ignore" });
  }
}

/** Run a script's entry point when it is the process main module. */
export function main(url: string, entry: (args: string[]) => void): void {
  const invoked = process.argv[1];
  if (invoked === undefined || realpathSync(invoked) !== fileURLToPath(url)) {
    return;
  }
  try {
    entry(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = error instanceof ScriptError ? error.status : 1;
  }
}
