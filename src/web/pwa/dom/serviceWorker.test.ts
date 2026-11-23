import { createHash } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { encodeBuildArchiveIndex } from "../buildArchive.ts";
import {
  BUILD_HASH_HEADER,
  buildArchivePartUrl,
  buildCacheName,
  type BuildManifest,
  buildManifestUrl,
  type BuildPointer,
  type BuildPolicy,
  GROUP_ARCHIVE_IDENTITY,
  recordsCacheName,
} from "../buildContract.ts";
import { installedManifest } from "../buildRecords.ts";
import type { VerifiedJsonBody } from "../verifiedJsonBody.ts";
import { BUILD_ARCHIVE_ROUTER_PROBE, BUILD_GROUP_ROUTER_PROBE } from "./buildArchiveRouter.ts";
import { createBuildArchiveStore } from "./buildArchiveStore.ts";
import { createBuildGroupStore } from "./buildGroupStore.ts";
import { createBuildStore } from "./buildStore.ts";
import { PIN_PRUNE_MS, runServiceWorker } from "./serviceWorker.ts";

const ORIGIN = "https://game.test";
const POLICY: BuildPolicy = { cacheNamePrefix: "game-", hashedAssetPrefix: "/assets/" };
const RECORDS = recordsCacheName(POLICY);
const ACTIVE = "/.game-kit/records/active";
const ARCHIVE_BODY = "/.game-kit/records/archive-body";
const STAGED = "/.game-kit/records/staged";
const pinKey = (id: string) => `/.game-kit/records/pin/${encodeURIComponent(id)}`;

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const pathOf = (key: Request | string) =>
  new URL(key instanceof Request ? key.url : key, ORIGIN).pathname;

class FakeCache {
  readonly entries = new Map<string, Response>();

  delete(key: Request | string): Promise<boolean> {
    return Promise.resolve(this.entries.delete(pathOf(key)));
  }

  keys(): Promise<Request[]> {
    return Promise.resolve([...this.entries.keys()].map((path) => new Request(ORIGIN + path)));
  }

  match(key: Request | string): Promise<Response | undefined> {
    const source = this.entries.get(pathOf(key));
    const response = source?.clone();
    if (response !== undefined && source!.url !== "") {
      Object.defineProperty(response, "url", { value: source!.url });
    }
    return Promise.resolve(response);
  }

  put(key: Request | string, response: Response): Promise<void> {
    this.entries.set(pathOf(key), response);
    return Promise.resolve();
  }

  async text(path: string): Promise<string | undefined> {
    return this.entries.get(path)?.clone().text();
  }
}

class FakeCaches {
  readonly named = new Map<string, FakeCache>();

  delete(name: string): Promise<boolean> {
    return Promise.resolve(this.named.delete(name));
  }

  has(name: string): Promise<boolean> {
    return Promise.resolve(this.named.has(name));
  }

  keys(): Promise<string[]> {
    return Promise.resolve([...this.named.keys()]);
  }

  async match(key: Request | string, { cacheName }: { cacheName: string }) {
    return this.named.get(cacheName)?.match(key);
  }

  open(name: string): Promise<FakeCache> {
    const cache = this.named.get(name) ?? new FakeCache();
    this.named.set(name, cache);
    return Promise.resolve(cache);
  }
}

const JSON_TYPE = { "content-type": "application/json; charset=utf-8" };

// Serves files by path, each response carrying its request URL as a browser fetch does.
class FakeServer {
  readonly fetched: string[] = [];
  readonly headers = new Map<string, Record<string, string>>();
  offline = false;

  constructor(readonly files: Record<string, string>) {}

  fetch(request: Request): Promise<Response> {
    const path = pathOf(request);
    this.fetched.push(path);
    if (this.offline) {
      return Promise.reject(new TypeError(`Failed to fetch ${path}`));
    }
    const response = new Response(this.files[path] ?? "missing", {
      headers: this.headers.get(path) ?? (path.endsWith(".json") ? JSON_TYPE : {}),
      status: path in this.files ? 200 : 404,
    });
    Object.defineProperty(response, "url", { value: request.url });
    return Promise.resolve(response);
  }
}

const manifestOf = (
  version: string,
  files: Record<string, string>,
  verifiedJsonBodies?: VerifiedJsonBody[],
): BuildManifest => ({
  boot: [],
  buildId: "a".repeat(40),
  files: Object.entries(files).map(([url, text]) => ({
    byteSize: new TextEncoder().encode(text).byteLength,
    sha256: sha256(text),
    url,
  })),
  schema: 1,
  sounds: {},
  version,
  ...(verifiedJsonBodies === undefined ? {} : { verifiedJsonBodies }),
});

const record = (version: string) => new Response(JSON.stringify({ version }));

