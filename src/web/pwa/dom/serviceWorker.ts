// The service worker's behaviour. A game's worker entry calls runServiceWorker with its cache
// policy and the precache manifest the build writes in (vite/precachePlugin), and the plugin
// builds the entry to one classic script. The worker runs in a ServiceWorkerGlobalScope, which the
// DOM typings do not describe, so the few members it uses are declared here.
import {
  ASSET_GROUPS_MESSAGE,
  type AssetGroupsRequest,
  type AssetGroupsResult,
} from "../assetGroups.ts";
import { isBuildId } from "../buildIdentity.ts";
import {
  cachedUrlsOf,
  cacheKeyFor,
  cacheNameFor,
  type CachePolicy,
  digestContentHash,
  installPlan,
  installUrls,
  precacheFetchOptions,
  staleCacheNames,
  strategyFor,
} from "../cachePolicy.ts";
import {
  createDownloadProgress,
  DOWNLOAD_PROGRESS_MESSAGE,
  type DownloadProgress,
} from "../downloadProgress.ts";
import { basePrecacheUrls, precacheGroupUrls, validatePrecacheGroups } from "../precacheGroups.ts";
import type { PrecacheManifest } from "../precacheManifest.ts";
import {
  decodePrecacheManifest,
  encodePrecacheManifest,
  type PrecacheManifestWire,
} from "../precacheWire.ts";
import type { SoundFormatParam } from "../serviceWorkerUrl.ts";
import type { SkipWaitingMessage } from "../updateReady.ts";
import {
  validateVerifiedJsonBodies,
  verifiedJsonAliasCachePrefix,
  type VerifiedJsonBody,
} from "../verifiedJsonBody.ts";
import { createGroupStore } from "./groupStore.ts";

interface LifecycleEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}

interface FetchRequestEvent extends LifecycleEvent {
  readonly request: Request;
  readonly clientId: string;
  readonly resultingClientId: string;
  respondWith(response: Promise<Response>): void;
}

interface MessageRequestEvent extends MessageEvent {
  waitUntil(promise: Promise<unknown>): void;
}

interface WorkerInstance {
  postMessage(message: unknown, transfer: Transferable[]): void;
}

interface BuildRecord {
  readonly manifest: PrecacheManifest;
  readonly urls: readonly string[];
}

interface WorkerScope {
  readonly registration: { readonly active: WorkerInstance | null };
  readonly clients: {
    matchAll(options: {
      includeUncontrolled: boolean;
      type: "window";
    }): Promise<readonly { id: string }[]>;
  };
  addEventListener(type: "activate" | "install", listener: (event: LifecycleEvent) => void): void;
  addEventListener(type: "fetch", listener: (event: FetchRequestEvent) => void): void;
  addEventListener(type: "message", listener: (event: MessageRequestEvent) => void): void;
  readonly location: { readonly href: string; readonly origin: string };
  skipWaiting(): Promise<void>;
}

const SOUND_FORMAT_PARAM: SoundFormatParam = "sound";
const SKIP_WAITING: SkipWaitingMessage = "skip-waiting";
const ROUTING_CAPABILITY = "game-kit-routing-capability";

interface VerifiedSource {
  readonly family: VerifiedJsonBody;
  readonly origin: string;
}
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
};
// Response headers that change what a verified JSON body means or which cached response it is.
// Any other header, such as a CDN's transport or diagnostic headers (priority, server-timing),
// carries no body semantics and is ignored. content-type, cache-control, vary, content-encoding,
// content-length and x-content-type-options are checked by value below.
const JSON_SEMANTIC_HEADERS = [
  "clear-site-data",
  "content-disposition",
  "content-location",
  "content-range",
  "refresh",
  "set-cookie",
] as const;
const dataProfile = (verified: VerifiedSource | undefined) =>
  verified?.family.responseProfile === "fetch-json-data-v1";
const hasDataProfile = (build: PrecacheManifest) =>
  build.verifiedJsonBodies?.some((family) => family.responseProfile === "fetch-json-data-v1") ===
  true;

