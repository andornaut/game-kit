import { execFileSync } from "node:child_process";

// HEAD's full hash, for web/build/buildVersion's shortCommit. Throws when git is missing or dir
// is not in a repository.
export function gitHead(dir: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}
