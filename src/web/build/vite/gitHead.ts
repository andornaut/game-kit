import { execFileSync } from "node:child_process";

import { type BuildMetadata, buildMetadata } from "../buildVersion.ts";

// Shared HEAD/status evidence for app metadata and grouped precache validation.
// Untracked nonignored files count as a dirty source tree.
export function gitBuildMetadata(
  dir: string,
  env: Readonly<Record<string, string | undefined>>,
): BuildMetadata {
  return buildMetadata(() => {
    const head = gitHead(dir);
    let dirty = true;
    try {
      dirty =
        execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
          cwd: dir,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim().length !== 0;
    } catch {
      // Unknown cleanliness withholds grouped identity while retaining the legacy HEAD label.
    }
    return { dirty, head };
  }, env);
}

// HEAD's full hash, for web/build/buildVersion's shortCommit. Throws when git is missing or dir
// is not in a repository.
export function gitHead(dir: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}
