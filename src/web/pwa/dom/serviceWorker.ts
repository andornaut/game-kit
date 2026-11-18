// The router service worker. A game's worker entry calls runServiceWorker with its cache policy,
// and vite/precachePlugin builds the entry to one classic script. The page downloads, verifies
// and stores each build and its manifest, and writes the active and staged records
// (buildContract). The worker downloads nothing: it serves each window the build its pin names,
// or the active build, from that build's cache. The worker runs in a ServiceWorkerGlobalScope,
// which the DOM typings do not describe, so the few members it uses are declared here.
//
// CLEANUP (added 2026-11-18): remove once all three games deploy the router. Version caches and
// routing records an earlier kit's worker wrote are left in place for the page to migrate and
// delete; the router never reads or serves them.
import {
  BUILD_HASH_HEADER,
  buildCacheName,
  type BuildFile,
  buildManifestUrl,
  type BuildPolicy,
  recordsCacheName,
} from "../buildContract.ts";
import { cacheKeyFor } from "../cachePolicy.ts";
import { validateVerifiedJsonBodies, type VerifiedJsonBody } from "../verifiedJsonBody.ts";

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
  readonly clients: { claim(): Promise<void> };
  addEventListener(type: "activate" | "install", listener: (event: LifecycleEvent) => void): void;
  addEventListener(type: "fetch", listener: (event: FetchRequestEvent) => void): void;
  readonly location: { readonly origin: string };
  skipWaiting(): Promise<void>;
}

// Record entries in the records cache. Each body is the JSON object {"version": string}. The
// page writes active and staged; the worker writes one pin per client. The page saves each
// build's manifest in the same cache under its buildManifestUrl.
const RECORDS_PATH = "/.game-kit/records/";
const ACTIVE_RECORD = `${RECORDS_PATH}active`;
const STAGED_RECORD = `${RECORDS_PATH}staged`;
const pinRecord = (clientId: string) => `${RECORDS_PATH}pin/${encodeURIComponent(clientId)}`;

const versionRecord = (version: string) =>
  new Response(JSON.stringify({ version }), {
    headers: { "content-type": "application/json" },
  });

// How many cache entries a completeness check reads at once.
const CHECK_CONCURRENCY = 16;

interface Build {
  readonly version: string;
  // Each file by its logical URL.
  readonly files: ReadonlyMap<string, BuildFile>;
  // The verified JSON family of each member URL.
  readonly families: ReadonlyMap<string, VerifiedJsonBody>;
}

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
const dataProfile = (family: VerifiedJsonBody) => family.responseProfile === "fetch-json-data-v1";

// A guarded data request: the only context a fetch-json-data-v1 body alias may answer.
const dataRequest = (request: Request) =>
  request.destination === "" &&
  request.mode !== "navigate" &&
  !request.headers.has("range") &&
  !request.headers.has("if-range");

// Whether a verified JSON response's status and headers leave its body's meaning unchanged.
function safeJsonHeaders(verified: VerifiedSource, response: Response): boolean {
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
    ![
      "identity",
      "gzip",
      "br",
      "deflate",
      ...(dataProfile(verified.family) ? ["zstd"] : []),
    ].includes(encoding)
  ) {
    return false;
  }
  const length = headers.get("content-length");
  return (
    length === null ||
    (/^\d+$/.test(length) &&
      Number.isSafeInteger(Number(length)) &&
      ((encoding !== undefined && encoding !== "identity") ||
        Number(length) === verified.family.byteSize))
  );
}

// A network response qualifies only from the exact same-origin URL it was requested at.
function safeJsonSource(verified: VerifiedSource, url: string, response: Response): boolean {
  return (
    safeJsonHeaders(verified, response) &&
    response.url !== "" &&
    new URL(response.url).origin === verified.origin &&
    response.url === new URL(url, verified.origin).href
  );
}

// A stored entry carries the page's verification header instead of a source URL. An entry with
// a source URL must still name its exact same-origin URL.
function safeStoredJson(verified: VerifiedSource, url: string, response: Response): boolean {
  return (
    safeJsonHeaders(verified, response) &&
    response.headers.get(BUILD_HASH_HEADER) === verified.family.sha256 &&
    (response.url === "" || safeJsonSource(verified, url, response))
  );
}