function startWorker(server: FakeServer, storage = new FakeCaches()) {
  const listeners = new Map<string, (event: unknown) => void>();
  const fetches = vi.fn((request: Request) => server.fetch(request));
  vi.stubGlobal("caches", storage);
  vi.stubGlobal("fetch", fetches);
  const skipWaiting = vi.fn(() => Promise.resolve());
  const claim = vi.fn(() => Promise.resolve());
  // The open clients. A client that makes a request is open until close() removes it.
  const live = new Set<string>();
  const matchAll = vi.fn(() => Promise.resolve([...live].map((id) => ({ id }))));
  vi.stubGlobal("self", {
    addEventListener: (type: string, listener: (event: unknown) => void) =>
      listeners.set(type, listener),
    clients: { claim, matchAll },
    location: { origin: ORIGIN },
    skipWaiting,
  });
  runServiceWorker(POLICY);
  const records = () => storage.open(RECORDS);

  // Stores a build as the page does: its manifest in the records cache and each file, with its
  // digest header, in the build's cache. omit leaves files out, as an eviction would.
  const saveBuild = async (
    manifest: BuildManifest,
    files: Record<string, string>,
    { headers = {}, omit = [] }: { headers?: Record<string, string>; omit?: string[] } = {},
  ) => {
    await (
      await records()
    ).put(buildManifestUrl(manifest.version), new Response(JSON.stringify(manifest)));
    const cache = await storage.open(buildCacheName(POLICY, manifest.version));
    for (const file of manifest.files) {
      if (!omit.includes(file.url)) {
        // Sequential writes keep the fake deterministic.
        // eslint-disable-next-line no-await-in-loop
        await cache.put(
          file.url,
          new Response(files[file.url], {
            headers: {
              ...(file.url.endsWith(".json") ? JSON_TYPE : {}),
              ...headers,
              [BUILD_HASH_HEADER]: file.sha256,
            },
          }),
        );
      }
    }
  };
  const setRecord = async (key: string, version: string) =>
    (await records()).put(key, record(version));
  const readRecord = async (key: string) =>
    (
      (await (await records()).match(key))?.json() as Promise<{ version: string }> | undefined
    )?.then((value) => value.version);

  const lifecycle = async (type: "activate" | "install") => {
    let done: unknown;
    listeners.get(type)?.({ waitUntil: (promise: Promise<unknown>) => (done = promise) });
    await done;
  };

  // The worker's answer, or undefined where it leaves the request to the browser.
  const respond = async (
    request: Request,
    { clientId = "", resultingClientId = "" } = {},
  ): Promise<Response | undefined> => {
    for (const id of [clientId, resultingClientId]) {
      if (id !== "") {
        live.add(id);
      }
    }
    let answer: Promise<Response> | undefined;
    const extended: Promise<unknown>[] = [];
    listeners.get("fetch")?.({
      clientId,
      request,
      respondWith: (response: Promise<Response>) => (answer = response),
      resultingClientId,
      waitUntil: (promise: Promise<unknown>) => extended.push(promise),
    });
    if (answer === undefined) {
      return undefined;
    }
    const response = await answer;
    await Promise.all(extended);
    return response;
  };
  const navigate = (path: string, resultingClientId = "") => {
    const request = new Request(ORIGIN + path);
    Object.defineProperty(request, "mode", { value: "navigate" });
    Object.defineProperty(request, "destination", { value: "document" });
    return respond(request, { resultingClientId });
  };
  const get = (path: string, clientId = "", init?: RequestInit) =>
    respond(new Request(ORIGIN + path, init), { clientId });
  return {
    claim,
    close: (id: string) => live.delete(id),
    fetches,
    get,
    lifecycle,
    listeners,
    matchAll,
    navigate,
    readRecord,
    records,
    respondTo: (request: Request, clientId = "") => respond(request, { clientId }),
    saveBuild,
    setRecord,
    skipWaiting,
    storage,
  };
}

const V1 = { "/app.js": "app v1", "/play/": "page v1", "/sound/hit.ogg": "hit" };
const V2 = { "/app.js": "app v2", "/play/": "page v2", "/sound/hit.ogg": "hit" };

const ARCHIVED_FILES = {
  "/app.js": ["text/javascript; charset=utf-8", "app from archive"],
  "/play/": ["text/html; charset=utf-8", "<p>Archive</p>"],
  "/sound/hit.ogg": ["audio/ogg", "hit from archive"],
  "/style.css": ["text/css; charset=utf-8", "body { color: black; }"],
} as const;

