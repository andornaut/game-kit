import { execFileSync } from "node:child_process";

// What the build shows when it knows no commit: no CI variable and no git repository.
export const UNKNOWN_COMMIT = "dev";
const SHORT_LENGTH = 8;
const COMMIT_SHA = /^[0-9a-f]{40}$/;

// The variable Cloudflare Workers Builds sets to the commit it builds.
export const CI_COMMIT_VARIABLE = "WORKERS_CI_COMMIT_SHA";

// The build's commit, shortened to 8 characters: CI's variable, else readHead (git's HEAD),
// else UNKNOWN_COMMIT. A full hash shortened here, rather than git's --short, has the same
// length on every machine.
export function shortCommit(
  readHead: () => string,
  env: Readonly<Record<string, string | undefined>>,
): string {
  const fromCi = env[CI_COMMIT_VARIABLE]?.trim().toLowerCase() ?? "";
  if (COMMIT_SHA.test(fromCi)) {
    return fromCi.slice(0, SHORT_LENGTH);
  }
  try {
    const head = readHead().trim();
    return COMMIT_SHA.test(head) ? head.slice(0, SHORT_LENGTH) : UNKNOWN_COMMIT;
  } catch {
    return UNKNOWN_COMMIT;
  }
}

// HEAD's full hash. Throws when git is missing or dir is not in a repository.
export function gitHead(dir: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}
