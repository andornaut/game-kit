// The router service worker. A game's worker entry calls runServiceWorker with its cache policy,
// and build/vite/precachePlugin builds the entry to one classic script. The page downloads, verifies
// and stores each build's archive or manifest and files, and writes the active and staged records
// (buildContract). The worker downloads nothing: it serves each window the build its pin names,
// or the active build, from that build's cache, and deletes the pins of closed clients, so the
// page's reclaim keeps only builds a live window runs. The worker runs in a
// ServiceWorkerGlobalScope, which the DOM typings do not describe, so the few members it uses are
// declared here.
//
// CLEANUP (added 2026-11-18): remove once all three games deploy the router. Version caches and
// routing records an earlier kit's worker wrote are left in place for the page to migrate and
// delete; the router never reads or serves them.
import { mapLimit } from "../../../mapLimit.ts";
import {
  ACTIVE_RECORD_PATH,
  BUILD_HASH_HEADER,
  buildCacheName,
  type BuildFile,
  buildManifestUrl,
  type BuildPolicy,
  cacheKeyFor,
  intervalElapsed,
  PIN_PRUNE_MS,
  pinnedClient,
  pinRecordPath,
  RECORD_CONTENT_TYPE,
  recordsCacheName,
  type RouterBuild,
  routerBuild,
  routesRequest,
  settledPins,
  STAGED_RECORD_PATH,
  type VerifiedJsonBody,
  versionRecordText,
} from "../index.ts";
import { BUILD_ARCHIVE_ROUTER_PROBE, BUILD_GROUP_ROUTER_PROBE } from "./buildArchiveRouter.ts";
import { createBuildArchiveStore } from "./buildArchiveStore.ts";
import { type BuildGroupFile, createBuildGroupStore } from "./buildGroupStore.ts";
import { readCachedVersion, withBuildStateLock } from "./buildStore.ts";
import { sha256Hex } from "./sha256.ts";
import {
  isDataProfile,
  isDataRequest,
  safeJsonSource,
  safeStoredJson,
} from "./verifiedJsonSource.ts";

interface LifecycleEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}

interface FetchRequestEvent extends LifecycleEvent {
  readonly request: Request;
  readonly clientId: string;
  readonly resultingClientId: string;
  respondWith(response: Promise<Response>): void;
}

interface WorkerScope {
  readonly clients: {
    claim(): Promise<void>;
    matchAll(options: {
      includeUncontrolled: boolean;
      type: "all";
    }): Promise<readonly { readonly id: string }[]>;
  };
  addEventListener(type: "activate" | "install", listener: (event: LifecycleEvent) => void): void;
  addEventListener(type: "fetch", listener: (event: FetchRequestEvent) => void): void;
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  readonly location: { readonly origin: string };
  skipWaiting(): Promise<void>;
}

// The page writes the active and staged records and each build's manifest; the worker writes one
// pin per client (buildContract).
const versionRecord = (version: string) =>
  new Response(versionRecordText(version), {
    headers: { "content-type": RECORD_CONTENT_TYPE },
  });

// How many cache entries a completeness check reads at once.
const CHECK_CONCURRENCY = 16;
const RETAINED_ARCHIVES = 2;

export { PIN_PRUNE_MS } from "../index.ts";

type RoutedFiles = ReadonlyMap<string, BuildGroupFile>;

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
};

const jsonResponse = (body: ArrayBuffer) => new Response(body, { headers: JSON_HEADERS });