async function saveArchive(storage: FakeCaches, version: string, script?: string) {
  const buildId = "a".repeat(40);
  const files = Object.entries({
    ...ARCHIVED_FILES,
    "/app.js": [ARCHIVED_FILES["/app.js"][0], script ?? ARCHIVED_FILES["/app.js"][1]] as const,
  });
  const index = encodeBuildArchiveIndex({
    buildId,
    files: files.map(([url, [type, text]]) => [url, Buffer.byteLength(text), type]),
    version,
  });
  const buffer = Buffer.concat([index, ...files.map(([, [, text]]) => Buffer.from(text))]);
  await createBuildArchiveStore({
    caches: storage as unknown as CacheStorage,
    origin: ORIGIN,
    policy: POLICY,
  }).put(
    {
      archive: {
        byteSize: buffer.byteLength,
        schema: 1,
        sha256: createHash("sha256").update(buffer).digest("hex"),
      },
      buildId,
      manifest: buildManifestUrl(version),
      schema: 1,
      version,
    },
    new Blob([buffer]),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function groupOf(
  url: string,
  contentType: string,
  body: string,
  identity: string = GROUP_ARCHIVE_IDENTITY,
) {
  const prefix = encodeBuildArchiveIndex({
    buildId: identity,
    files: [[url, Buffer.byteLength(body), contentType]],
    version: identity,
  });
  const bytes = Buffer.concat([prefix, Buffer.from(body)]);
  return {
    blob: new Blob([bytes]),
    reference: {
      byteSize: bytes.byteLength,
      schema: 1 as const,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
  };
}

function groupedBuild(version: string, ...groups: ReturnType<typeof groupOf>[]): BuildPointer {
  return {
    buildId: "a".repeat(40),
    groups: groups.map(({ reference }) => reference),
    manifest: buildManifestUrl(version),
    schema: 1,
    version,
  };
}

const groupRecord = (version: string) => `/.game-kit/group-record-${version}.json`;

describe("group storage and routing", () => {
  it("reuses exact whole groups within the game's caches and reclaims an old marker and cache", async () => {
    const worker = startWorker(new FakeServer({}));
    const context = { caches: worker.storage as unknown as CacheStorage, origin: ORIGIN };
    const store = createBuildGroupStore({ ...context, policy: POLICY });
    const foreign = createBuildGroupStore({
      ...context,
      policy: { ...POLICY, cacheNamePrefix: "other-" },
    });
    const group = groupOf("/app.js", "text/javascript", "shared");
    const previous = groupedBuild("v1", group);
    const target = groupedBuild("v2", group);
    await foreign.put(previous, group.reference, group.blob);
    expect(await store.reuse(target, group.reference)).toBe(false);
    await store.put(previous, group.reference, group.blob);
    await store.seal(previous);
    const digest = vi.spyOn(crypto.subtle, "digest");
    expect(await store.reuse(target, group.reference)).toBe(true);
    expect(await store.complete(target.version, target)).toBe(false);
    expect(await store.read(target.version)).toEqual({ kind: "unknown" });
    await store.seal(target);
    expect(await store.complete(target.version, target)).toBe(true);
    expect(await store.complete(target.version, { ...target, buildId: "other" })).toBe(false);
    const key = buildArchivePartUrl(group.reference, 0);
    const cached = await worker.storage.open(buildCacheName(POLICY, target.version));
    expect([...cached.entries.keys()]).toEqual([key]);
    const copied = await cached.match(key);
    expect(copied?.headers.get(BUILD_HASH_HEADER)).toBe(group.reference.sha256);
    expect(await copied?.arrayBuffer()).toEqual(await group.blob.arrayBuffer());
    expect(digest).not.toHaveBeenCalled();
    const records = await worker.records();
    expect(records.entries.has(groupRecord(previous.version))).toBe(true);
    await worker.setRecord(ACTIVE, target.version);
    expect(await createBuildStore(context, POLICY).reclaim([])).toEqual([
      buildCacheName(POLICY, previous.version),
    ]);
    expect(records.entries.has(groupRecord(previous.version))).toBe(false);
    expect((await store.read(target.version)).kind).toBe("ready");
    expect(await store.reuse(target, group.reference)).toBe(true);
  });

  it("refuses a group with the wrong identity and never seals missing or overlapping bodies", async () => {
    const worker = startWorker(new FakeServer({}));
    const store = createBuildGroupStore({
      caches: worker.storage as unknown as CacheStorage,
      origin: ORIGIN,
      policy: POLICY,
    });
    const wrong = groupOf("/app.js", "text/javascript", "wrong", "build");
    const a = groupOf("/app.js", "text/javascript", "a");
    const b = groupOf("/app.js", "text/javascript", "b");
    const pointer = groupedBuild("v1", a, b);
    await expect(
      store.put(groupedBuild("bad", wrong), wrong.reference, wrong.blob),
    ).rejects.toThrow();
    await store.put(pointer, a.reference, a.blob);
    await expect(store.seal(pointer)).rejects.toThrow("unavailable");
    await store.put(pointer, b.reference, b.blob);
    await expect(store.seal(pointer)).rejects.toThrow("duplicate URLs");
    expect(await store.read(pointer.version)).toEqual({ kind: "unknown" });
    const sealed = groupedBuild("v1", a);
    await store.seal(sealed);
    await expect(store.seal(groupedBuild("v1", b))).rejects.toThrow("Conflicting");
    expect(await store.complete("v1", sealed)).toBe(true);
  });

  it("promotes groups, serves their typed bodies and keeps an older archive pin", async () => {
    const worker = startWorker(new FakeServer({ "/api/state": "network" }));
    await saveArchive(worker.storage, "v1");
    await worker.setRecord(ACTIVE, "v1");
    const store = createBuildGroupStore({
      caches: worker.storage as unknown as CacheStorage,
      origin: ORIGIN,
      policy: POLICY,
    });
    const page = groupOf("/play/", "text/html; charset=utf-8", "<p>grouped</p>");
    const script = groupOf("/app.js", "text/javascript", "grouped script");
    const pointer = groupedBuild("v2", page, script);
    await store.put(pointer, page.reference, page.blob);
    await store.put(pointer, script.reference, script.blob);
    await store.seal(pointer);
    await worker.setRecord(STAGED, "v2");
    expect(await (await worker.get("/app.js", "old"))!.text()).toBe(ARCHIVED_FILES["/app.js"][1]);
    const response = (await worker.navigate("/play/index.html", "new"))!;
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await response.text()).toBe("<p>grouped</p>");
    expect(await worker.readRecord(ACTIVE)).toBe("v2");
    expect(await worker.readRecord(STAGED)).toBeUndefined();
    expect(await worker.readRecord(pinKey("new"))).toBe("v2");
    expect(await (await worker.get("/app.js", "new"))!.text()).toBe("grouped script");
    expect(await (await worker.get("/app.js", "old"))!.text()).toBe(ARCHIVED_FILES["/app.js"][1]);
    expect(await (await worker.get("/api/state", "new"))!.text()).toBe("network");
    expect(worker.fetches).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ url: `${ORIGIN}/api/state` }),
    );
  });

  it("fails closed for a missing sealed group despite a same-version legacy manifest", async () => {
    const worker = startWorker(new FakeServer(V2));
    await worker.saveBuild(manifestOf("v1", V1), V1);
    await worker.saveBuild(manifestOf("v2", V2), V2);
    const store = createBuildGroupStore({
      caches: worker.storage as unknown as CacheStorage,
      origin: ORIGIN,
      policy: POLICY,
    });
    const page = groupOf("/play/", "text/html", "<p>grouped</p>");
    const pointer = groupedBuild("v2", page);
    await store.put(pointer, page.reference, page.blob);
    await store.seal(pointer);
    const cache = await worker.storage.open(buildCacheName(POLICY, "v2"));
    await cache.delete(buildArchivePartUrl(page.reference, 0));
    expect(await store.complete("v2", pointer)).toBe(false);
    expect(await store.read("v2")).toEqual({ kind: "unavailable" });
    await worker.setRecord(ACTIVE, "v1");
    await worker.setRecord(STAGED, "v2");
    expect(await (await worker.navigate("/play/", "new"))!.text()).toBe(V1["/play/"]);
    expect(await worker.readRecord(ACTIVE)).toBe("v1");
    expect(await worker.readRecord(STAGED)).toBe("v2");
    await worker.setRecord(pinKey("missing"), "v2");
    await expect(worker.get("/app.js", "missing")).rejects.toThrow("Build groups unavailable");
    expect(worker.fetches).not.toHaveBeenCalled();
  });
});

