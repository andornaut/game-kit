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

// Only a whole response is stored: Cache.put rejects a 206, which an audio element's range
// request can get. Validate before answering, even when the cache write cannot succeed.
async function fetchAndStore(
  cache: Cache,
  contentHash: string | undefined,
  key: string,
  request: Request,
): Promise<Response> {
  const response = await fetch(request);
  if (
    contentHash !== undefined &&
    (response.status !== 200 || (await responseContentHash(response)) !== contentHash)
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
// (PrecacheManifest's) where it has one, a write that fails, or an attempt still unfinished after
// PRECACHE_TIMEOUT_MS, counts as a failed attempt.
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
    const abort = new AbortController();
    const timer = setTimeout(() => {
      abort.abort(new Error(`No answer within ${PRECACHE_TIMEOUT_MS} ms for ${url}`));
    }, PRECACHE_TIMEOUT_MS);
    try {
      // eslint-disable-next-line no-await-in-loop
      const response = await fetch(
        new Request(url, {
          ...precacheFetchOptions(policy, url),
          priority: "low",
          signal: abort.signal,
        }),
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
    } finally {
      clearTimeout(timer);
    }
  }
  return { error, url };
}

// Stages the selected sound format and all common files in a separate build cache. Installation
// succeeds only after every required response is stored and verified. Document pins preserve
// their build's manifest and assets across another document's explicit activation and reload.
// An activation handshake refuses unknown peers and incomplete stages. Cache reclamation occurs
// only at a client-free activation; missing visibility or metadata preserves old builds.
export function runServiceWorker(policy: CachePolicy, manifest: PrecacheManifest): void {
  const worker = self as unknown as WorkerScope;
  const cacheName = cacheNameFor(policy, manifest.version);
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
    return (await response.json()) as BuildRecord;
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
      staleCacheNames(policy, cacheName, await caches.keys())
        .filter((name) => name !== routingName)
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
    await writeRecord("build", cacheName, { manifest, urls: listedUrls });
  };

  const currentBuild: BuildRecord = {
    manifest,
    urls: installUrls(manifest, new URL(worker.location.href).searchParams.get(SOUND_FORMAT_PARAM)),
  };
  const completeBuild = async (name: string, build: BuildRecord): Promise<boolean> => {
    const cache = await caches.open(name);
    const complete = await mapBounded(
      REUSE_CONCURRENCY,
      async (url) =>
        (await storedCopy([cache], url, build.manifest.contentHashes[url])) !== undefined,
      build.urls,
    );
    return complete.every(Boolean);
  };
  const selectCompleteBuild = async (): Promise<boolean> => {
    // Persist failure first so an interrupted activation cannot select an incomplete cache.
    await writeRecord("selection", cacheName, null);
    if (await completeBuild(cacheName, currentBuild)) {
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
    if (record === undefined) {
      if (await completeBuild(cacheName, currentBuild)) {
        return cacheName;
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
    const stale = staleCacheNames(policy, cacheName, await caches.keys()).filter(
      (name) => name !== routingName,
    );
    const records = await routing();
    const keys = await records.keys();
    await Promise.all(
      stale.map(async (name) => {
        await caches.delete(name);
        await records.delete(recordUrl("build", name));
      }),
    );
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
    const response =
      (await cache.match(key)) ??
      (await fetchAndStore(cache, build.contentHashes[key], key, request));
    // The new document cannot request any resources until its pin has been persisted.
    if (navigation && resultingClientId) {
      await writeRecord("client", resultingClientId, pinned);
    }
    return response;
  };

  const requestActivation = async (event: MessageRequestEvent) => {
    const port = event.ports[0];
    // Legacy callers have no handshake and cannot safely distinguish a refused switch.
    if (port === undefined) {
      return;
    }
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
      if (!(await completeBuild(cacheName, currentBuild)) || Date.now() >= deadline) {
        port.postMessage("blocked");
        return;
      }
      // No asynchronous work may intervene between the deadline check and activation.
      await worker.skipWaiting();
      port.postMessage("activating");
    } catch {
      port.postMessage("blocked");
    }
  };

  worker.addEventListener("install", (event) => event.waitUntil(precache()));
  worker.addEventListener("activate", (event) =>
    event.waitUntil(
      (async () => {
        if (await selectCompleteBuild()) {
          await deleteStaleCaches();
        }
      })().catch(() => undefined),
    ),
  );
  worker.addEventListener("message", (event) => {
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