const digestHex = (digest: ArrayBuffer) =>
  [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
const sha256Hex = async (body: ArrayBuffer) =>
  digestHex(await crypto.subtle.digest("SHA-256", body));
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

const isVersion = (value: unknown): value is string => typeof value === "string" && value !== "";

// A version record's version, or undefined for a missing or malformed record.
async function readVersion(records: Cache, url: string): Promise<string | undefined> {
  try {
    const value: unknown = await (await records.match(url))?.json();
    const version =
      typeof value === "object" && value !== null
        ? (value as { version?: unknown }).version
        : undefined;
    return isVersion(version) ? version : undefined;
  } catch {
    return undefined;
  }
}

// The build of a saved manifest, or undefined where it is missing or invalid.
function parseBuild(version: string, value: unknown): Build | undefined {
  const manifest = value as {
    files?: unknown;
    schema?: unknown;
    verifiedJsonBodies?: unknown;
    version?: unknown;
  } | null;
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    manifest.schema !== 1 ||
    manifest.version !== version ||
    !Array.isArray(manifest.files)
  ) {
    return undefined;
  }
  const files = new Map<string, BuildFile>();
  for (const file of manifest.files as Partial<BuildFile>[]) {
    if (
      typeof file?.url !== "string" ||
      !file.url.startsWith("/") ||
      typeof file.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      !Number.isSafeInteger(file.byteSize) ||
      (file.byteSize as number) < 0 ||
      files.has(file.url)
    ) {
      return undefined;
    }
    files.set(file.url, { byteSize: file.byteSize as number, sha256: file.sha256, url: file.url });
  }
  try {
    const families = new Map<string, VerifiedJsonBody>();
    for (const family of validateVerifiedJsonBodies(
      {
        byteSizes: Object.fromEntries([...files.values()].map((file) => [file.url, file.byteSize])),
        urls: [...files.keys()],
      },
      (manifest.verifiedJsonBodies ?? []) as VerifiedJsonBody[],
    )) {
      for (const url of family.urls) {
        if (files.get(url)?.sha256 !== family.sha256) {
          return undefined;
        }
        families.set(url, family);
      }
    }
    return { families, files, version };
  } catch {
    return undefined;
  }
}

