// The service worker's behaviour. A game's worker entry calls runServiceWorker with its cache
// policy and the precache manifest the build writes in (vite/precachePlugin), and the plugin
// builds the entry to one classic script. The worker runs in a ServiceWorkerGlobalScope, which the
// DOM typings do not describe, so the few members it uses are declared here. It imports only
// cachePolicy.ts, and types, so the built worker holds nothing else.
import {
  cachedUrlsOf,
  cacheKeyFor,
  cacheNameFor,
  type CachePolicy,
  type FetchStrategy,
  installUrls,
  precacheFetchOptions,
  staleCacheNames,
  strategyFor,
} from "./cachePolicy";
import type { PrecacheManifest } from "./precacheList";
import type { SoundFormatParam } from "./serviceWorkerUrl";
import type { SkipWaitingMessage } from "./updateReady";

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
  readonly location: Location;
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

// Precaches manifest on install, deletes the policy's other caches on activate and answers
// same-origin GETs by strategyFor. No skipWaiting on install: a new worker waits until every page
// the old one controls has closed, so a running game never has its cache deleted or its code
// swapped. It takes over on the next launch, or when the page posts the skip-waiting message
// (updateReady's activateWaitingWorker) and reloads once this worker controls it.
export function runServiceWorker(policy: CachePolicy, manifest: PrecacheManifest): void {
  const worker = self as unknown as WorkerScope;
  const cacheName = cacheNameFor(policy, manifest.version);
  const cachedUrls = cachedUrlsOf(manifest);

  const precache = async () => {
    const soundFormat = new URL(worker.location.href).searchParams.get(SOUND_FORMAT_PARAM);
    const urls = installUrls(manifest, soundFormat);
    const cache = await caches.open(cacheName);
    await cache.addAll(urls.map((url) => new Request(url, precacheFetchOptions(policy, url))));
  };

  const deleteStaleCaches = async () => {
    const stale = staleCacheNames(policy, cacheName, await caches.keys());
    await Promise.all(stale.map((name) => caches.delete(name)));
  };

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