function safeJsonSource(verified: VerifiedSource, url: string, response: Response): boolean {
  const headers = response.headers;
  if (
    response.status !== 200 ||
    response.redirected ||
    !/^application\/json(?:\s*;\s*charset\s*=\s*(?:"utf-8"|utf-8))?\s*$/i.test(
      headers.get("content-type") ?? "",
    ) ||
    JSON_SEMANTIC_HEADERS.some((name) => headers.has(name)) ||
    /(?:^|,)\s*(?:private|no-store)(?:\s|,|=|$)/i.test(headers.get("cache-control") ?? "") ||
    (headers.get("vary") ?? "")
      .split(",")
      .some((name) => name.trim() !== "" && name.trim().toLowerCase() !== "accept-encoding") ||
    (headers.has("x-content-type-options") &&
      headers.get("x-content-type-options")?.toLowerCase() !== "nosniff")
  ) {
    return false;
  }
  const encoding = headers.get("content-encoding")?.toLowerCase();
  if (
    encoding !== undefined &&
    !["identity", "gzip", "br", "deflate", ...(dataProfile(verified) ? ["zstd"] : [])].includes(
      encoding,
    )
  ) {
    return false;
  }
  const length = headers.get("content-length");
  if (
    length !== null &&
    (!/^\d+$/.test(length) ||
      !Number.isSafeInteger(Number(length)) ||
      ((encoding === undefined || encoding === "identity") &&
        Number(length) !== verified.family.byteSize))
  ) {
    return false;
  }
  if (response.url === "") {
    // An empty URL is not provenance: only the canonical header profile can qualify, and the
    // caller must still re-read and fully verify the body. Real fetches require a source URL.
    return (
      [...headers].length === Object.keys(JSON_HEADERS).length &&
      Object.entries(JSON_HEADERS).every(([name, value]) => headers.get(name) === value)
    );
  }
  return (
    new URL(response.url).origin === verified.origin &&
    response.url === new URL(url, verified.origin).href
  );
}
const digestHex = (digest: ArrayBuffer) =>
  [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
const jsonResponse = (body: ArrayBuffer) => new Response(body, { headers: JSON_HEADERS });

// Only a whole response is stored: Cache.put rejects a 206, which an audio element's range
// request can get. Validate before answering, even when the cache write cannot succeed.
async function fetchAndStore(
  cache: Cache,
  contentHash: string | undefined,
  byteSize: number | undefined,
  key: string,
  verified: VerifiedSource | undefined,
  request: Request,
): Promise<Response> {
  const response = await fetch(
    verified === undefined
      ? request
      : new Request(request, { credentials: "omit", redirect: "error" }),
  );
  if (verified !== undefined && (response.url === "" || !safeJsonSource(verified, key, response))) {
    throw new TypeError("Unsafe verified JSON response semantics");
  }
  if (
    (contentHash !== undefined || byteSize !== undefined) &&
    (response.status !== 200 || !(await responseMatches(contentHash, byteSize, verified, response)))
  ) {
    throw new TypeError(`Response does not match the active build for ${key}`);
  }
  if (response.status === 200) {
    await cache.put(key, response.clone()).catch(() => undefined);
  }
  return response;
}

// How many stored copies an install reads at once. A copy checked by its content hash is read
// whole, so the bound caps the bytes held in memory.
const REUSE_CONCURRENCY = 16;

// How many files an install fetches at once. With low priority, the bound leaves the page's own
// requests most of the link.
const PRECACHE_CONCURRENCY = 4;

// The waits before a file's second and third fetch: each file gets one attempt plus one per wait.
const PRECACHE_RETRY_DELAYS_MS = [1000, 3000] as const;

// How long one fetch attempt may take, headers, body and write included, before it is aborted and
// counts as failed, so a request that never answers cannot hold an install open. The same as the
// Phaser loader's timeout (load/loaderConfig).
const PRECACHE_TIMEOUT_MS = 30_000;

// How many failed URLs the install's error names; the count covers the rest.
const FAILED_URLS_LOGGED = 10;

// Runs task on each item, at most limit at a time, and returns the results in item order.
async function mapBounded<T, R>(
  limit: number,
  task: (item: T) => Promise<R>,
  items: readonly T[],
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      // Each lane takes the next item once its last one is done.
      // eslint-disable-next-line no-await-in-loop
      results[index] = await task(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}

// Check recorded size and content identity from one clone, leaving the response reusable.
async function responseMatches(
  contentHash: string | undefined,
  byteSize: number | undefined,
  verified: VerifiedSource | undefined,
  response: Response,
): Promise<boolean> {
  if (verified !== undefined && !safeJsonSource(verified, response.url || "/", response)) {
    return false;
  }
  if (contentHash === undefined && byteSize === undefined && verified === undefined) {
    return true;
  }
  const body = await response.clone().arrayBuffer();
  if (byteSize !== undefined && body.byteLength !== byteSize) {
    return false;
  }
  if (contentHash === undefined && verified === undefined) {
    return true;
  }
  const digest = await crypto.subtle.digest("SHA-256", body);
  return (
    (verified === undefined || digestHex(digest) === verified.family.sha256) &&
    (contentHash === undefined || digestContentHash(new Uint8Array(digest)) === contentHash)
  );
}

// The first copy of url that holders still store and, where contentHash is given, whose bytes
// have it. An earlier version's copy can be gone by now: another worker's activate deletes the
// caches it replaces.
async function storedCopy(
  holders: readonly Cache[],
  contentHash: string | undefined,
  byteSize: number | undefined,
  verified: VerifiedSource | undefined,
  url: string,
): Promise<Response | undefined> {
  for (const old of holders) {
    // Earlier caches are tried in turn, stopping at the first copy that qualifies.
    // eslint-disable-next-line no-await-in-loop
    const response = await old.match(url);
    if (response === undefined) {
      continue;
    }

    if (verified !== undefined && !safeJsonSource(verified, url, response)) {
      continue;
    }
    // The cache search reads one candidate at a time.
    // eslint-disable-next-line no-await-in-loop
    const matches = await responseMatches(contentHash, byteSize, verified, response);
    if (matches) {
      return response;
    }
  }
  return undefined;
}

// This version's own caches hold only entries that passed their checks when stored, so a switch
// or activation proves an ordinary entry by presence instead of re-hashing every file within its
// deadline. Verified JSON bodies and earlier versions' caches are still verified by storedCopy.
async function presentCopy(holders: readonly Cache[], url: string): Promise<Response | undefined> {
  for (const own of holders) {
    // eslint-disable-next-line no-await-in-loop
    const response = await own.match(url);
    if (response !== undefined) {
      return response;
    }
  }
  return undefined;
}

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

// Cache writes have no AbortSignal parameter. A late file alone never publishes readiness.
function untilAborted<T>(signal: AbortSignal, pending: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
    }
    void pending.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

interface PrecacheFailure {
  readonly error: unknown;
  readonly url: string;
}

// Fetches url at low priority and stores it in cache, trying once plus once per retry delay. A
// response that is not ok, bytes that lack url's content hash in contentHashes
// (PrecacheManifest's) where it has one, a write that fails, or an attempt still unfinished after
// PRECACHE_TIMEOUT_MS, counts as a failed attempt.
// Returns the last error once every attempt has failed. A hashed build file has no recorded
// hash: its name is its identity.
async function fetchIntoCache(
  policy: CachePolicy,
  contentHashes: Readonly<Record<string, string>>,
  cache: Cache,
  byteSize: number | undefined,
  progress: ReturnType<typeof createDownloadProgress>,
  verified: VerifiedSource | undefined,
  activity: () => void,
  url: string,
): Promise<PrecacheFailure | undefined> {
  let error: unknown;
  for (let attempt = 0; attempt <= PRECACHE_RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) {
      // Attempts are sequential: each waits out the backoff after the one before.
      // eslint-disable-next-line no-await-in-loop
      await wait(PRECACHE_RETRY_DELAYS_MS[attempt - 1] as number);
    }
    const abort = new AbortController();
    progress.attempt(url);
    activity();
    const timer = setTimeout(() => {
      abort.abort(new Error(`No answer within ${PRECACHE_TIMEOUT_MS} ms for ${url}`));
    }, PRECACHE_TIMEOUT_MS);
    try {
      // eslint-disable-next-line no-await-in-loop
      const response = await fetch(
        new Request(url, {
          ...precacheFetchOptions(policy, url),
          ...(verified === undefined
            ? {}
            : { credentials: "omit" as const, redirect: "error" as const }),
          priority: "low",
          signal: abort.signal,
        }),
      );
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }
      if (
        verified !== undefined &&
        (response.url === "" || !safeJsonSource(verified, url, response))
      ) {
        throw new TypeError("Unsafe verified JSON response semantics");
      }
      const expected = contentHashes[url];
      // Read a clone once for streamed accounting and the existing hash check. Cache.put keeps
      // the original response, including its headers and status, without another network fetch.
      let received = 0;
      // eslint-disable-next-line no-await-in-loop
      await readDownload(
        {
          expectedFullHash: verified?.family.sha256,
          expectedHash: expected,
          expectedSize: byteSize,
          onReceived: (bytes) => {
            if (bytes > received) {
              received = bytes;
              activity();
            }
            progress.received(url, bytes);
          },
          signal: abort.signal,
          url,
        },
        response,
      );
      // eslint-disable-next-line no-await-in-loop
      await untilAborted(abort.signal, cache.put(url, response));
      if (abort.signal.aborted) {
        throw abort.signal.reason;
      }
      activity();
      progress.stored(url);
      return undefined;
    } catch (caught) {
      error = caught;
      // A size mismatch can be detected before EOF. Abort the unused original response too.
      if (!abort.signal.aborted) {
        abort.abort(caught);
      }
      progress.retry(url);
    } finally {
      clearTimeout(timer);
    }
  }
  return { error, url };
}