// The entry stored for a verified network body. The body is already decoded, so the transfer
// headers are dropped, and the digest header records the verification.
function storedCopy(file: BuildFile, body: ArrayBuffer, source: Response): Response {
  const headers = new Headers(source.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  headers.set(BUILD_HASH_HEADER, file.sha256);
  return new Response(body, { headers, status: 200, statusText: source.statusText });
}

// A version record's version, or undefined for a missing or malformed record.
async function readVersion(records: Cache, url: string): Promise<string | undefined> {
  return readCachedVersion(await records.match(url));
}

// Serves each navigation and same-origin GET other than a no-store one from the build its
// document is pinned to, or the active build for a document with no pin, and pins the document to
// the build that served it. A navigation with a complete staged build first promotes it to
// active. Without an active build, and for a URL the build does not list, such as a sound
// alternative the device did not install (buildRecords' installedManifest), the request goes to
// the network. Pins of closed clients are deleted at activate and, at most once per PIN_PRUNE_MS, on
// navigation.
export function runServiceWorker(policy: BuildPolicy): void {
  const worker = self as unknown as WorkerScope;
  let archiveStore: ReturnType<typeof createBuildArchiveStore> | undefined;
  let groupStore: ReturnType<typeof createBuildGroupStore> | undefined;
  // Manifests are immutable per version, and a pin never changes for its client.
  const builds = new Map<string, Promise<RouterBuild | undefined>>();
  const pins = new Map<string, string>();

  const readArchivedFiles = async (version: string): Promise<RoutedFiles | undefined> => {
    groupStore ??= createBuildGroupStore({ caches, origin: worker.location.origin, policy });
    const grouped = await groupStore.read(version);
    if (grouped.kind === "unavailable") {
      builds.delete(version);
      throw new TypeError(`Build groups unavailable for ${version}`);
    }
    if (grouped.kind === "ready") {
      builds.delete(version);
      return grouped.files;
    }
    archiveStore ??= createBuildArchiveStore({ caches, origin: worker.location.origin, policy });
    const stored = await archiveStore.read(version);
    if (stored.kind === "unknown") {
      return undefined;
    }
    if (stored.kind === "unavailable") {
      throw new TypeError(`Build archive unavailable for ${version}`);
    }
    return new Map(
      stored.index.files.map(({ byteSize, contentType, offset, url }) => [
        url,
        { blob: stored.blob, byteSize, contentType, offset },
      ]),
    );
  };

  // Keep recent verified snapshots, including concurrent reads of the same version. Only
  // successful reads stay cached, so the page can still install or repair an archive.
  const archives = new Map<string, Promise<RoutedFiles | undefined>>();
  const rememberArchive = (version: string, archive: Promise<RoutedFiles | undefined>) => {
    archives.delete(version);
    archives.set(version, archive);
    if (archives.size > RETAINED_ARCHIVES) {
      archives.delete(archives.keys().next().value!);
    }
  };
  const loadArchive = (version: string) => {
    const cached = archives.get(version);
    const archive = cached ?? readArchivedFiles(version);
    rememberArchive(version, archive);
    if (cached === undefined) {
      const remove = () => {
        if (archives.get(version) === archive) {
          archives.delete(version);
        }
      };
      void archive.then((loaded) => {
        if (loaded === undefined) {
          remove();
        }
      }, remove);
    }
    return archive;
  };

  const loadBuild = (records: Cache, version: string): Promise<RouterBuild | undefined> => {
    let build = builds.get(version);
    if (build === undefined) {
      build = (async () => {
        try {
          return routerBuild(
            version,
            await (await records.match(buildManifestUrl(version)))?.json(),
          );
        } catch {
          return undefined;
        }
      })();
      builds.set(version, build);
      // A manifest the page has not saved yet may be saved later.
      void build.then((loaded) => {
        if (loaded === undefined) {
          builds.delete(version);
        }
      });
    }
    return build;
  };

  const readPin = async (records: Cache, clientId: string): Promise<string | undefined> => {
    const known = pins.get(clientId);
    if (known !== undefined) {
      return known;
    }
    const version = await readVersion(records, pinRecordPath(clientId));
    if (version !== undefined) {
      pins.set(clientId, version);
    }
    return version;
  };

  // When this worker wrote each pin, so a prune spares a client that is not listed yet.
  const pinnedAt = new Map<string, number>();
  const writePin = async (records: Cache, clientId: string, version: string) => {
    await records.put(pinRecordPath(clientId), versionRecord(version));
    pins.set(clientId, version);
    pinnedAt.set(clientId, Date.now());
  };

  // Deletes every pin whose client is gone. Worker clients are listed too, since the router pins
  // every client that requests a build file.
  const prunePins = async () => {
    const name = recordsCacheName(policy);
    if (!(await caches.has(name))) {
      return;
    }
    const records = await caches.open(name);
    const live = new Set(
      (await worker.clients.matchAll({ includeUncontrolled: true, type: "all" })).map(
        (client) => client.id,
      ),
    );
    for (const clientId of settledPins(Date.now(), pinnedAt)) {
      pinnedAt.delete(clientId);
    }
    await Promise.all(
      (await records.keys()).map(async (request) => {
        const clientId = pinnedClient(new URL(request.url).pathname);
        if (clientId === undefined || live.has(clientId) || pinnedAt.has(clientId)) {
          return;
        }
        pins.delete(clientId);
        await records.delete(request);
      }),
    );
  };

  // Prunes at once with force, as at activate; otherwise at most once per PIN_PRUNE_MS.
  let lastPrune: number | undefined;
  let pruning: Promise<void> | undefined;
  const prune = (force: boolean): Promise<void> | undefined => {
    const now = Date.now();
    if (pruning !== undefined || (!force && !intervalElapsed(now, lastPrune, PIN_PRUNE_MS))) {
      return pruning;
    }
    lastPrune = now;
    pruning = prunePins()
      .catch(() => undefined)
      .finally(() => {
        pruning = undefined;
      });
    return pruning;
  };

  // Complete: every file of the manifest is stored with its verified digest in the header.
  const complete = async (build: RouterBuild): Promise<boolean> => {
    const name = buildCacheName(policy, build.version);
    if (!(await caches.has(name))) {
      return false;
    }
    const cache = await caches.open(name);
    const stored = new Set((await cache.keys()).map((request) => new URL(request.url).pathname));
    const files = [...build.files.values()];
    if (files.some((file) => !stored.has(file.url))) {
      return false;
    }
    const verified = await mapLimit(
      CHECK_CONCURRENCY,
      async (file) => (await cache.match(file.url))?.headers.get(BUILD_HASH_HEADER) === file.sha256,
      files,
    );
    return verified.every(Boolean);
  };

  // The silent launch switch: a complete staged build becomes active before the navigation
  // that loads game code is answered. An incomplete one stays staged for the page to repair.
  const promoteStaged = async (records: Cache) => {
    // A transient read refusal is a routing fallback, never permission to write active.
    const versionAt = (path: string) => readVersion(records, path);
    const staged = await versionAt(STAGED_RECORD_PATH);
    if (staged === undefined) {
      return;
    }
    const active = await versionAt(ACTIVE_RECORD_PATH);
    // Check persisted completeness, even if the worker holds a previously read snapshot.
    const archive = await readArchivedFiles(staged);
    if (archive === undefined && staged !== active) {
      const build = await loadBuild(records, staged);
      if (build === undefined || !(await complete(build))) {
        return;
      }
    }
    await withBuildStateLock(policy, async () => {
      if (
        (await versionAt(STAGED_RECORD_PATH)) !== staged ||
        (await versionAt(ACTIVE_RECORD_PATH)) !== active
      ) {
        return;
      }
      if (staged !== active) {
        await records.put(ACTIVE_RECORD_PATH, versionRecord(staged));
      }
      if ((await versionAt(STAGED_RECORD_PATH)) === staged) {
        await records.delete(STAGED_RECORD_PATH);
      }
      if (archive !== undefined) {
        rememberArchive(staged, Promise.resolve(archive));
      }
    });
  };

  // A verified JSON network response: credentials omitted, redirects refused, and its source,
  // headers, size and full SHA-256 checked before it answers or is stored.
  const fetchVerifiedJson = async (
    cache: Cache,
    family: VerifiedJsonBody,
    file: BuildFile,
    request: Request,
  ): Promise<{ body: ArrayBuffer; response: Response }> => {
    const response = await fetch(new Request(request, { credentials: "omit", redirect: "error" }));
    if (!safeJsonSource(worker.location.origin, family, file.url, response)) {
      throw new TypeError("Unsafe verified JSON response semantics");
    }
    const body = await response.clone().arrayBuffer();
    if (body.byteLength !== file.byteSize || (await sha256Hex(body)) !== file.sha256) {
      throw new TypeError(`Response does not match the build for ${file.url}`);
    }
    await cache.put(file.url, storedCopy(file, body, response)).catch(() => undefined);
    return { body, response };
  };

  // A stored verified JSON entry whose headers and full identity still check out.
  const storedJson = async (
    cache: Cache,
    family: VerifiedJsonBody,
    file: BuildFile,
  ): Promise<{ body: ArrayBuffer; response: Response } | undefined> => {
    const response = await cache.match(file.url);
    if (response === undefined || !safeStoredJson(family, response)) {
      return undefined;
    }
    const body = await response.clone().arrayBuffer();
    return body.byteLength === file.byteSize && (await sha256Hex(body)) === file.sha256
      ? { body, response }
      : undefined;
  };

  // Legacy families serve their verified response in every context. A fetch-json-data-v1 body
  // answers only an exact canonical guarded data request, with the canonical JSON headers;
  // every other context gets its own original response from the network.
  const serveVerifiedJson = async (
    cache: Cache,
    family: VerifiedJsonBody,
    file: BuildFile,
    request: Request,
  ): Promise<Response> => {
    if (!isDataProfile(family)) {
      return (
        (await storedJson(cache, family, file)) ??
        (await fetchVerifiedJson(cache, family, file, request))
      ).response;
    }
    if (request.url !== new URL(file.url, worker.location.origin).href) {
      throw new TypeError("Profile JSON requires its exact canonical URL");
    }
    if (!isDataRequest(request)) {
      return (await fetchVerifiedJson(cache, family, file, request)).response;
    }
    const { body } =
      (await storedJson(cache, family, file)) ??
      (await fetchVerifiedJson(cache, family, file, request));
    return jsonResponse(body);
  };

  // A stored entry is served by presence and its digest header. A missing one, such as an
  // evicted file, is served and stored only after verifying the network response.
  const serve = async (
    event: FetchRequestEvent,
    build: RouterBuild,
    file: BuildFile,
  ): Promise<Response> => {
    const cache = await caches.open(buildCacheName(policy, build.version));
    const family = build.families.get(file.url);
    if (family !== undefined) {
      return serveVerifiedJson(cache, family, file, event.request);
    }
    const stored = await cache.match(file.url);
    if (stored?.headers.get(BUILD_HASH_HEADER) === file.sha256) {
      return stored;
    }
    const response = await fetch(event.request);
    if (response.status !== 200 || response.redirected || response.headers.has("content-range")) {
      throw new TypeError(`Expected a complete, non-redirected response for ${file.url}`);
    }
    const body = await response.clone().arrayBuffer();
    if (body.byteLength !== file.byteSize || (await sha256Hex(body)) !== file.sha256) {
      throw new TypeError(`Response does not match the build for ${file.url}`);
    }
    event.waitUntil(cache.put(file.url, storedCopy(file, body, response)).catch(() => undefined));
    return response;
  };

  const route = async (event: FetchRequestEvent): Promise<Response> => {
    const { clientId, request, resultingClientId } = event;
    const records = await caches.open(recordsCacheName(policy));
    const navigation = request.mode === "navigate";
    const client = navigation ? resultingClientId : clientId;
    const pinned = client ? await readPin(records, client) : undefined;
    if (navigation && pinned === undefined) {
      await promoteStaged(records).catch(() => undefined);
    }
    const version = pinned ?? (await readVersion(records, ACTIVE_RECORD_PATH));
    if (version === undefined) {
      return fetch(request);
    }
    // The legacy manifest already identifies this document's immutable build. Check for an
    // archive again on navigation, when another context may have staged that version.
    const legacy = navigation ? undefined : await builds.get(version);
    const archive = legacy === undefined ? await loadArchive(version) : undefined;
    const build =
      archive === undefined ? (legacy ?? (await loadBuild(records, version))) : undefined;
    const path = cacheKeyFor(new URL(request.url).pathname);
    const entry = archive?.get(path);
    const file = build?.files.get(path);
    if (
      (archive === undefined && build === undefined) ||
      (navigation && entry === undefined && file === undefined)
    ) {
      return fetch(request);
    }
    // A document's pin is stored before its response, so its first subresource finds it. A
    // document with no pin, such as a first install's, is pinned at its first request.
    if (client && pinned === undefined) {
      await writePin(records, client, version);
    }
    if (entry !== undefined) {
      const { blob, byteSize, contentType, offset } = entry;
      return new Response(blob.slice(offset, offset + byteSize, contentType), {
        headers: {
          "content-length": String(byteSize),
          "content-type": contentType,
          "x-content-type-options": "nosniff",
        },
      });
    }
    return build !== undefined && file !== undefined ? serve(event, build, file) : fetch(request);
  };

  worker.addEventListener("install", (event) => event.waitUntil(worker.skipWaiting()));
  worker.addEventListener("activate", (event) =>
    event.waitUntil(worker.clients.claim().then(() => prune(true))),
  );
  worker.addEventListener("message", (event) => {
    if (event.data === BUILD_ARCHIVE_ROUTER_PROBE || event.data === BUILD_GROUP_ROUTER_PROBE) {
      event.ports[0]?.postMessage(event.data);
    }
  });
  worker.addEventListener("fetch", (event) => {
    const { request } = event;
    const { cache, method, url } = request;
    if (!routesRequest(worker.location.origin, { cache, method, origin: new URL(url).origin })) {
      return;
    }
    event.respondWith(route(event));
    const pruned = request.mode === "navigate" ? prune(false) : undefined;
    if (pruned !== undefined) {
      event.waitUntil(pruned);
    }
  });
}
