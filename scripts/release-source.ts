import { execFileSync } from "node:child_process";

import { git, ScriptError } from "./runtime.ts";
import { isCredentialPath } from "./source-fingerprint.ts";

export interface ReleaseSource {
  readonly archive: Buffer;
  readonly dateEpoch: string;
  readonly image: string;
  readonly revision: string;
}

export function requireReleaseCheckout(root: string, revision: string): void {
  if (git(root, "rev-parse", "HEAD") !== revision) {
    throw new ScriptError("The release checkout HEAD must match SOURCE_COMMIT.");
  }
  if (git(root, "status", "--porcelain=v1", "--untracked-files=all") !== "") {
    throw new ScriptError(
      "Release verification requires a clean checkout. Use make check for working-tree checks.",
    );
  }
}

export function pinReleaseSource(
  root: string,
  revision = git(root, "rev-parse", "HEAD"),
): ReleaseSource {
  const listed = git(root, "ls-tree", "-r", "-z", "--name-only", revision);
  if (listed.split("\0").some((name) => isCredentialPath(Buffer.from(name)))) {
    throw new ScriptError("Refusing credential path in release source");
  }
  return {
    archive: execFileSync("git", ["-C", root, "archive", revision], { maxBuffer: 1 << 30 }),
    dateEpoch: git(root, "show", "-s", "--format=%ct", revision),
    image: `node:${git(root, "show", `${revision}:.nvmrc`).replace(/^v/, "")}`,
    revision,
  };
}