describe("archive routing", () => {
  it("promotes an archive, serves its typed slices and keeps an old document pinned", async () => {
    const server = new FakeServer({ "/api/state": "network state" });
    const worker = startWorker(server);
    await worker.saveBuild(manifestOf("v1", V1), V1);
    await saveArchive(worker.storage, "v2");
    await worker.setRecord(ACTIVE, "v1");
    await worker.setRecord(STAGED, "v2");
    expect(await (await worker.get("/app.js", "old"))!.text()).toBe(V1["/app.js"]);
    const cache = await worker.storage.open(buildCacheName(POLICY, "v2"));
    const read = vi.spyOn(cache, "match");
    const digest = vi.spyOn(crypto.subtle, "digest");

    const page = (await worker.navigate("/play/index.html", "new"))!;
    expect(await worker.readRecord(ACTIVE)).toBe("v2");
    expect(await worker.readRecord(STAGED)).toBeUndefined();
    expect(await worker.readRecord(pinKey("new"))).toBe("v2");
    await Promise.all(
      Object.entries(ARCHIVED_FILES).map(async ([url, [type, text]]) => {
        const response = url === "/play/" ? page : (await worker.get(url, "new"))!;
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe(type);
        expect(response.headers.get("content-length")).toBe(String(Buffer.byteLength(text)));
        expect(response.headers.get("x-content-type-options")).toBe("nosniff");
        expect(await response.text()).toBe(text);
      }),
    );
    expect(await (await worker.get("/app.js", "old"))!.text()).toBe(V1["/app.js"]);
    expect(await (await worker.get("/api/state", "new"))!.text()).toBe("network state");
    expect(server.fetched).toEqual(["/api/state"]);
    expect(read).toHaveBeenCalledOnce();
    expect(digest).not.toHaveBeenCalled();
  });

  it("leaves an incomplete archive staged even with a complete same-version legacy cache", async () => {
    const server = new FakeServer(V2);
    const worker = startWorker(server);
    await worker.saveBuild(manifestOf("v1", V1), V1);
    await worker.saveBuild(manifestOf("v2", V2), V2);
    await saveArchive(worker.storage, "v2");
    const cache = await worker.storage.open(buildCacheName(POLICY, "v2"));
    await cache.delete(ARCHIVE_BODY);
    await worker.setRecord(ACTIVE, "v1");
    await worker.setRecord(STAGED, "v2");
    await worker.setRecord(pinKey("archive"), "v2");
    await expect(worker.get("/app.js", "archive")).rejects.toThrow("Build archive unavailable");

    expect(await (await worker.navigate("/play/", "new"))!.text()).toBe(V1["/play/"]);
    expect(await worker.readRecord(ACTIVE)).toBe("v1");
    expect(await worker.readRecord(STAGED)).toBe("v2");
    await expect(worker.get("/app.js", "archive")).rejects.toThrow("Build archive unavailable");
    await expect(worker.get("/api/state", "archive")).rejects.toThrow("Build archive unavailable");
    expect(server.fetched).toEqual([]);
    await saveArchive(worker.storage, "v2");
    expect(await (await worker.get("/app.js", "archive"))!.text()).toBe(
      ARCHIVED_FILES["/app.js"][1],
    );
  });

  it("fails closed when reading a selected version's archive marker rejects", async () => {
    const server = new FakeServer(V2);
    const worker = startWorker(server);
    await worker.saveBuild(manifestOf("v1", V1), V1);
    await worker.setRecord(ACTIVE, "v1");
    vi.spyOn(worker.storage, "match").mockRejectedValueOnce(new Error("Marker read failed"));

    await expect(worker.get("/app.js", "doc")).rejects.toThrow("Marker read failed");
    expect(server.fetched).toEqual([]);
    expect(await worker.readRecord(pinKey("doc"))).toBeUndefined();
  });

  it("does not look up archive markers for every file in a pinned legacy document", async () => {
    const server = new FakeServer(V2);
    const worker = startWorker(server);
    await worker.saveBuild(manifestOf("v1", V1), V1);
    await worker.setRecord(ACTIVE, "v1");
    await worker.navigate("/play/", "doc");
    const match = vi.spyOn(worker.storage, "match");
    await worker.get("/app.js", "doc");
    await worker.get("/app.js", "doc");
    expect(match).not.toHaveBeenCalled();
    expect(server.fetched).toEqual([]);
  });

  it("does not use a retained snapshot as evidence that a staged archive is complete", async () => {
    const worker = startWorker(new FakeServer(V2));
    await worker.saveBuild(manifestOf("v1", V1), V1);
    await saveArchive(worker.storage, "v2");
    await worker.setRecord(pinKey("archive"), "v2");
    expect(await (await worker.get("/app.js", "archive"))!.text()).toBe(
      ARCHIVED_FILES["/app.js"][1],
    );
    await (await worker.storage.open(buildCacheName(POLICY, "v2"))).delete(ARCHIVE_BODY);
    await worker.setRecord(ACTIVE, "v1");
    await worker.setRecord(STAGED, "v2");

    expect(await (await worker.navigate("/play/", "new"))!.text()).toBe(V1["/play/"]);
    expect(await worker.readRecord(STAGED)).toBe("v2");
    expect(await worker.readRecord(ACTIVE)).toBe("v1");
  });

  it("evicts the least recently used archive snapshot without changing its client's pin", async () => {
    const worker = startWorker(new FakeServer(V1));
    await Promise.all(
      ["v1", "v2", "v3"].map(async (version) => {
        await saveArchive(worker.storage, version, `app for ${version}`);
        await worker.setRecord(pinKey(version), version);
      }),
    );
    const cache = await worker.storage.open(buildCacheName(POLICY, "v1"));
    const read = vi.spyOn(cache, "match");
    expect(await (await worker.get("/app.js", "v1"))!.text()).toBe("app for v1");
    expect(await (await worker.get("/app.js", "v2"))!.text()).toBe("app for v2");
    expect(await (await worker.get("/app.js", "v3"))!.text()).toBe("app for v3");
    expect(await (await worker.get("/app.js", "v1"))!.text()).toBe("app for v1");
    expect(read).toHaveBeenCalledTimes(2);
    expect(await worker.readRecord(pinKey("v1"))).toBe("v1");
  });

  it.each([BUILD_ARCHIVE_ROUTER_PROBE, BUILD_GROUP_ROUTER_PROBE])(
    "echoes the exact capability token %s only to its transferred port",
    (token) => {
      const worker = startWorker(new FakeServer(V1));
      const listen = worker.listeners.get("message")!;
      const reply = vi.fn();
      listen({ data: { token }, ports: [{ postMessage: reply }] });
      listen({ data: token, ports: [] });
      expect(reply).not.toHaveBeenCalled();
      listen({ data: token, ports: [{ postMessage: reply }] });
      expect(reply).toHaveBeenCalledExactlyOnceWith(token);
    },
  );
});

describe("runServiceWorker's lifecycle", () => {
  it("takes over at once on install and activate and downloads nothing", async () => {
    const server = new FakeServer(V1);
    const worker = startWorker(server);
    expect([...worker.listeners.keys()]).toEqual(["install", "activate", "message", "fetch"]);
    await worker.lifecycle("install");
    expect(worker.skipWaiting).toHaveBeenCalledOnce();
    await worker.lifecycle("activate");
    expect(worker.claim).toHaveBeenCalledOnce();
    expect(worker.fetches).not.toHaveBeenCalled();
    expect([...worker.storage.named.keys()]).toEqual([]);
  });
});

