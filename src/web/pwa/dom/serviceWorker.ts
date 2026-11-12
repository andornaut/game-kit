// The service worker's behaviour. A game's worker entry calls runServiceWorker with its cache
// policy and the precache manifest the build writes in (vite/precachePlugin), and the plugin
// builds the entry to one classic script. The worker runs in a ServiceWorkerGlobalScope, which the
// DOM typings do not describe, so the few members it uses are declared here. It imports only
// cachePolicy, and types, so the built worker holds nothing else.
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
import type { PrecacheManifest } from "../precacheList.ts";
import type { SoundFormatParam } from "../serviceWorkerUrl.ts";
import type { SkipWaitingMessage } from "../updateReady.ts";

interface LifecycleEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}

interface FetchRequestEvent extends LifecycleEvent {
  readonly request: Request;
  respondWith(response: Promise<Response>): void;
}

interface WorkerScope {
  addEventListener(type: "activate" | "install", listener: (event: LifecycleEvent) => void): void;
  addEventListener(type: "fetch", listener: (event: FetchRequestEvent) => void): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  readonly location: { readonly href: string; readonly origin: string };
  skipWaiting(): Promise<void>;
}

const SOUND_FORMAT_PARAM: SoundFormatParam = "sound";
const SKIP_WAITING: SkipWaitingMessage = "skip-waiting";

// Only a whole response is stored: Cache.put rejects a 206, which an audio element's range
// request can get. A write that fails (a full quota) still answers with the network's response.
async function fetchAndStore(cache: Cache, key: string, request: Request): Promise<Response> {
  const response = await fetch(request);
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

// The content hash of a stored response's bytes (cachePolicy's digestContentHash), read from a
// clone so the response can still be stored.
async function responseContentHash(response: Response): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await response.clone().arrayBuffer());
  return digestContentHash(new Uint8Array(digest));
}

// The first copy of url that holders still store and, where contentHash is given, whose bytes
// have it. An earlier version's copy can be gone by now: another worker's activate deletes the
// caches it replaces.
async function storedCopy(
  holders: readonly Cache[],
  url: string,
  contentHash: string | undefined,
): Promise<Response | undefined> {
  for (const old of holders) {
    // Earlier caches are tried in turn, stopping at the first copy that qualifies.
    // eslint-disable-next-line no-await-in-loop
    const response = await old.match(url);
    if (response === undefined) {
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    if (contentHash === undefined || (await responseContentHash(response)) === contentHash) {
      return response;
    }
  }
  return undefined;
}

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

interface PrecacheFailure {
  readonly error: unknown;
  readonly url: string;
}

// Fetches url at low priority and stores it in cache, trying once plus once per retry delay. A
// response that is not ok, bytes that lack url's content hash in contentHashes
// (PrecacheManifest's) where it has one, or a write that fails, counts as a failed attempt.
// Returns the last error once every attempt has failed. A hashed build file has no recorded
// hash: its name is its identity.
async function fetchIntoCache(
  policy: CachePolicy,
  contentHashes: Readonly<Record<string, string>>,
  cache: Cache,
  url: string,
): Promise<PrecacheFailure | undefined> {
  let error: unknown;
  for (let attempt = 0; attempt <= PRECACHE_RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) {
      // Attempts are sequential: each waits out the backoff after the one before.
      // eslint-disable-next-line no-await-in-loop
      await wait(PRECACHE_RETRY_DELAYS_MS[attempt - 1] as number);
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      const response = await fetch(
        new Request(url, { ...precacheFetchOptions(policy, url), priority: "low" }),
      );
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }
      const expected = contentHashes[url];
      if (expected !== undefined) {
        // eslint-disable-next-line no-await-in-loop
        const actual = await responseContentHash(response);
        if (actual !== expected) {
          throw new Error(`Content hash ${actual} for ${url}, expected ${expected}`);
        }
      }
      // eslint-disable-next-line no-await-in-loop
      await cache.put(url, response);
      return undefined;
    } catch (caught) {
      error = caught;
    }
  }
  return { error, url };
}