async function readDownload(
  {
    expectedFullHash,
    expectedHash,
    expectedSize,
    onReceived,
    signal,
    url,
  }: {
    expectedHash: string | undefined;
    expectedFullHash?: string | undefined;
    expectedSize: number | undefined;
    onReceived: (bytes: number) => void;
    signal: AbortSignal;
    url: string;
  },
  response: Response,
): Promise<void> {
  const reader = response.clone().body?.getReader();
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  let onAbort: () => void = () => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      void reader?.cancel(signal.reason).catch(() => undefined);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
    }
  });
  try {
    await Promise.race([
      (async () => {
        if (reader !== undefined) {
          while (true) {
            // A single response stream must be read in order.
            // eslint-disable-next-line no-await-in-loop
            const chunk = await reader.read();
            if (signal.aborted) {
              throw signal.reason;
            }
            if (chunk.done) {
              break;
            }
            bytes += chunk.value.byteLength;
            if (expectedSize !== undefined && bytes > expectedSize) {
              throw new Error("Downloaded body exceeds its manifest size");
            }
            if (expectedHash !== undefined || expectedFullHash !== undefined) {
              chunks.push(chunk.value);
            }
            onReceived(bytes);
          }
        }
        if (expectedSize !== undefined && bytes !== expectedSize) {
          throw new Error("Downloaded body does not match its manifest size");
        }
        if (expectedHash !== undefined || expectedFullHash !== undefined) {
          const body = new Uint8Array(bytes);
          let offset = 0;
          for (const chunk of chunks) {
            body.set(chunk, offset);
            offset += chunk.byteLength;
          }
          const digest = await crypto.subtle.digest("SHA-256", body);
          const actual = digestContentHash(new Uint8Array(digest));
          if (expectedFullHash !== undefined && digestHex(digest) !== expectedFullHash) {
            throw new Error(`Full body SHA-256 mismatch for ${url}`);
          }
          if (expectedHash !== undefined && actual !== expectedHash) {
            throw new Error(`Content hash ${actual} for ${url}, expected ${expectedHash}`);
          }
        }
        if (signal.aborted) {
          throw signal.reason;
        }
      })(),
      aborted,
    ]);
  } finally {
    signal.removeEventListener("abort", onAbort);
    // Release a still-open clone branch on mismatch, without waiting for the original branch.
    void reader?.cancel().catch(() => undefined);
  }
}

