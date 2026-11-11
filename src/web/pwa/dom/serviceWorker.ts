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
  type FetchStrategy,
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

// How many earlier copies an install reads at once. A copy checked by its content hash is read
// whole, so the bound caps the bytes held in memory.
const REUSE_CONCURRENCY = 16;

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

// The first earlier copy of url that is still stored and, where contentHash is given, whose bytes
// have it. A copy can be gone by now: another worker's activate deletes the caches it replaces.
async function earlierCopy(
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

// Precaches manifest on install, deletes the policy's other caches on activate and answers
// same-origin GETs by strategyFor: cache-first for hashed build output and sound files,
// network-first for the page and every other precached file, since an unhashed file can change
// under its name and code that reads it must see the deploy the page came from. No skipWaiting on
// install: a new worker waits until every page the old one controls has closed, so a running game
// never has its cache deleted or its code swapped. It takes over on the next launch, or when the
// page posts the skip-waiting message (updateReady's activateWaitingWorker) and reloads once this
// worker controls it.
export function runServiceWorker(policy: CachePolicy, manifest: PrecacheManifest): void {
  const worker = self as unknown as WorkerScope;
  const cacheName = cacheNameFor(policy, manifest.version);
  const cachedUrls = cachedUrlsOf(manifest);

  // An earlier version's copy of each unchanged file is reused rather than fetched again, so a
  // deploy downloads only what changed (installPlan): a hashed file by its name, any other file
  // only where its bytes in the earlier cache have the content hash this manifest records. The
  // hash is taken from the stored bytes, not from a record, because network-first replaces an
  // earlier cache's copy with whatever the network serves. The earlier caches stay until activate.
  const precache = async () => {
    const soundFormat = new URL(worker.location.href).searchParams.get(SOUND_FORMAT_PARAM);
    const urls = installUrls(manifest, soundFormat);
    const cache = await caches.open(cacheName);
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
        const response = await earlierCopy(holders.get(url) ?? [], url, contentHash);
        if (response === undefined) {
          return [url];
        }
        await cache.put(url, response);
        return [];
      },
      reusable,
    );
    const fetched = [...plan.fetch, ...unreused.flat()];
    await cache.addAll(fetched.map((url) => new Request(url, precacheFetchOptions(policy, url))));
  };

  const deleteStaleCaches = async () => {
    const stale = staleCacheNames(policy, cacheName, await caches.keys());
    await Promise.all(stale.map((name) => caches.delete(name)));
  };

  // The network's response, stored for offline use; the cached copy only when the fetch fails.
  const networkFirst = async (request: Request, key: string) => {
    const cache = await caches.open(cacheName);
    try {
      return await fetchAndStore(cache, key, request);
    } catch (error) {
      const cached = await cache.match(key);
      if (cached === undefined) {
        throw error;
      }
      return cached;
    }
  };

  const cacheFirst = async (request: Request, key: string) => {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(key);
    return cached ?? fetchAndStore(cache, key, request);
  };

  const responders: Record<
    Exclude<FetchStrategy, "network-only">,
    (request: Request, key: string) => Promise<Response>
  > = {
    "cache-first": cacheFirst,
    "network-first": networkFirst,
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
    if (strategy !== "network-only") {
      event.respondWith(responders[strategy](request, cacheKeyFor(url.pathname)));
    }
  });
}
