// What the build shows when it knows no commit: no CI variable and no git repository.
export const UNKNOWN_COMMIT = "dev";
const SHORT_LENGTH = 8;
const COMMIT_SHA = /^[0-9a-f]{40}$/;

// The variable Cloudflare Workers Builds sets to the commit it builds.
export const CI_COMMIT_VARIABLE = "WORKERS_CI_COMMIT_SHA";

// The build's commit, shortened to 8 characters: env's CI_COMMIT_VARIABLE, else readHead (git's
// HEAD, such as web/build/vite/gitHead), else UNKNOWN_COMMIT. A full hash shortened here, rather
// than git's --short, has the same length on every machine.
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
