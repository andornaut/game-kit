// The pure decisions behind the router worker (dom/serviceWorker): which requests it answers,
// the build a saved manifest describes, and which client pins a prune may delete.
import { type BuildFile, pinRecordPath } from "./buildContract.ts";
import { parseBuildManifest, verifiedJsonFamilies } from "./buildRecords.ts";
import type { VerifiedJsonBody } from "./verifiedJsonBody.ts";

// The shortest time between pin prunes that navigations start. A pin this worker wrote within it
// is never pruned, because a navigation's client is not listed until its document runs.
export const PIN_PRUNE_MS = 60_000;

const PIN_PREFIX = pinRecordPath("");

export interface RouterBuild {
  readonly version: string;
  // Each file by its logical URL.
  readonly files: ReadonlyMap<string, BuildFile>;
  // The verified JSON family of each member URL.
  readonly families: ReadonlyMap<string, VerifiedJsonBody>;
}

/** The build of a saved manifest, or undefined where it is missing, invalid or another version's. */
export function routerBuild(version: string, value: unknown): RouterBuild | undefined {
  try {
    const manifest = parseBuildManifest(value);
    if (manifest.version !== version) {
      return undefined;
    }
    return {
      families: verifiedJsonFamilies(manifest),
      files: new Map(manifest.files.map((file) => [file.url, file])),
      version,
    };
  } catch {
    return undefined;
  }
}

/**
 * Whether the router answers a request. A no-store request, such as the page installer's
 * download of a newer build's unhashed file at a URL the active build also lists, asks for the
 * network, so the browser answers it. The installer fetches hashed files in the default mode, and
 * serving one from the document's build is correct because a hashed URL always has the same
 * bytes.
 */
export function routesRequest(
  origin: string,
  request: { readonly cache: string; readonly method: string; readonly origin: string },
): boolean {
  return request.method === "GET" && request.cache !== "no-store" && request.origin === origin;
}

/** Whether a periodic task that last ran at `last` may run again at `now`. */
export function intervalElapsed(
  now: number,
  last: number | undefined,
  intervalMs: number,
): boolean {
  return last === undefined || now - last >= intervalMs;
}

/** The client a records-cache entry at `path` pins, or undefined for any other record. */
export function pinnedClient(path: string): string | undefined {
  return path.startsWith(PIN_PREFIX)
    ? decodeURIComponent(path.slice(PIN_PREFIX.length))
    : undefined;
}

/** The clients whose pins this worker wrote at least PIN_PRUNE_MS before `now`. */
export function settledPins(now: number, pinnedAt: ReadonlyMap<string, number>): string[] {
  return [...pinnedAt].filter(([, time]) => now - time >= PIN_PRUNE_MS).map(([client]) => client);
}