describe("pins", () => {
  it("deletes the pins of closed clients at activate and keeps open clients' pins", async () => {
    const worker = startWorker(new FakeServer(V1));
    await worker.setRecord(pinKey("open"), "v1");
    await worker.setRecord(pinKey("closed"), "v1");
    await worker.setRecord(ACTIVE, "v1");
    worker.matchAll.mockResolvedValueOnce([{ id: "open" }]);
    await worker.lifecycle("activate");
    expect(worker.matchAll).toHaveBeenCalledExactlyOnceWith({
      includeUncontrolled: true,
      type: "all",
    });
    expect(await worker.readRecord(pinKey("open"))).toBe("v1");
    expect(await worker.readRecord(pinKey("closed"))).toBeUndefined();
    expect(await worker.readRecord(ACTIVE)).toBe("v1");
    await worker.lifecycle("activate");
    expect(await worker.readRecord(pinKey("open"))).toBeUndefined();
  });

  it("prunes on navigation at most once a minute and spares a pin it wrote within that time", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const worker = startWorker(new FakeServer(V1));
    await worker.saveBuild(manifestOf("v1", V1), V1);
    await worker.setRecord(ACTIVE, "v1");
    await worker.navigate("/play/", "a");
    expect(worker.matchAll).toHaveBeenCalledOnce();
    // A navigation's client is not listed until its document runs.
    worker.close("a");
    await worker.navigate("/play/", "b");
    expect(worker.matchAll).toHaveBeenCalledOnce();
    worker.close("b");
    now += PIN_PRUNE_MS - 1;
    await worker.navigate("/play/", "c");
    expect(worker.matchAll).toHaveBeenCalledOnce();
    worker.close("c");
    now += 1;
    await worker.navigate("/play/", "d");
    expect(worker.matchAll).toHaveBeenCalledTimes(2);
    expect(await worker.readRecord(pinKey("a"))).toBeUndefined();
    expect(await worker.readRecord(pinKey("b"))).toBeUndefined();
    expect(await worker.readRecord(pinKey("c"))).toBe("v1");
    expect(await worker.readRecord(pinKey("d"))).toBe("v1");
    await worker.get("/app.js", "c");
    expect(worker.matchAll).toHaveBeenCalledTimes(2);
  });

  it("lets the page reclaim an old build once its windows close, and never while one pins it", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const worker = startWorker(new FakeServer({}));
    const store = createBuildStore(
      { caches: worker.storage as unknown as CacheStorage, origin: ORIGIN },
      POLICY,
    );
    await worker.saveBuild(manifestOf("v1", V1), V1);
    await worker.setRecord(ACTIVE, "v1");
    expect(await (await worker.navigate("/play/", "old"))!.text()).toBe("page v1");
    await worker.saveBuild(manifestOf("v2", V2), V2);
    await worker.setRecord(STAGED, "v2");
    expect(await (await worker.navigate("/play/", "new"))!.text()).toBe("page v2");
    expect(await store.reclaim(["v2"])).toEqual([]);
    now += PIN_PRUNE_MS;
    await worker.lifecycle("activate");
    expect(await store.reclaim(["v2"])).toEqual([]);
    expect(await (await worker.get("/app.js", "old"))!.text()).toBe("app v1");

    worker.close("old");
    now += PIN_PRUNE_MS;
    await worker.navigate("/play/", "next");
    expect(await worker.readRecord(pinKey("old"))).toBeUndefined();
    expect(await store.reclaim(["v2"])).toEqual([buildCacheName(POLICY, "v1")]);
    expect(await store.readManifest("v1")).toBeUndefined();
    expect(await worker.readRecord(pinKey("new"))).toBe("v2");
    expect(await (await worker.get("/app.js", "new"))!.text()).toBe("app v2");
  });
});