// Stages the selected sound format and all common files in a separate build cache. Installation
// succeeds only after every required response is stored and verified. Document pins preserve
// their build's manifest and assets across another document's explicit activation and reload.
// An activation handshake refuses unknown peers and incomplete stages. Cache reclamation occurs
// only at a client-free activation; missing visibility or metadata preserves old builds.
export function runServiceWorker(
  policy: CachePolicy,
  input: PrecacheManifest | PrecacheManifestWire,
): void {
  const manifest = decodePrecacheManifest(input);
  const worker = self as unknown as WorkerScope;
  const verifiedFamilies = (build: PrecacheManifest) => {
    const families = validateVerifiedJsonBodies(
      {
        urls: [...build.urls, ...Object.values(build.sounds).flat()],
        ...(build.byteSizes === undefined ? {} : { byteSizes: build.byteSizes }),
      },
      build.verifiedJsonBodies ?? [],
    );
    for (const family of families) {
      const digest = Uint8Array.from(family.sha256.match(/../g)!, (hex) =>
        Number.parseInt(hex, 16),
      );
      const logical = digestContentHash(digest);
      if (
        family.urls.some(
          (url) => build.contentHashes[url] !== undefined && build.contentHashes[url] !== logical,
        )
      ) {
        throw new TypeError("Verified JSON identity conflicts with a logical content hash");
      }
    }
    return families;
  };
  const verifiedFor = (build: PrecacheManifest, url: string): VerifiedSource | undefined => {
    const family = build.verifiedJsonBodies?.find((candidate) => candidate.urls.includes(url));
    return family === undefined ? undefined : { family, origin: worker.location.origin };
  };
  verifiedFamilies(manifest);
  if (hasDataProfile(manifest)) {
    verifiedJsonAliasCachePrefix(policy);
  }
  const aliasName = (build: PrecacheManifest) =>
    verifiedJsonAliasCachePrefix(policy) + build.version;
  const aliasNames = (build: PrecacheManifest, names: readonly string[]) => {
    if (!hasDataProfile(build)) {
      return [];
    }
    const prefix = verifiedJsonAliasCachePrefix(policy);
    return names.filter(
      (name) => name.startsWith(prefix) && /^[a-f0-9]{16}$/.test(name.slice(prefix.length)),
    );
  };
  const cacheName = cacheNameFor(policy, manifest.version);
  if (manifest.groups !== undefined) {
    if (!isBuildId(manifest.buildId)) {
      throw new TypeError("Grouped precache requires an immutable release build ID");
    }
    validatePrecacheGroups(
      [...manifest.urls, ...Object.values(manifest.sounds).flat()],
      manifest.groups,
    );
    for (const url of [...manifest.urls, ...Object.values(manifest.sounds).flat()]) {
      if (
        typeof manifest.contentHashes[url] !== "string" ||
        manifest.byteSizes?.[url] === undefined
      ) {
        throw new TypeError(`Grouped precache requires hash and byte size for ${url}`);
      }
    }
  }
  // The database opens lazily, so legacy all-file workers need no IndexedDB support.
  const groups = createGroupStore(
    { indexedDB: globalThis.indexedDB, now: () => Date.now() },
    `game-kit-groups:${policy.cacheNamePrefix}`,
  );
  const progressPorts = new Set<MessagePort>();
  const progress = createDownloadProgress(
    {
      now: () => Date.now(),
      operationId: crypto.randomUUID(),
      report: (snapshot: DownloadProgress) => {
        for (const port of progressPorts) {
          try {
            port.postMessage(snapshot);
          } catch {
            progressPorts.delete(port);
            port.close();
          }
        }
        if (snapshot.phase === "complete" || snapshot.phase === "failed") {
          for (const port of progressPorts) {
            port.close();
          }
          progressPorts.clear();
        }
      },
      version: manifest.version,
    },
    manifest.byteSizes,
  );
  // Routing records are private and cannot be mistaken for a version cache.
  const routingName = `game-kit-routing:${policy.cacheNamePrefix}`;
  const recordUrl = (kind: "build" | "client" | "selection", id: string) =>
    `${worker.location.origin}/.game-kit-routing/${kind}/${encodeURIComponent(id)}`;
  const routing = () => caches.open(routingName);
  const writeRecord = async (
    kind: "build" | "client" | "selection",
    id: string,
    value: unknown,
  ) => {
    await (await routing()).put(recordUrl(kind, id), new Response(JSON.stringify(value)));
  };
  const readPin = async (id: string): Promise<string | null | undefined> => {
    const response = await (await routing()).match(recordUrl("client", id));
    if (response === undefined) {
      return undefined;
    }
    const value: unknown = await response.json();
    // null positively records a document loaded through a network-only navigation.
    if (value === null) {
      return null;
    }
    if (typeof value !== "string" || !value.startsWith(policy.cacheNamePrefix)) {
      throw new TypeError("Invalid document build pin");
    }
    return value;
  };
  const readBuild = async (name: string): Promise<BuildRecord> => {
    const response = await (await routing()).match(recordUrl("build", name));
    if (response === undefined) {
      throw new TypeError("Missing document build manifest");
    }
    const stored = (await response.json()) as BuildRecord;
    const build: BuildRecord = { ...stored, manifest: decodePrecacheManifest(stored.manifest) };
    verifiedFamilies(build.manifest);
    if (hasDataProfile(build.manifest)) {
      if (
        !Array.isArray(stored.manifest) ||
        stored.manifest[0] !== 2 ||
        name !== cacheNameFor(policy, build.manifest.version)
      ) {
        throw new TypeError("Profile build records require durable schema 2");
      }
      verifiedJsonAliasCachePrefix(policy);
    }
    return build;
  };
  // The install stores every URL in this version's cache (cacheName) in three steps:
  // - A URL the cache already holds, from an earlier failed attempt to install this same version
  //   (the same cache name means the same manifest), is kept: a file with a recorded content hash
  //   only where its stored bytes have that hash, any other file by its presence.
  // - An earlier version's copy of each unchanged file is reused rather than fetched again, so a
  //   deploy downloads only what changed (installPlan): a hashed file by its name, any other file
  //   only where its bytes in the earlier cache have the content hash this manifest records. The
  //   hash is taken from the stored bytes, not from a record. Live documents retain earlier caches.
  // - Every other URL is fetched at low priority, at most PRECACHE_CONCURRENCY at a time, each
  //   checked against its recorded content hash and stored as soon as it arrives, with up to three
  //   attempts per file (fetchIntoCache). Bytes from a newer deploy fail the check, so this version
  //   never stores them; the update check that finds that deploy's worker installs it instead. A
  //   file whose attempts all fail does not stop the others. The install then logs the failed URLs
  //   and rejects, which fails it, and the next attempt fetches only the files still missing.
  const stage = async (
    name: string,
    build: PrecacheManifest,
    listedUrls: readonly string[],
    tracker: ReturnType<typeof createDownloadProgress>,
    activity: () => void,
    trustOwn = false,
  ) => {
    const families = verifiedFamilies(build);
    const cache = await caches.open(name);
    const dataCache = hasDataProfile(build) ? await caches.open(aliasName(build)) : undefined;
    const destination = (url: string) =>
      dataProfile(verifiedFor(build, url)) ? dataCache! : cache;
    const kept = await mapBounded(
      REUSE_CONCURRENCY,
      async (url) => {
        const verified = verifiedFor(build, url);
        const own = dataProfile(verified) ? [dataCache!, cache] : [cache];
        // Verified JSON bodies keep their full identity check; only ordinary entries trust presence.
        const response =
          trustOwn && verified === undefined
            ? await presentCopy(own, url)
            : await storedCopy(
                own,
                build.contentHashes[url],
                build.byteSizes?.[url],
                verified,
                url,
              );
        if (response !== undefined && dataProfile(verified) && response.url !== "") {
          await dataCache!.put(url, jsonResponse(await response.arrayBuffer()));
        }
        activity();
        return response !== undefined;
      },
      listedUrls,
    );
    const urls = listedUrls.filter((_, index) => kept[index] !== true);
    const earlier = await Promise.all(
      staleCacheNames(policy, name, await caches.keys())
        .filter((name) => name !== routingName)
        .map((name) => caches.open(name)),
    );
    const earlierData = await Promise.all(
      aliasNames(build, await caches.keys())
        .filter((name) => name !== aliasName(build))
        .map((name) => caches.open(name)),
    );
    const listed = await Promise.all(
      earlier.map(async (old) =>
        (await old.keys()).map((request) => [new URL(request.url).pathname, old] as const),
      ),
    );
    // Each URL an earlier cache holds, with every cache that holds it.
    const holders = new Map<string, Cache[]>();
    for (const [url, old] of listed.flat()) {
      holders.set(url, [...(holders.get(url) ?? []), old]);
    }
    const plan = installPlan(policy, build.contentHashes, new Set(holders.keys()), urls);
    const reusable = [
      ...plan.copy.map(
        (url) => [url, build.groups === undefined ? undefined : build.contentHashes[url]] as const,
      ),
      ...plan.verify,
    ];
    const unreused = await mapBounded(
      REUSE_CONCURRENCY,
      async ([url, contentHash]) => {
        const response = await storedCopy(
          holders.get(url) ?? [],
          contentHash,
          build.byteSizes?.[url],
          verifiedFor(build, url),
          url,
        );
        activity();
        if (response === undefined) {
          return [url];
        }
        await destination(url).put(
          url,
          dataProfile(verifiedFor(build, url))
            ? jsonResponse(await response.arrayBuffer())
            : response,
        );
        activity();
        return [];
      },
      reusable,
    );
    const missing = new Set([...plan.fetch, ...unreused.flat()]);
    const aliases = new Map<string, readonly string[]>();
    const fill = async (targets: readonly string[], response: Response) => {
      const body = await response.arrayBuffer();
      for (const url of targets) {
        // Each logical URL gets its own canonical response only after source verification.
        // eslint-disable-next-line no-await-in-loop
        await destination(url).put(url, jsonResponse(body));
        activity();
      }
    };
    for (const family of families) {
      const targets = family.urls.filter((url) => missing.has(url));
      if (targets.length === 0) {
        continue;
      }
      let source: Response | undefined;
      for (const url of family.urls) {
        // Current and earlier caches may hold a different, explicitly eligible member.
        // eslint-disable-next-line no-await-in-loop
        source = await storedCopy(
          family.responseProfile === undefined
            ? [cache, ...earlier]
            : [dataCache!, cache, ...earlier, ...earlierData],
          build.contentHashes[url],
          family.byteSize,
          { family, origin: worker.location.origin },
          url,
        );
        activity();
        if (source !== undefined) {
          break;
        }
      }
      if (source !== undefined) {
        // Families are bounded by explicit caller selection and processed one at a time.
        // eslint-disable-next-line no-await-in-loop
        await fill(targets, source);
        for (const url of targets) {
          missing.delete(url);
        }
      } else {
        const representative = targets[0]!;
        aliases.set(
          representative,
          family.responseProfile === undefined ? targets.slice(1) : targets,
        );
        for (const url of targets.slice(1)) {
          missing.delete(url);
        }
      }
    }
    const fetched = [...missing];
    // Reused and already verified files consume no network bytes in this operation.
    tracker.begin(fetched);
    const outcomes = await mapBounded(
      PRECACHE_CONCURRENCY,
      async (url) => {
        const verified = verifiedFor(build, url);
        const failure = await fetchIntoCache(
          policy,
          build.contentHashes,
          cache,
          build.byteSizes?.[url],
          tracker,
          verified,
          activity,
          url,
        );
        if (failure !== undefined) {
          return failure;
        }
        try {
          const targets = aliases.get(url) ?? [];
          if (targets.length > 0) {
            const source = await storedCopy(
              [cache],
              build.contentHashes[url],
              build.byteSizes?.[url],
              verified,
              url,
            );
            if (source === undefined) {
              throw new Error("Verified family source disappeared");
            }
            await fill(targets, source);
          }
          return undefined;
        } catch (error) {
          return { error, url };
        }
      },
      fetched,
    );
    const failures = outcomes.filter((outcome) => outcome !== undefined);
    const last = failures.at(-1);
    if (last !== undefined) {
      const named = failures.slice(0, FAILED_URLS_LOGGED).map(({ url }) => url);
      const more =
        failures.length > named.length ? ` and ${failures.length - named.length} more` : "";
      const counted = `${failures.length} of ${fetched.length} files`;
      const message = `Precache failed for ${counted}: ${named.join(", ")}${more}`;
      console.error(`${message}. Last error:`, last.error);
      throw new Error(message, { cause: last.error });
    }
    tracker.verifying();
  };

  const currentBuild: BuildRecord = {
    manifest,
    urls: [
      ...new Set(
        installUrls(manifest, new URL(worker.location.href).searchParams.get(SOUND_FORMAT_PARAM)),
      ),
    ],
  };
  const requiredUrls = (build: BuildRecord, ids: readonly string[]) =>
    build.manifest.groups === undefined
      ? [...build.urls]
      : [
          ...new Set([
            ...basePrecacheUrls(build.manifest.groups, build.urls),
            ...precacheGroupUrls({ groups: build.manifest.groups, selectedUrls: build.urls }, ids),
          ]),
        ];
  const installedUnion = async (): Promise<string[]> => {
    if (manifest.groups === undefined) {
      return [];
    }
    const snapshot = await groups.snapshot();
    const ids = new Set(Object.values(snapshot).flat());
    // Earlier all-file builds had no group metadata. Preserve their complete offline coverage
    // conservatively through the first grouped update rather than silently dropping assets.
    for (const name of staleCacheNames(policy, cacheName, await caches.keys())) {
      if (name === routingName) {
        continue;
      }
      // A failed legacy install may leave a cache without any committed build record.
      // eslint-disable-next-line no-await-in-loop
      if ((await (await routing()).match(recordUrl("build", name))) === undefined) {
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const build = await readBuild(name);
      if (build.manifest.groups === undefined) {
        for (const id of Object.keys(manifest.groups.urls)) {
          ids.add(id);
        }
      }
    }
    const result = [...ids];
    precacheGroupUrls({ groups: manifest.groups, selectedUrls: currentBuild.urls }, result);
    return result;
  };
  // Serialize staging within this worker to retain the shared four-request network bound.
  // Durable readiness transactions, rather than this local chain, serialize different workers.
  let staging: Promise<unknown> = Promise.resolve();
  const jobs = new Set<Set<() => void>>();
  const serialized = <T>(
    work: (activity: () => void) => Promise<T>,
    observer?: () => void,
  ): Promise<T> => {
    // Only predecessors already ahead in this FIFO may keep a queued request alive.
    const predecessors = [...jobs];
    const listeners = new Set<() => void>();
    if (observer !== undefined) {
      listeners.add(observer);
      for (const previous of predecessors) {
        previous.add(observer);
      }
    }
    jobs.add(listeners);
    const activity = () => {
      for (const notify of listeners) {
        notify();
      }
    };
    const run = async () => {
      for (const previous of predecessors) {
        if (observer !== undefined) {
          previous.delete(observer);
        }
      }
      activity();
      try {
        return await work(activity);
      } finally {
        jobs.delete(listeners);
        listeners.clear();
      }
    };
    const result = staging.then(run, run);
    staging = result.catch(() => undefined);
    // Validated queue admission is reported once, never by a timer.
    observer?.();
    return result;
  };
  const precache = () =>
    serialized(async (activity) => {
      const ids =
        manifest.groups === undefined
          ? []
          : [...new Set([...manifest.groups.initial, ...(await installedUnion())])];
      await stage(cacheName, manifest, requiredUrls(currentBuild, ids), progress, activity);
      // Store immutable build metadata first. A crash before the transactional ready commit
      // leaves a resumable partial cache, never a falsely available group.
      await writeRecord(
        "build",
        cacheName,
        hasDataProfile(manifest)
          ? { ...currentBuild, manifest: encodePrecacheManifest(manifest) }
          : currentBuild,
      );
      activity();
      if (manifest.groups !== undefined && (await groups.commit(cacheName, ids)) !== "stored") {
        throw new TypeError("An update currently prevents committing asset groups");
      }
      activity();
      progress.complete();
    });
  const completeBuild = async (
    name: string,
    build: BuildRecord,
    activity: () => void = () => undefined,
    trustOwn = false,
  ): Promise<boolean> => {
    const ready = build.manifest.groups === undefined ? [] : await groups.read(name);
    if (ready === undefined) {
      return false;
    }
    const cache = await caches.open(name);
    const dataCache = hasDataProfile(build.manifest)
      ? await caches.open(aliasName(build.manifest))
      : undefined;
    const complete = await mapBounded(
      REUSE_CONCURRENCY,
      async (url) => {
        const verified = verifiedFor(build.manifest, url);
        const own = dataProfile(verified) ? [dataCache!] : [cache];
        const complete =
          (trustOwn && verified === undefined
            ? await presentCopy(own, url)
            : await storedCopy(
                own,
                build.manifest.contentHashes[url],
                build.manifest.byteSizes?.[url],
                verifiedFor(build.manifest, url),
                url,
              )) !== undefined;
        activity();
        return complete;
      },
      requiredUrls(build, ready),
    );
    return complete.every(Boolean);
  };
  const selectCompleteBuild = async (allowCurrent = true): Promise<boolean> => {
    // Remove the selection before checking, so an interrupted activation leaves no selection
    // rather than a stale or failed one; navigationBuild then selects on demand.
    await (await routing()).delete(recordUrl("selection", cacheName));
    if (allowCurrent && (await completeBuild(cacheName, currentBuild, undefined, true))) {
      await writeRecord("selection", cacheName, cacheName);
      return true;
    }
    const previous = staleCacheNames(policy, cacheName, await caches.keys()).filter(
      (name) => name !== routingName,
    );
    for (const name of previous.reverse()) {
      try {
        // Earlier builds are tried in turn, stopping at the first complete selected format.
        // eslint-disable-next-line no-await-in-loop
        const build = await readBuild(name);
        // eslint-disable-next-line no-await-in-loop
        if (await completeBuild(name, build)) {
          // eslint-disable-next-line no-await-in-loop
          await writeRecord("selection", cacheName, name);
          return false;
        }
      } catch {
        // A legacy cache without a manifest cannot prove completeness and is retained.
      }
    }
    return false;
  };
  const navigationBuild = async (): Promise<string> => {
    const record = await (await routing()).match(recordUrl("selection", cacheName));
    // A missing record, or a null one an earlier kit left after an interrupted activation,
    // selects on demand instead of failing every navigation.
    const recorded: unknown = record === undefined ? undefined : await record.clone().json();
    if (record === undefined || recorded === null) {
      if (await selectCompleteBuild()) {
        return cacheName;
      }
      const fallback = await (await routing()).match(recordUrl("selection", cacheName));
      const name: unknown = fallback === undefined ? undefined : await fallback.json();
      if (typeof name === "string" && name.startsWith(policy.cacheNamePrefix)) {
        return name;
      }
      throw new TypeError("No complete cached build");
    }
    const selected: unknown = await record.json();
    if (typeof selected !== "string" || !selected.startsWith(policy.cacheNamePrefix)) {
      throw new TypeError("No complete cached build");
    }
    return selected;
  };
  const outgoingCanPin = (deadline: number): Promise<boolean> => {
    const active = worker.registration.active;
    if (active === null) {
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      const finish = (capable: boolean) => {
        clearTimeout(timer);
        channel.port1.close();
        channel.port2.close();
        resolve(capable);
      };
      const timer = setTimeout(() => finish(false), Math.max(0, deadline - Date.now()));
      channel.port1.onmessage = ({ data }: MessageEvent<unknown>) => finish(data === true);
      try {
        active.postMessage(ROUTING_CAPABILITY, [channel.port2]);
      } catch {
        finish(false);
      }
    });
  };

  // Missing visibility or records preserve all caches. Only proven-unused builds are removed.
  const deleteStaleCaches = async () => {
    const clients = await worker.clients.matchAll({ includeUncontrolled: true, type: "window" });
    const pins = await Promise.all(clients.map(({ id }) => readPin(id)));
    if (pins.some((pin) => pin === undefined)) {
      return;
    }
    // Live and reserved navigations may still be completing under the previous worker.
    // Reclaim only at a client-free activation; an explicit switch always retains old builds.
    if (clients.length > 0) {
      return;
    }
    const ordinaryStale = staleCacheNames(policy, cacheName, await caches.keys()).filter(
      (name) => name !== routingName,
    );
    const privatePrefix =
      policy.cacheNamePrefix !== ""
        ? `!game-kit-json-data-v1:${encodeURIComponent(policy.cacheNamePrefix)}:`
        : undefined;
    const privateStale =
      privatePrefix === undefined || privatePrefix.startsWith(policy.cacheNamePrefix)
        ? []
        : (await caches.keys()).filter(
            (name) =>
              name.startsWith(privatePrefix) &&
              /^[a-f0-9]{16}$/.test(name.slice(privatePrefix.length)) &&
              name.slice(privatePrefix.length) !== manifest.version,
          );
    const stale = [
      ...new Set([
        ...ordinaryStale,
        ...privateStale.map((name) => cacheNameFor(policy, name.slice(privatePrefix!.length))),
      ]),
    ];
    const records = await routing();
    const keys = await records.keys();
    await Promise.all(
      stale.map(async (name) => {
        await caches.delete(name);
        await records.delete(recordUrl("build", name));
        if (manifest.groups !== undefined) {
          await groups.remove(name);
        }
      }),
    );
    await Promise.all(privateStale.map((name) => caches.delete(name)));
    await Promise.all(
      keys
        .filter((key) => new URL(key.url).pathname.startsWith("/.game-kit-routing/client/"))
        .map((key) => records.delete(key)),
    );
  };

  const cacheFirst = async (event: FetchRequestEvent): Promise<Response> => {
    const { clientId, request, resultingClientId } = event;
    const navigation = request.mode === "navigate";
    if (
      navigation &&
      strategyFor(policy, cachedUrlsOf(manifest), {
        isNavigation: true,
        pathname: new URL(request.url).pathname,
      }) === "network-only"
    ) {
      const response = await fetch(request);
      if (resultingClientId) {
        await writeRecord("client", resultingClientId, null);
      }
      return response;
    }
    const pinned = navigation
      ? await navigationBuild()
      : !clientId
        ? cacheName
        : await readPin(clientId);
    if (pinned === undefined) {
      throw new TypeError("Missing document build pin");
    }
    if (pinned === null) {
      return fetch(request);
    }
    const build = pinned === cacheName ? manifest : (await readBuild(pinned)).manifest;
    const pathname = new URL(request.url).pathname;
    const strategy = strategyFor(policy, cachedUrlsOf(build), {
      isNavigation: navigation,
      pathname,
    });
    if (strategy !== "cache-first") {
      return fetch(request);
    }
    const cache = await caches.open(pinned);
    const key = cacheKeyFor(pathname);
    const verified = verifiedFor(build, key);
    if (dataProfile(verified)) {
      if (request.url !== new URL(key, worker.location.origin).href) {
        throw new TypeError("Profile JSON requires its exact canonical URL");
      }
      const data =
        request.destination === "" &&
        request.mode !== "navigate" &&
        !request.headers.has("range") &&
        !request.headers.has("if-range");
      if (data) {
        const record = await readBuild(pinned);
        const ready = build.groups === undefined ? [] : await groups.read(pinned);
        if (ready === undefined || !requiredUrls(record, ready).includes(key)) {
          throw new TypeError("Profile JSON is not in a committed selected group");
        }
        const dataCache = await caches.open(aliasName(build));
        const found = await storedCopy(
          [dataCache, cache],
          build.contentHashes[key],
          build.byteSizes?.[key],
          verified,
          key,
        );
        const source =
          found ??
          (await fetchAndStore(
            cache,
            build.contentHashes[key],
            build.byteSizes?.[key],
            key,
            verified,
            request,
          ));
        const response = jsonResponse(await source.arrayBuffer());
        await dataCache.put(key, response.clone());
        return response;
      }
      const found = await storedCopy(
        [cache],
        build.contentHashes[key],
        build.byteSizes?.[key],
        verified,
        key,
      );
      const response =
        found !== undefined && found.url === request.url
          ? found
          : await fetchAndStore(
              cache,
              build.contentHashes[key],
              build.byteSizes?.[key],
              key,
              verified,
              request,
            );
      if (navigation && resultingClientId) {
        await writeRecord("client", resultingClientId, pinned);
      }
      return response;
    }
    const response =
      (verified === undefined
        ? await cache.match(key)
        : await storedCopy(
            [cache],
            build.contentHashes[key],
            build.byteSizes?.[key],
            verified,
            key,
          )) ??
      (await fetchAndStore(
        cache,
        build.contentHashes[key],
        build.byteSizes?.[key],
        key,
        verified,
        request,
      ));
    // The new document cannot request any resources until its pin has been persisted.
    if (navigation && resultingClientId) {
      await writeRecord("client", resultingClientId, pinned);
    }
    return response;
  };

  const requestGroups = async (event: MessageRequestEvent): Promise<void> => {
    const port = event.ports[0];
    if (port === undefined) {
      return;
    }
    const reply = (result: AssetGroupsResult) => {
      port.postMessage({ result, type: "result" });
      port.close();
    };
    let tracker: ReturnType<typeof createDownloadProgress> | undefined;
    let listening = true;
    let detachActivity = () => undefined;
    const stopActivity = () => {
      listening = false;
      detachActivity();
    };
    port.addEventListener("close", stopActivity);
    port.addEventListener("messageerror", stopActivity);
    try {
      const request = event.data as Partial<AssetGroupsRequest>;
      if (
        !isBuildId(request.buildId) ||
        (request.version !== undefined && typeof request.version !== "string") ||
        !Array.isArray(request.groups) ||
        request.groups.some((id: unknown) => typeof id !== "string") ||
        (request.activity !== undefined && request.activity !== true)
      ) {
        reply({ reason: "failed", status: "unavailable" });
        return;
      }
      const source = event.source;
      const id = source !== null && "id" in source ? source.id : undefined;
      if (
        typeof id !== "string" ||
        !(await worker.clients.matchAll({ includeUncontrolled: true, type: "window" })).some(
          (client) => client.id === id,
        )
      ) {
        reply({ reason: "wrong-build", status: "unavailable" });
        return;
      }
      const pin = await readPin(id);
      // A network-only navigation is not a proof that this worker owns the document's build.
      // For the first uncontrolled document, explicit full build identity is the binding proof.
      if (pin === null) {
        reply({ reason: "wrong-build", status: "unavailable" });
        return;
      }
      if (
        pin === undefined &&
        (await worker.clients.matchAll({ includeUncontrolled: false, type: "window" })).some(
          (client) => client.id === id,
        )
      ) {
        reply({ reason: "wrong-build", status: "unavailable" });
        return;
      }
      // Only the first uncontrolled visit can establish a missing pin, and only for this
      // active build. A caller-supplied previous version is not durable routing evidence.
      const name = pin ?? cacheName;
      let build: BuildRecord;
      try {
        build = await readBuild(name);
      } catch {
        reply({ reason: "wrong-build", status: "unavailable" });
        return;
      }
      if (
        build.manifest.buildId !== request.buildId ||
        (request.version !== undefined && request.version !== build.manifest.version)
      ) {
        reply({ reason: "wrong-build", status: "unavailable" });
        return;
      }
      const partition = build.manifest.groups;
      if (partition === undefined) {
        reply({ reason: "unsupported", status: "unavailable" });
        return;
      }
      const requested = [...new Set(request.groups)];
      const unknownGroups = requested.filter((group) => !Object.hasOwn(partition.urls, group));
      if (unknownGroups.length > 0) {
        reply({ status: "invalid-groups", unknownGroups });
        return;
      }
      if (pin === undefined) {
        await writeRecord("client", id, name);
      }
      const operationId = crypto.randomUUID();
      let sequence = 0;
      const activity = () => {
        if (!listening || request.activity !== true || sequence >= Number.MAX_SAFE_INTEGER) {
          return;
        }
        try {
          port.postMessage({
            buildId: build.manifest.buildId,
            operationId,
            sequence: ++sequence,
            type: "activity",
            version: build.manifest.version,
          });
        } catch {
          stopActivity();
        }
      };
      detachActivity = () => {
        for (const job of jobs) {
          job.delete(activity);
        }
      };
      tracker = createDownloadProgress(
        {
          now: () => Date.now(),
          operationId,
          report: (snapshot) => {
            try {
              port.postMessage({ progress: snapshot, type: "progress" });
            } catch {
              stopActivity();
            }
          },
          version: build.manifest.version,
        },
        build.manifest.byteSizes,
      );
      const download = tracker;
      await serialized(async (workActivity) => {
        const ready = await groups.read(name);
        if (ready === undefined) {
          throw new TypeError("Missing durable base readiness");
        }
        const combined = [...new Set([...ready, ...requested])];
        // Read-only state queries check durable bytes but never silently start a download.
        if (requested.length === 0) {
          if (!(await completeBuild(name, build, workActivity))) {
            throw new TypeError("Committed asset groups are no longer complete");
          }
        } else {
          await stage(name, build.manifest, requiredUrls(build, combined), download, workActivity);
          if ((await groups.commit(name, combined)) !== "stored") {
            throw new TypeError("An update currently prevents committing asset groups");
          }
        }
        workActivity();
        const committed = await groups.read(name);
        if (committed === undefined) {
          throw new TypeError("Missing committed asset group readiness");
        }
        download.complete();
        reply({
          readyGroups: [...committed].sort(),
          status: "available",
          version: build.manifest.version,
        });
      }, activity);
    } catch {
      tracker?.fail();
      reply({ reason: "failed", status: "unavailable" });
    } finally {
      stopActivity();
      port.removeEventListener("close", stopActivity);
      port.removeEventListener("messageerror", stopActivity);
    }
  };

  const requestActivation = async (event: MessageRequestEvent) => {
    const port = event.ports[0];
    // Legacy callers have no handshake and cannot safely distinguish a refused switch.
    if (port === undefined) {
      return;
    }
    let barrierToken: string | undefined;
    let activationIntent = false;
    try {
      const source = event.source;
      const requester = source !== null && "id" in source ? source.id : undefined;
      const clients = await worker.clients.matchAll({ includeUncontrolled: true, type: "window" });
      const peers = clients.filter(({ id }) => id !== requester);
      const pins = await Promise.all(peers.map(({ id }) => readPin(id)));
      if (typeof requester !== "string" || pins.some((pin) => pin === undefined)) {
        port.postMessage("blocked");
        return;
      }
      // A recorded pin without its manifest is not evidence that the peer can keep running.
      await Promise.all(
        pins.filter((pin): pin is string => typeof pin === "string").map(readBuild),
      );
      const requesterPin = await readPin(requester);
      if (typeof requesterPin === "string") {
        await readBuild(requesterPin);
      }
      const { deadline } = event.data as { deadline: number };
      if (
        !Number.isFinite(deadline) ||
        Date.now() >= deadline ||
        !(await outgoingCanPin(deadline))
      ) {
        port.postMessage("blocked");
        return;
      }
      if (manifest.groups !== undefined) {
        barrierToken = crypto.randomUUID();
        const snapshot = await groups.freeze(cacheName, barrierToken, deadline);
        if (snapshot === undefined) {
          port.postMessage("blocked");
          return;
        }
        activationIntent = snapshot.activating;
        const ids = [
          ...new Set([
            ...manifest.groups.initial,
            ...Object.values(snapshot.snapshot).flat(),
            ...(await installedUnion()),
          ]),
        ];
        await serialized(async (activity) => {
          await stage(
            cacheName,
            manifest,
            requiredUrls(currentBuild, ids),
            progress,
            activity,
            true,
          );
          if ((await groups.commit(cacheName, ids, barrierToken)) !== "stored") {
            throw new TypeError("Asset group activation barrier expired");
          }
        });
      }
      if (
        !(await completeBuild(cacheName, currentBuild, undefined, true)) ||
        Date.now() >= deadline
      ) {
        port.postMessage("blocked");
        return;
      }
      if (barrierToken !== undefined) {
        if (!(await groups.markActivating(barrierToken))) {
          port.postMessage("blocked");
          return;
        }
        activationIntent = true;
      }
      if (Date.now() >= deadline) {
        port.postMessage("blocked");
        return;
      }
      // No asynchronous work may intervene between the deadline check and activation.
      await worker.skipWaiting();
      port.postMessage("activating");
    } catch {
      port.postMessage("blocked");
    } finally {
      // Once skipWaiting may have reached the UA, keep the durable fence until activate starts.
      // Rejection or worker termination cannot prove that native activation did not begin.
      if (barrierToken !== undefined && !activationIntent) {
        await groups.release(barrierToken);
      }
    }
  };

  worker.addEventListener("install", (event) =>
    event.waitUntil(
      precache().catch((error: unknown) => {
        progress.fail();
        throw error;
      }),
    ),
  );
  worker.addEventListener("activate", (event) =>
    event.waitUntil(
      (async () => {
        let allowCurrent = true;
        if (manifest.groups !== undefined) {
          // The UA terminates the previous active worker before dispatching this event.
          await groups.finishActivation(cacheName);
          try {
            // A client-free activation also retains groups completed after installation.
            // Functional fetch events wait until this activation promise settles.
            await serialized(async (activity) => {
              const ids = [...new Set([...manifest.groups!.initial, ...(await installedUnion())])];
              await stage(
                cacheName,
                manifest,
                requiredUrls(currentBuild, ids),
                progress,
                activity,
                true,
              );
              if ((await groups.commit(cacheName, ids)) !== "stored") {
                throw new TypeError("Asset group activation could not commit readiness");
              }
            });
          } catch {
            allowCurrent = false;
          }
        }
        if (await selectCompleteBuild(allowCurrent)) {
          await deleteStaleCaches();
        }
      })().catch(() => undefined),
    ),
  );
  worker.addEventListener("message", (event) => {
    if ((event.data as { type?: unknown } | null)?.type === ASSET_GROUPS_MESSAGE) {
      event.waitUntil(requestGroups(event));
      return;
    }
    if ((event.data as { type?: unknown } | null)?.type === DOWNLOAD_PROGRESS_MESSAGE) {
      const port = event.ports[0];
      if (port !== undefined) {
        const snapshot = progress.snapshot();
        port.postMessage(snapshot);
        if (snapshot.phase === "complete" || snapshot.phase === "failed") {
          port.close();
        } else {
          progressPorts.add(port);
        }
      }
      return;
    }
    if (event.data === ROUTING_CAPABILITY) {
      event.waitUntil(
        routing()
          .then(() => event.ports[0]?.postMessage(true))
          .catch(() => event.ports[0]?.postMessage(false)),
      );
      return;
    }
    if ((event.data as { type?: unknown } | null)?.type === SKIP_WAITING) {
      event.waitUntil(requestActivation(event));
    }
  });

  worker.addEventListener("fetch", (event) => {
    const { request } = event;
    const url = new URL(request.url);
    if (request.method !== "GET" || url.origin !== worker.location.origin) {
      return;
    }
    event.respondWith(cacheFirst(event));
  });
}
