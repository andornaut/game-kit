// Fingerprint checkouts without opening credential-shaped paths or symlink targets.
import { execFileSync } from "node:child_process";
import { createHash, type Hash } from "node:crypto";
import { lstatSync, readFileSync, readlinkSync, statSync } from "node:fs";

import { errorMessage, ScriptError } from "./runtime.ts";

function gitBytes(root: string, args: string[]): Buffer {
  return execFileSync("git", ["-C", root, ...args], {
    maxBuffer: 1 << 30,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

/** NUL-separated entries, without empty ones. */
function split(output: Buffer): Buffer[] {
  const entries: Buffer[] = [];
  let start = 0;
  for (let index = output.indexOf(0); index !== -1; index = output.indexOf(0, start)) {
    entries.push(output.subarray(start, index));
    start = index + 1;
  }
  entries.push(output.subarray(start));
  return entries.filter((entry) => entry.length > 0);
}

function join(root: string, name: Buffer): Buffer {
  return Buffer.concat([Buffer.from(`${root}/`), name]);
}

/** Byte-exact path components, ignoring empty and current-directory segments. */
export function isCredentialPath(path: Buffer): boolean {
  return path
    .toString("latin1")
    .split("/")
    .some(
      (part) =>
        part === ".env" || part.startsWith(".env.") || part === ".ssh" || part === ".private",
    );
}

type Entry =
  | { kind: "file"; bytes: Buffer }
  | { kind: "link"; target: Buffer }
  | { kind: "other" }
  | { kind: "missing" };

function read(path: Buffer): Entry {
  let link;
  try {
    link = lstatSync(path);
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) {
      return { kind: "missing" };
    }
    throw error;
  }
  if (link.isSymbolicLink()) {
    return { kind: "link", target: readlinkSync(path, { encoding: "buffer" }) };
  }
  return statSync(path).isFile() ? { bytes: readFileSync(path), kind: "file" } : { kind: "other" };
}

/** Paths named by porcelain v1 `-z` status, including each rename or copy source. */
function dirtyPaths(status: Buffer): Buffer[] {
  const entries = split(status);
  const paths: Buffer[] = [];
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index] ?? Buffer.alloc(0);
    paths.push(entry.subarray(3));
    const code = entry.subarray(0, 2).toString("latin1");
    if (code.includes("R") || code.includes("C")) {
      index++;
      paths.push(entries[index] ?? Buffer.alloc(0));
    }
  }
  return paths;
}

function hashRoot(digest: Hash, root: string): void {
  const head = gitBytes(root, ["rev-parse", "HEAD"]);
  const status = gitBytes(root, ["status", "--porcelain=v1", "--untracked-files=all", "-z"]);
  const listing = gitBytes(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]);
  const dirty = dirtyPaths(status);
  // Check every listed and dirty name before reading any content.
  if ([...split(listing), ...dirty].some((name) => isCredentialPath(join(root, name)))) {
    throw new ScriptError("Refusing credential path in source fingerprint");
  }
  digest.update(root).update("\0").update(head).update(status);
  for (const name of dirty) {
    digest.update(name).update("\0");
    const entry = read(join(root, name));
    if (entry.kind === "link") {
      digest.update(entry.target);
    } else if (entry.kind === "file") {
      digest.update(entry.bytes);
    } else if (entry.kind === "other") {
      throw new ScriptError(`Unsupported dirty path in source fingerprint: ${name.toString()}`);
    } else {
      digest.update("missing\0");
    }
  }
}

/**
 * Hash each root's path, HEAD and status, and the bytes or link target of each dirty path.
 * Credential-shaped names in the tracked and unignored listing are refused before any read.
 */
export function sourceFingerprint(roots: string[]): string {
  const digest = createHash("sha256");
  for (const root of roots) {
    try {
      hashRoot(digest, root);
    } catch (error) {
      if (error instanceof ScriptError) {
        throw error;
      }
      throw new ScriptError(`Cannot read source fingerprint of ${root}: ${errorMessage(error)}`);
    }
  }
  return digest.digest("hex");
}