describe("navigation", () => {
  it("goes to the network without writing a pin while no build is active", async () => {
    const server = new FakeServer(V1);
    const worker = startWorker(server);
    expect(await (await worker.navigate("/play/", "doc"))!.text()).toBe("page v1");
    expect(server.fetched).toEqual(["/play/"]);
    expect(await worker.readRecord(pinKey("doc"))).toBeUndefined();
  });

  it("serves the active build from its cache and pins the new document to it", async () => {
    const server = new FakeServer(V2);
    const worker = startWorker(server);
    await worker.saveBuild(manifestOf("v1", V1), V1);
    await worker.setRecord(ACTIVE, "v1");
    expect(await (await worker.navigate("/play/index.html", "doc"))!.text()).toBe("page v1");
    expect(await worker.readRecord(pinKey("doc"))).toBe("v1");
    expect(server.fetched).toEqual([]);
  });

  it("promotes a complete staged build to active before serving the launch", async () => {
    const server = new FakeServer(V2);
    const worker = startWorker(server);
    await worker.saveBuild(manifestOf("v1", V1), V1);
    await worker.saveBuild(manifestOf("v2", V2), V2);
    await worker.setRecord(ACTIVE, "v1");
    await worker.setRecord(STAGED, "v2");
    expect(await (await worker.navigate("/play/", "doc"))!.text()).toBe("page v2");
    expect(await worker.readRecord(ACTIVE)).toBe("v2");
    expect(await worker.readRecord(STAGED)).toBeUndefined();
    expect(await worker.readRecord(pinKey("doc"))).toBe("v2");
    expect(server.fetched).toEqual([]);
  });

  it("keeps newer active and staged records when an older promotion is verifying", async () => {
    const server = new FakeServer(V2);
    const worker = startWorker(server);
    await worker.saveBuild(manifestOf("v1", V1), V1);
    await worker.saveBuild(manifestOf("v2", V2), V2);
    const newer = { ...V2, "/play/": "page v3" };
    await worker.saveBuild(manifestOf("v3", newer), newer);
    await worker.setRecord(ACTIVE, "v1");
    await worker.setRecord(STAGED, "v2");
    const cache = await worker.storage.open(buildCacheName(POLICY, "v2"));
    let finishVerification!: (requests: Request[]) => void;
    const verification = new Promise<Request[]>((resolve) => {
      finishVerification = resolve;
    });
    const keys = vi.spyOn(cache, "keys").mockReturnValueOnce(verification);
    const navigating = worker.navigate("/play/", "doc");
    await vi.waitFor(() => expect(keys).toHaveBeenCalledOnce());
    // A client still on an earlier version can write records without the lock.
    await worker.setRecord(ACTIVE, "v3");
    await worker.setRecord(STAGED, "v4");
    finishVerification(await cache.keys());
    expect(await (await navigating)!.text()).toBe("page v3");
    expect(await worker.readRecord(ACTIVE)).toBe("v3");
    expect(await worker.readRecord(STAGED)).toBe("v4");
    expect(await worker.readRecord(pinKey("doc"))).toBe("v3");
    expect(server.fetched).toEqual([]);
  });

  it("waits for a page's active and staged writes before committing a promotion", async () => {
    const worker = startWorker(new FakeServer(V2));
    await worker.saveBuild(manifestOf("v1", V1), V1);
    await worker.saveBuild(manifestOf("v2", V2), V2);
    const newer = { ...V2, "/play/": "page v3" };
    await worker.saveBuild(manifestOf("v3", newer), newer);
    await worker.setRecord(ACTIVE, "v1");
    await worker.setRecord(STAGED, "v2");

    let finishWriting!: () => void;
    const writing = new Promise<void>((resolve) => {
      finishWriting = resolve;
    });
    const page = navigator.locks.request(RECORDS, async () => {
      await writing;
      await worker.setRecord(ACTIVE, "v3");
      await worker.setRecord(STAGED, "v4");
    });
    await vi.waitFor(async () => {
      expect((await navigator.locks.query()).held).toContainEqual(
        expect.objectContaining({ name: RECORDS }),
      );
    });
    const navigating = worker.navigate("/play/", "doc");
    try {
      await vi.waitFor(async () => {
        expect((await navigator.locks.query()).pending).toContainEqual(
          expect.objectContaining({ name: RECORDS }),
        );
      });
    } finally {
      finishWriting();
      await page;
    }
    expect(await (await navigating)!.text()).toBe("page v3");
    expect(await worker.readRecord(ACTIVE)).toBe("v3");
    expect(await worker.readRecord(STAGED)).toBe("v4");
  });

  it("clears a staged record that names the active build", async () => {
    const worker = startWorker(new FakeServer(V1));
    await worker.saveBuild(manifestOf("v1", V1), V1);
    await worker.setRecord(ACTIVE, "v1");
    await worker.setRecord(STAGED, "v1");
    expect(await (await worker.navigate("/play/", "doc"))!.text()).toBe("page v1");
    expect(await worker.readRecord(STAGED)).toBeUndefined();
  });

  it.each([
    ["a file is missing", { omit: ["/sound/hit.ogg"] }, true],
    ["a digest header does not match", { headers: { [BUILD_HASH_HEADER]: "0".repeat(64) } }, true],
    ["its manifest is not saved", {}, false],
  ])("keeps a staged build staged when %s", async (_case, options, saved) => {
    const server = new FakeServer(V2);
    const worker = startWorker(server);
    await worker.saveBuild(manifestOf("v1", V1), V1);
    await worker.setRecord(ACTIVE, "v1");
    await worker.setRecord(STAGED, "v2");
    if (saved) {
      const manifest = manifestOf("v2", V2);
      if ("headers" in options) {
        await worker.saveBuild(manifest, V2);
        const cache = await worker.storage.open(buildCacheName(POLICY, "v2"));
        cache.entries.set(
          "/app.js",
          new Response(V2["/app.js"], { headers: options.headers as Record<string, string> }),
        );
      } else {
        await worker.saveBuild(manifest, V2, options);
      }
    }
    expect(await (await worker.navigate("/play/", "doc"))!.text()).toBe("page v1");
    expect(await worker.readRecord(ACTIVE)).toBe("v1");
    expect(await worker.readRecord(STAGED)).toBe("v2");
  });

  it("keeps a document's existing pin across a newer active and staged build", async () => {
    const worker = startWorker(new FakeServer(V2));
    await worker.saveBuild(manifestOf("v1", V1), V1);
    await worker.saveBuild(manifestOf("v2", V2), V2);
    await worker.setRecord(pinKey("doc"), "v1");
    await worker.setRecord(ACTIVE, "v1");
    await worker.setRecord(STAGED, "v2");
    expect(await (await worker.navigate("/play/", "doc"))!.text()).toBe("page v1");
    expect(await worker.readRecord(STAGED)).toBe("v2");
  });

  it("sends a URL the build does not list to the network without a pin", async () => {
    const server = new FakeServer({ ...V1, "/privacy.html": "privacy" });
    const worker = startWorker(server);
    await worker.saveBuild(manifestOf("v1", V1), V1);
    await worker.setRecord(ACTIVE, "v1");
    expect(await (await worker.navigate("/privacy.html", "doc"))!.text()).toBe("privacy");
    expect(await worker.readRecord(pinKey("doc"))).toBeUndefined();
  });

  it("treats a malformed active record or manifest as no build", async () => {
    const server = new FakeServer(V1);
    const worker = startWorker(server);
    await (await worker.records()).put(ACTIVE, new Response("not json"));
    expect(await (await worker.navigate("/play/"))!.text()).toBe("page v1");
    await worker.setRecord(ACTIVE, "v1");
    await (
      await worker.records()
    ).put(
      buildManifestUrl("v1"),
      new Response(JSON.stringify({ ...manifestOf("v1", V1), schema: 2 })),
    );
    expect(await (await worker.navigate("/play/"))!.text()).toBe("page v1");
    expect(server.fetched).toEqual(["/play/", "/play/"]);
  });
});

describe("subresources", () => {
  it("serves a pinned document its own build after another launch promotes a newer one", async () => {
    const server = new FakeServer(V2);
    const worker = startWorker(server);
    await worker.saveBuild(manifestOf("v1", V1), V1);
    await worker.setRecord(ACTIVE, "v1");
    await worker.navigate("/play/", "old");
    await worker.saveBuild(manifestOf("v2", V2), V2);
    await worker.setRecord(STAGED, "v2");
    expect(await (await worker.navigate("/play/", "new"))!.text()).toBe("page v2");
    expect(await (await worker.get("/app.js", "old"))!.text()).toBe("app v1");
    expect(await (await worker.get("/app.js", "new"))!.text()).toBe("app v2");
    expect(server.fetched).toEqual([]);
  });

  it("serves a document with no pin the active build and pins it there", async () => {
    const worker = startWorker(new FakeServer(V2));
    await worker.saveBuild(manifestOf("v1", V1), V1);
    await worker.saveBuild(manifestOf("v2", V2), V2);
    await worker.setRecord(ACTIVE, "v1");
    expect(await (await worker.get("/app.js", "first-install"))!.text()).toBe("app v1");
    expect(await worker.readRecord(pinKey("first-install"))).toBe("v1");
    await worker.setRecord(ACTIVE, "v2");
    expect(await (await worker.get("/app.js", "first-install"))!.text()).toBe("app v1");
    expect(await (await worker.get("/app.js"))!.text()).toBe("app v2");
  });

  it("goes to the network while no build is active and for URLs the build does not list", async () => {
    const server = new FakeServer({ ...V1, "/assets/unlisted.js": "unlisted" });
    const worker = startWorker(server);
    expect(await (await worker.get("/app.js", "doc"))!.text()).toBe("app v1");
    await worker.saveBuild(manifestOf("v1", V1), V1);
    await worker.setRecord(ACTIVE, "v1");
    expect(await (await worker.get("/assets/unlisted.js", "doc"))!.text()).toBe("unlisted");
    expect(await (await worker.get("/.game-kit/build.json", "doc"))!.text()).toBe("missing");
    expect(server.fetched).toEqual(["/app.js", "/assets/unlisted.js", "/.game-kit/build.json"]);
  });

  it("leaves cross-origin and non-GET requests to the browser", async () => {
    const worker = startWorker(new FakeServer(V1));
    expect(await worker.respondTo(new Request("https://cdn.test/app.js"))).toBeUndefined();
    expect(await worker.get("/app.js", "doc", { body: "x", method: "POST" })).toBeUndefined();
  });

  it("leaves no-store requests, such as the installer's, to the browser", async () => {
    const worker = startWorker(new FakeServer(V2));
    await worker.saveBuild(manifestOf("v1", V1), V1);
    await worker.setRecord(ACTIVE, "v1");
    expect(await worker.get("/play/", "doc", { cache: "no-store" })).toBeUndefined();
    expect(await (await worker.get("/play/", "doc"))!.text()).toBe("page v1");
  });

  it("answers the installer's default-mode request for a hashed URL from the document's build", async () => {
    const files = { ...V1, "/assets/app-1a2b.js": "hashed" };
    const server = new FakeServer({ ...files, "/assets/new-3c4d.js": "new" });
    const worker = startWorker(server);
    await worker.saveBuild(manifestOf("v1", files), files);
    await worker.setRecord(ACTIVE, "v1");
    await worker.setRecord(pinKey("doc"), "v1");
    const init: RequestInit = { cache: "default", credentials: "same-origin", redirect: "error" };
    expect(await (await worker.get("/assets/app-1a2b.js", "doc", init))!.text()).toBe("hashed");
    expect(await (await worker.get("/assets/new-3c4d.js", "doc", init))!.text()).toBe("new");
    expect(server.fetched).toEqual(["/assets/new-3c4d.js"]);
  });

  it("goes to the network for a pinned build whose manifest is gone", async () => {
    const server = new FakeServer(V2);
    const worker = startWorker(server);
    await worker.saveBuild(manifestOf("v2", V2), V2);
    await worker.setRecord(ACTIVE, "v2");
    await worker.setRecord(pinKey("doc"), "v1");
    expect(await (await worker.get("/app.js", "doc"))!.text()).toBe("app v2");
    expect(server.fetched).toEqual(["/app.js"]);
  });
});

