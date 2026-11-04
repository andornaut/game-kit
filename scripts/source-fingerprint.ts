// Fingerprint source without opening credential-shaped paths or symlink targets.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readlinkSync, statSync } from "node:fs";

import { main, ScriptError } from "./runtime.ts";

function gitBytes(root: string, args: string[]): Buffer {
  return execFileSync("git", ["-C", root, ...args], {
    maxBuffer: 1 << 30,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function split(output: Buffer): Buffer[] {
  const entries: Buffer[] = [];
  let start = 0;
  for (let index = output.indexOf(0); index !== -1; index = output.indexOf(0, start)) {
    entries.push(output.subarray(start, index));
    start = index + 1;
  }
  entries.push(output.subarray(start));
  return entries;
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

/** Hash HEAD, status and every tracked or unignored path's bytes or link target. */
export function sourceFingerprint(root: string): string {
  try {
    const head = gitBytes(root, ["rev-parse", "HEAD"]);
    const status = gitBytes(root, ["status", "--porcelain=v1", "--untracked-files=all", "-z"]);
    const listing = gitBytes(root, [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
    ]);
    const unique = new Map(
      split(listing)
        .filter((name) => name.length > 0)
        .map((name) => [name.toString("latin1"), name]),
    );
    const names = [...unique.values()].sort(Buffer.compare);
    // Preflight every path before reading any content.
    if (names.some((name) => isCredentialPath(join(root, name)))) {
      throw new ScriptError("Refusing credential path in source fingerprint");
    }
    const digest = createHash("sha256").update(head).update(status);
    for (const name of names) {
      digest.update(name).update("\0");
      const entry = read(join(root, name));
      if (entry.kind === "link") {
        digest.update(entry.target);
      } else if (entry.kind === "file") {
        digest.update(entry.bytes);
      } else if (entry.kind === "other") {
        throw new ScriptError("Unsupported source path in fingerprint");
      } else {
        digest.update("missing\0");
      }
    }
    return digest.digest("hex");
  } catch (error) {
    if (error instanceof ScriptError) {
      throw error;
    }
    const cause = error instanceof Error ? error.message : String(error);
    throw new ScriptError(`Cannot read source fingerprint of ${root}: ${cause}`);
  }
}

/** Hash each root, its HEAD, its status and the content of every dirty path. */
export function dirtyFingerprint(roots: string[]): string {
  const digest = createHash("sha256");
  for (const root of roots) {
    digest.update(root).update(gitBytes(root, ["rev-parse", "HEAD"]));
    const status = gitBytes(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
    digest.update(status);
    const entries = split(status);
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index] ?? Buffer.alloc(0);
      if (entry.length === 0) {
        continue;
      }
      const name = entry.subarray(3);
      const code = entry.subarray(0, 2).toString("latin1");
      if (code.includes("R") || code.includes("C")) {
        index++;
        digest.update(entries[index] ?? Buffer.alloc(0));
      }
      const path = join(root, name);
      if (isCredentialPath(path)) {
        throw new ScriptError("Refusing credential path in dirty-file fingerprint");
      }
      const content = read(path);
      if (content.kind === "link") {
        digest.update(content.target);
      } else if (content.kind === "file") {
        digest.update(content.bytes);
      } else if (content.kind === "other") {
        throw new ScriptError(`Unsupported dirty path: ${name.toString()}`);
      }
    }
  }
  return digest.digest("hex");
}

main(import.meta.url, ([root]) => {
  if (root === undefined) {
    throw new ScriptError("Usage: source-fingerprint.ts <checkout>", 2);
  }
  console.log(sourceFingerprint(root));
});