// Serves each navigation and same-origin GET from the build its document is pinned to, or the
// active build for a document with no pin, and pins the document to the build that served it.
// A navigation with a complete staged build first promotes it to active. Without an active
// build, and for a URL the build does not list, the request goes to the network.
export function runServiceWorker(policy: BuildPolicy): void {
  const worker = self as unknown as WorkerScope;
  // Manifests are immutable per version, and a pin never changes for its client.
  const builds = new Map<string, Promise<Build | undefined>>();
  const pins = new Map<string, string>();

  const openRecords = async (): Promise<Cache | undefined> => {
    try {
      return await caches.open(recordsCacheName(policy));
    } catch {
      return undefined;
    }
  };

  const loadBuild = (records: Cache, version: string): Promise<Build | undefined> => {
    let build = builds.get(version);
    if (build === undefined) {
      build = (async () => {
        try {
          return parseBuild(
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
    const version = await readVersion(records, pinRecord(clientId));
    if (version !== undefined) {
      pins.set(clientId, version);
    }
    return version;
  };

  const writePin = async (records: Cache, clientId: string, version: string) => {
    await records.put(pinRecord(clientId), versionRecord(version));
    pins.set(clientId, version);
  };

  // Complete: every file of the manifest is stored with its verified digest in the header.
  const complete = async (build: Build): Promise<boolean> => {
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
    const verified = await mapBounded(
      CHECK_CONCURRENCY,
      async (file) => (await cache.match(file.url))?.headers.get(BUILD_HASH_HEADER) === file.sha256,
      files,
    );
    return verified.every(Boolean);
  };

  // The silent launch switch: a complete staged build becomes active before the navigation
  // that loads game code is answered. An incomplete one stays staged for the page to repair.
  const promoteStaged = async (records: Cache) => {
    const staged = await readVersion(records, STAGED_RECORD);
    if (staged === undefined) {
      return;
    }
    if (staged !== (await readVersion(records, ACTIVE_RECORD))) {
      const build = await loadBuild(records, staged);
      if (build === undefined || !(await complete(build))) {
        return;
      }
      await records.put(ACTIVE_RECORD, versionRecord(staged));
    }
    // The page may have staged a newer build meanwhile; that record stays.
    if ((await readVersion(records, STAGED_RECORD)) === staged) {
      await records.delete(STAGED_RECORD);
    }
  };

  const fileFor = (build: Build, request: Request) =>
    build.files.get(cacheKeyFor(new URL(request.url).pathname));

  // Stores a network copy of an evicted file only where its bytes match the manifest.
  const storeVerified = async (cache: Cache, file: BuildFile, response: Response) => {
    if (response.status !== 200 || response.redirected) {
      return;
    }
    const body = await response.arrayBuffer();
    if (body.byteLength !== file.byteSize || (await sha256Hex(body)) !== file.sha256) {
      return;
    }
    await cache.put(file.url, storedCopy(file, body, response));
  };

  // A verified JSON network response: credentials omitted, redirects refused, and its source,
  // headers, size and full SHA-256 checked before it answers or is stored.
  const fetchVerifiedJson = async (
    cache: Cache,
    verified: VerifiedSource,
    file: BuildFile,
    request: Request,
  ): Promise<{ body: ArrayBuffer; response: Response }> => {
    const response = await fetch(new Request(request, { credentials: "omit", redirect: "error" }));
    if (!safeJsonSource(verified, file.url, response)) {
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
    verified: VerifiedSource,
    file: BuildFile,
  ): Promise<{ body: ArrayBuffer; response: Response } | undefined> => {
    const response = await cache.match(file.url);
    if (response === undefined || !safeStoredJson(verified, file.url, response)) {
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
    const verified = { family, origin: worker.location.origin };
    if (!dataProfile(family)) {
      return (
        (await storedJson(cache, verified, file)) ??
        (await fetchVerifiedJson(cache, verified, file, request))
      ).response;
    }
    if (request.url !== new URL(file.url, worker.location.origin).href) {
      throw new TypeError("Profile JSON requires its exact canonical URL");
    }
    if (!dataRequest(request)) {
      return (await fetchVerifiedJson(cache, verified, file, request)).response;
    }
    const { body } =
      (await storedJson(cache, verified, file)) ??
      (await fetchVerifiedJson(cache, verified, file, request));
    return jsonResponse(body);
  };

  // A stored entry is served by presence and its digest header. A missing one, such as an
  // evicted file, is fetched from the network and served, and stored if it matches.
  const serve = async (
    event: FetchRequestEvent,
    build: Build,
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
    event.waitUntil(storeVerified(cache, file, response.clone()).catch(() => undefined));
    return response;
  };

  const route = async (event: FetchRequestEvent): Promise<Response> => {
    const { clientId, request, resultingClientId } = event;
    const records = await openRecords();
    if (records === undefined) {
      return fetch(request);
    }
    const navigation = request.mode === "navigate";
    const client = navigation ? resultingClientId : clientId;
    const pinned = client ? await readPin(records, client) : undefined;
    if (navigation && pinned === undefined) {
      await promoteStaged(records).catch(() => undefined);
    }
    const version = pinned ?? (await readVersion(records, ACTIVE_RECORD));
    const build = version === undefined ? undefined : await loadBuild(records, version);
    if (build === undefined) {
      return fetch(request);
    }
    const file = fileFor(build, request);
    if (navigation && file === undefined) {
      return fetch(request);
    }
    // A document's pin is stored before its response, so its first subresource finds it. A
    // document with no pin, such as a first install's, is pinned at its first request.
    if (client && pinned === undefined) {
      await writePin(records, client, build.version);
    }
    return file === undefined ? fetch(request) : serve(event, build, file);
  };

  worker.addEventListener("install", (event) => event.waitUntil(worker.skipWaiting()));
  worker.addEventListener("activate", (event) => event.waitUntil(worker.clients.claim()));
  worker.addEventListener("fetch", (event) => {
    const { request } = event;
    if (request.method !== "GET" || new URL(request.url).origin !== worker.location.origin) {
      return;
    }
    event.respondWith(route(event));
  });
}