describe("sound formats", () => {
  it("promotes a staged build saved for one format, and sends a left-out alternative to the network", async () => {
    const files = { ...V2, "/sound/hit.m4a": "hit m4a" };
    const server = new FakeServer(files);
    const worker = startWorker(server);
    await worker.saveBuild(manifestOf("v1", V1), V1);
    const deployed = {
      ...manifestOf("v2", files),
      sounds: { "/sound/hit": ["/sound/hit.ogg", "/sound/hit.m4a"] },
    };
    await worker.saveBuild(installedManifest("ogg", deployed), files);
    await worker.setRecord(ACTIVE, "v1");
    await worker.setRecord(STAGED, "v2");
    expect(await (await worker.navigate("/play/", "doc"))!.text()).toBe("page v2");
    expect(await worker.readRecord(ACTIVE)).toBe("v2");
    expect(await (await worker.get("/sound/hit.ogg", "doc"))!.text()).toBe("hit");
    expect(await (await worker.get("/sound/hit.m4a", "doc"))!.text()).toBe("hit m4a");
    expect(server.fetched).toEqual(["/sound/hit.m4a"]);
    const cache = await worker.storage.open(buildCacheName(POLICY, "v2"));
    expect(await cache.match("/sound/hit.m4a")).toBeUndefined();
  });
});

describe("evicted files", () => {
  it("fetches, serves and stores a missing file whose bytes match the manifest", async () => {
    const server = new FakeServer(V1);
    const worker = startWorker(server);
    await worker.saveBuild(manifestOf("v1", V1), V1, { omit: ["/app.js"] });
    await worker.setRecord(ACTIVE, "v1");
    expect(await (await worker.get("/app.js", "doc"))!.text()).toBe("app v1");
    const cache = await worker.storage.open(buildCacheName(POLICY, "v1"));
    expect(await cache.text("/app.js")).toBe("app v1");
    expect(cache.entries.get("/app.js")!.headers.get(BUILD_HASH_HEADER)).toBe(sha256("app v1"));
    expect(await (await worker.get("/app.js", "doc"))!.text()).toBe("app v1");
    expect(server.fetched).toEqual(["/app.js"]);
  });

  it.each([
    { body: "app", case: "a different size", status: 200 },
    { body: "app v2", case: "a different digest at the same size", status: 200 },
    { body: "app v1", case: "a redirect", redirected: true, status: 200 },
    { body: "app v1", case: "partial content", status: 206 },
    {
      body: "app v1",
      case: "a 200 response with Content-Range",
      range: "bytes 0-5/8",
      status: 200,
    },
  ])(
    "rejects a listed network response with $case",
    async ({ body, range, redirected, status }) => {
      const server = new FakeServer(V2);
      const worker = startWorker(server);
      await worker.saveBuild(manifestOf("v1", V1), V1, { omit: ["/app.js"] });
      await worker.saveBuild(manifestOf("v2", V2), V2);
      await worker.setRecord(ACTIVE, "v2");
      await worker.setRecord(pinKey("doc"), "v1");
      const cache = await worker.storage.open(buildCacheName(POLICY, "v1"));
      const response = new Response(body, {
        headers: range === undefined ? {} : { "content-range": range },
        status,
      });
      Object.defineProperty(response, "redirected", { value: redirected ?? false });
      worker.fetches.mockResolvedValueOnce(response);

      await expect(worker.get("/app.js", "doc")).rejects.toThrow(TypeError);
      expect(worker.fetches).toHaveBeenCalledTimes(1);
      expect(cache.entries.has("/app.js")).toBe(false);
    },
  );

  it("returns the original verified response when writing it to the cache fails", async () => {
    const worker = startWorker(new FakeServer(V1));
    await worker.saveBuild(manifestOf("v1", V1), V1, { omit: ["/app.js"] });
    await worker.setRecord(ACTIVE, "v1");
    const cache = await worker.storage.open(buildCacheName(POLICY, "v1"));
    const write = vi.spyOn(cache, "put").mockRejectedValueOnce(new Error("Cache write failed"));
    const response = new Response(V1["/app.js"], {
      headers: { "content-type": "text/javascript" },
    });
    worker.fetches.mockResolvedValueOnce(response);

    const answer = await worker.get("/app.js", "doc");
    expect(answer).toBe(response);
    expect(answer?.headers.get("content-type")).toBe("text/javascript");
    expect(await answer?.text()).toBe(V1["/app.js"]);
    expect(write).toHaveBeenCalledOnce();
    expect(cache.entries.has("/app.js")).toBe(false);
  });

  it("refetches an entry whose digest header does not name the manifest's file", async () => {
    const server = new FakeServer(V1);
    const worker = startWorker(server);
    await worker.saveBuild(manifestOf("v1", V1), V1);
    await worker.setRecord(ACTIVE, "v1");
    const cache = await worker.storage.open(buildCacheName(POLICY, "v1"));
    cache.entries.set("/app.js", new Response("stale"));
    expect(await (await worker.get("/app.js", "doc"))!.text()).toBe("app v1");
    expect(server.fetched).toEqual(["/app.js"]);
  });
});