// Precaches manifest on install, file by file, resumably and checked (precache below), deletes the
// policy's other caches on activate and answers same-origin GETs by strategyFor: every precached
// URL, the page included, from this version's cache, so a controlled page starts at once with the
// version on disk, and anything else from the network. No skipWaiting on install: a new worker
// waits until every page the old one controls has closed, so a running game never has its cache
// deleted or its code swapped. It takes over on the next launch, or when the page posts the
// skip-waiting message (updateReady's activateWaitingWorker) and reloads once this worker
// controls it.
export function runServiceWorker(policy: CachePolicy, manifest: PrecacheManifest): void {
  const worker = self as unknown as WorkerScope;
  const cacheName = cacheNameFor(policy, manifest.version);
  const cachedUrls = cachedUrlsOf(manifest);

  // The install stores every URL in this version's cache (cacheName) in three steps:
  // - A URL the cache already holds, from an earlier failed attempt to install this same version
  //   (the same cache name means the same manifest), is kept: a file with a recorded content hash
  //   only where its stored bytes have that hash, any other file by its presence.
  // - An earlier version's copy of each unchanged file is reused rather than fetched again, so a
  //   deploy downloads only what changed (installPlan): a hashed file by its name, any other file
  //   only where its bytes in the earlier cache have the content hash this manifest records. The
  //   hash is taken from the stored bytes, not from a record, because a cache miss stores whatever
  //   the network serves, unchecked. The earlier caches stay until activate.
  // - Every other URL is fetched at low priority, at most PRECACHE_CONCURRENCY at a time, each
  //   checked against its recorded content hash and stored as soon as it arrives, with up to three
  //   attempts per file (fetchIntoCache). Bytes from a newer deploy fail the check, so this version
  //   never stores them; the update check that finds that deploy's worker installs it instead. A
  //   file whose attempts all fail does not stop the others. The install then logs the failed URLs
  //   and rejects, which fails it, and the next attempt fetches only the files still missing.
  const precache = async () => {
    const soundFormat = new URL(worker.location.href).searchParams.get(SOUND_FORMAT_PARAM);
    const cache = await caches.open(cacheName);
    const listedUrls = installUrls(manifest, soundFormat);
    const kept = await mapBounded(
      REUSE_CONCURRENCY,
      async (url) => (await storedCopy([cache], url, manifest.contentHashes[url])) !== undefined,
      listedUrls,
    );
    const urls = listedUrls.filter((_, index) => kept[index] !== true);
    const earlier = await Promise.all(
      staleCacheNames(policy, cacheName, await caches.keys()).map((name) => caches.open(name)),
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
    const plan = installPlan(policy, manifest.contentHashes, new Set(holders.keys()), urls);
    const reusable = [...plan.copy.map((url) => [url, undefined] as const), ...plan.verify];
    const unreused = await mapBounded(
      REUSE_CONCURRENCY,
      async ([url, contentHash]) => {
        const response = await storedCopy(holders.get(url) ?? [], url, contentHash);
        if (response === undefined) {
          return [url];
        }
        await cache.put(url, response);
        return [];
      },
      reusable,
    );
    const fetched = [...plan.fetch, ...unreused.flat()];
    const outcomes = await mapBounded(
      PRECACHE_CONCURRENCY,
      (url) => fetchIntoCache(policy, manifest.contentHashes, cache, url),
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
  };

  const deleteStaleCaches = async () => {
    const stale = staleCacheNames(policy, cacheName, await caches.keys());
    await Promise.all(stale.map((name) => caches.delete(name)));
  };

  // This version's stored copy, or on a miss the network's response, stored for next time.
  const cacheFirst = async (request: Request, key: string) => {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(key);
    return cached ?? fetchAndStore(cache, key, request);
  };

  worker.addEventListener("install", (event) => event.waitUntil(precache()));
  worker.addEventListener("activate", (event) => event.waitUntil(deleteStaleCaches()));
  worker.addEventListener("message", (event) => {
    if (event.data === SKIP_WAITING) {
      void worker.skipWaiting();
    }
  });

  worker.addEventListener("fetch", (event) => {
    const { request } = event;
    const url = new URL(request.url);
    if (request.method !== "GET" || url.origin !== worker.location.origin) {
      return;
    }
    const strategy = strategyFor(policy, cachedUrls, {
      isNavigation: request.mode === "navigate",
      pathname: url.pathname,
    });
    if (strategy === "cache-first") {
      event.respondWith(cacheFirst(request, cacheKeyFor(url.pathname)));
    }
  });
}