describe("legacy caches", () => {
  // CLEANUP (added 2026-11-18): remove once all three games deploy the router.
  it("never reads, serves or deletes an earlier worker's caches and routing records", async () => {
    const server = new FakeServer(V1);
    const worker = startWorker(server);
    const legacy = await worker.storage.open("game-0123456789abcdef");
    await legacy.put("/play/", new Response("legacy page"));
    const routing = await worker.storage.open("game-kit-routing:game-");
    await routing.put("/.game-kit-routing/selection/game-0123456789abcdef", new Response("x"));
    await worker.lifecycle("install");
    await worker.lifecycle("activate");
    expect(await (await worker.navigate("/play/", "doc"))!.text()).toBe("page v1");
    expect(await (await worker.get("/play/", "legacy-doc"))!.text()).toBe("page v1");
    expect(await legacy.text("/play/")).toBe("legacy page");
    expect(routing.entries.size).toBe(1);
    expect([...worker.storage.named.keys()]).toContain("game-0123456789abcdef");
  });
});

describe("verified JSON", () => {
  const BODY = '{"level":1}';
  const DATA = { "/data/a.json": BODY, "/data/b.json": BODY, "/play/": "page" };
  const family = (profile: boolean): VerifiedJsonBody => ({
    byteSize: BODY.length,
    sha256: sha256(BODY),
    urls: ["/data/a.json", "/data/b.json"],
    ...(profile ? { responseProfile: "fetch-json-data-v1" as const } : {}),
  });
  const start = async (
    profile: boolean,
    options?: Parameters<ReturnType<typeof startWorker>["saveBuild"]>[2],
  ) => {
    const server = new FakeServer(DATA);
    const worker = startWorker(server);
    await worker.saveBuild(manifestOf("v1", DATA, [family(profile)]), DATA, options);
    await worker.setRecord(ACTIVE, "v1");
    return { server, worker };
  };

  it("answers a guarded data request from the cache with the canonical JSON headers", async () => {
    const { server, worker } = await start(true);
    const response = (await worker.get("/data/b.json", "doc"))!;
    expect(response.url).toBe("");
    expect([...response.headers.keys()].sort()).toEqual(["content-type", "x-content-type-options"]);
    expect(await response.text()).toBe(BODY);
    expect(server.fetched).toEqual([]);
  });

  it("answers a profile URL's nondata request with its own original from the network", async () => {
    const { server, worker } = await start(true);
    server.headers.set("/data/a.json", { ...JSON_TYPE, "referrer-policy": "no-referrer" });
    const script = new Request(`${ORIGIN}/data/a.json`);
    Object.defineProperty(script, "destination", { value: "script" });
    const response = (await worker.respondTo(script, "doc"))!;
    expect(response.url).toBe(`${ORIGIN}/data/a.json`);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    const range = (await worker.get("/data/a.json", "doc", { headers: { range: "bytes=0-1" } }))!;
    expect(range.url).toBe(`${ORIGIN}/data/a.json`);
    expect(server.fetched).toEqual(["/data/a.json", "/data/a.json"]);
  });

  it("refuses a profile URL with a query before any fetch", async () => {
    const { server, worker } = await start(true);
    await expect(worker.get("/data/a.json?variant=1", "doc")).rejects.toThrow(
      "exact canonical URL",
    );
    expect(server.fetched).toEqual([]);
  });

  it("refetches a stored entry whose headers change its body's meaning", async () => {
    const { server, worker } = await start(true, {
      headers: { "content-disposition": "attachment" },
    });
    expect(await (await worker.get("/data/a.json", "doc"))!.text()).toBe(BODY);
    expect(server.fetched).toEqual(["/data/a.json"]);
  });

  it.each([
    "clear-site-data",
    "content-disposition",
    "content-location",
    "content-range",
    "refresh",
    "set-cookie",
  ])("rejects a network response carrying %s", async (name) => {
    const { server, worker } = await start(false, { omit: ["/data/a.json"] });
    server.headers.set("/data/a.json", { ...JSON_TYPE, [name]: "x" });
    await expect(worker.get("/data/a.json", "doc")).rejects.toThrow("Unsafe verified JSON");
  });

  it("accepts network headers without body semantics and stores the decoded body", async () => {
    const { server, worker } = await start(false, { omit: ["/data/a.json"] });
    server.headers.set("/data/a.json", {
      ...JSON_TYPE,
      connection: "keep-alive",
      "content-encoding": "gzip",
      priority: "u=3,i",
      "server-timing": "cfExtPri",
    });
    expect(await (await worker.get("/data/a.json", "doc"))!.text()).toBe(BODY);
    const cache = await worker.storage.open(buildCacheName(POLICY, "v1"));
    const stored = cache.entries.get("/data/a.json")!;
    expect(stored.headers.get(BUILD_HASH_HEADER)).toBe(sha256(BODY));
    expect(stored.headers.has("content-encoding")).toBe(false);
  });

  it.each([
    ["a legacy family, no response URL", false, ""],
    ["a legacy family, its cache key as the response URL", false, `${ORIGIN}/data/a.json`],
    ["a data profile, no response URL", true, ""],
    ["a data profile, its cache key as the response URL", true, `${ORIGIN}/data/a.json`],
  ])(
    "serves a stored entry the installer wrote, with only its type and digest, for %s",
    async (_name, profile, url) => {
      const { server, worker } = await start(profile);
      const cache = await worker.storage.open(buildCacheName(POLICY, "v1"));
      const stored = new Response(BODY, {
        headers: { [BUILD_HASH_HEADER]: sha256(BODY), "content-type": "application/json" },
      });
      Object.defineProperty(stored, "url", { value: url });
      cache.entries.set("/data/a.json", stored);
      expect(await (await worker.get("/data/a.json", "doc"))!.text()).toBe(BODY);
      expect(server.fetched).toEqual([]);
    },
  );

  it("serves a legacy family's stored response and rejects mismatched network bytes", async () => {
    const { server, worker } = await start(false, { omit: ["/data/b.json"] });
    expect(await (await worker.get("/data/a.json", "doc"))!.text()).toBe(BODY);
    server.files["/data/b.json"] = '{"level":2}';
    await expect(worker.get("/data/b.json", "doc")).rejects.toThrow("does not match");
    const cache = await worker.storage.open(buildCacheName(POLICY, "v1"));
    expect(cache.entries.has("/data/b.json")).toBe(false);
  });
});
