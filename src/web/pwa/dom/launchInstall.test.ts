// createLaunch over the real build store and installer, with in-memory caches and a fake server.
import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  ACTIVE_RECORD_PATH,
  BUILD_POINTER_URL,
  buildCacheName,
  type BuildManifest,
  buildManifestUrl,
  type BuildPointer,
  type LaunchFailure,
  type NetworkPlayNotice,
  recordsCacheName,
} from "../buildContract.ts";
import { installBuild } from "./buildInstaller.ts";
import { createBuildStore } from "./buildStore.ts";
import { createLaunch, type LaunchPage } from "./launch.ts";

const ORIGIN = "https://game.test";
const POLICY = { cacheNamePrefix: "game-", hashedAssetPrefix: "/assets/" };
const ROUTER = "/sw.js";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const pathOf = (key: Request | string) => {
  const url = new URL(key instanceof Request ? key.url : key, ORIGIN);
  return url.pathname + url.search;
};

class MemoryCache {
  readonly entries = new Map<string, Response>();
  // Returns an error to throw from put for a path, as a full disk or a killed page would.
  failPut: ((path: string) => Error | undefined) | undefined;

  delete(key: Request | string): Promise<boolean> {
    return Promise.resolve(this.entries.delete(pathOf(key)));
  }

  keys(): Promise<Request[]> {
    return Promise.resolve([...this.entries.keys()].map((path) => new Request(ORIGIN + path)));
  }

  match(key: Request | string): Promise<Response | undefined> {
    return Promise.resolve(this.entries.get(pathOf(key))?.clone());
  }

  async put(key: Request | string, response: Response): Promise<void> {
    const error = this.failPut?.(pathOf(key));
    if (error !== undefined) {
      throw error;
    }
    this.entries.set(pathOf(key), new Response(await response.arrayBuffer(), response));
  }
}

class MemoryCaches {
  readonly named = new Map<string, MemoryCache>();

  delete(name: string): Promise<boolean> {
    return Promise.resolve(this.named.delete(name));
  }

  has(name: string): Promise<boolean> {
    return Promise.resolve(this.named.has(name));
  }

  keys(): Promise<string[]> {
    return Promise.resolve([...this.named.keys()]);
  }

  open(name: string): Promise<MemoryCache> {
    const cache = this.named.get(name) ?? new MemoryCache();
    this.named.set(name, cache);
    return Promise.resolve(cache);
  }
}

function buildOf(version: string, bodies: Record<string, string>) {
  const manifest: BuildManifest = {
    boot: [],
    buildId: `id-${version}`,
    files: Object.entries(bodies).map(([url, body]) => ({
      byteSize: new TextEncoder().encode(body).byteLength,
      sha256: sha(body),
      url,
    })),
    schema: 1,
    sounds: {},
    version,
  };
  const pointer: BuildPointer = {
    buildId: manifest.buildId,
    manifest: buildManifestUrl(version),
    schema: 1,
    version,
  };
  return { bodies, manifest, pointer };
}

type Build = ReturnType<typeof buildOf>;

const V1 = buildOf("aaaa", {
  "/a.js": "alpha one",
  "/b.js": "shared bravo",
  "/c.js": "shared charlie",
  "/play/": "<html>",
});
const V2 = buildOf("bbbb", { ...V1.bodies, "/a.js": "alpha two" });

// Serves the deployed build's pointer, manifest and files, and logs each build file fetched.
class FakeServer {
  deployed: Build;
  readonly fileFetches: string[] = [];
  // Holds a file's response until the returned promise settles.
  hold: ((url: string) => Promise<void> | undefined) | undefined;

  constructor(build: Build) {
    this.deployed = build;
  }

  readonly fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    if (url === BUILD_POINTER_URL) {
      return Response.json(this.deployed.pointer);
    }
    if (url === this.deployed.pointer.manifest) {
      return Response.json(this.deployed.manifest);
    }
    this.fileFetches.push(url);
    await this.hold?.(url);
    init?.signal?.throwIfAborted();
    const body = this.deployed.bodies[url];
    return body === undefined ? new Response("missing", { status: 404 }) : new Response(body);
  };
}

// One page load over shared caches: the real store and installer under createLaunch.
function load(
  caches: MemoryCaches,
  server: FakeServer,
  manager?: Pick<StorageManager, "estimate" | "persist">,
) {
  const container = Object.assign(new EventTarget(), {
    controller: null as { scriptURL: string } | null,
    register: vi.fn(async () => {
      container.controller = { scriptURL: ORIGIN + ROUTER };
      return {};
    }),
  });
  const page: LaunchPage = {
    container,
    eventTarget: new EventTarget(),
    fetch: server.fetch,
    location: { href: `${ORIGIN}/play/`, reload: vi.fn() },
    online: () => true,
    storage: { caches, indexedDB: undefined, manager, session: undefined },
    timers: {
      clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
      now: () => Date.now(),
      setTimeout: (callback, ms) => setTimeout(callback, ms),
    },
    visibility: Object.assign(new EventTarget(), { visibilityState: "visible" as const }),
  };
  const store = createBuildStore(
    { caches: caches as unknown as CacheStorage, origin: ORIGIN },
    POLICY,
  );
  const failures: LaunchFailure[] = [];
  const networkPlay: NetworkPlayNotice[] = [];
  const launch = createLaunch(
    { installBuild, page, policy: POLICY, store },
    {
      onFailure: (failure) => failures.push(failure),
      onNetworkPlay: (notice) => networkPlay.push(notice),
      onProgress: () => undefined,
      onUpdateReady: () => undefined,
      onUpdateState: () => undefined,
      serviceWorkerUrl: ROUTER,
    },
  );
  return { failures, launch, networkPlay, store };
}

// Lets queued promise callbacks and cache calls run, one macrotask turn at a time.
const settle = (turns = 30): Promise<void> =>
  turns === 0
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        setImmediate(resolve);
      }).then(() => settle(turns - 1));

const storedPaths = (caches: MemoryCaches, build: Build) => [
  ...(caches.named.get(buildCacheName(POLICY, build.manifest.version))?.entries.keys() ?? []),
];

const roomFor = (free: number): Pick<StorageManager, "estimate" | "persist"> => ({
  estimate: async () => ({ quota: 1_000_000, usage: 1_000_000 - free }),
  persist: async () => true,
});

describe("quota", () => {
  it("plays from the network before any file fetch when the estimate leaves too little room", async () => {
    const caches = new MemoryCaches();
    const server = new FakeServer(V1);
    const page = load(caches, server, roomFor(10));
    await expect(page.launch.run()).resolves.toBe("play");
    expect(page.networkPlay).toEqual([{ reason: "quota" }]);
    expect(page.failures).toEqual([]);
    expect(server.fileFetches).toEqual([]);
    expect(await page.store.readState()).toEqual({});
  });

  it("plays from the network when a put is refused, and the next launch fetches only what is missing", async () => {
    const caches = new MemoryCaches();
    const server = new FakeServer(V1);
    const cache = await caches.open(buildCacheName(POLICY, "aaaa"));
    cache.failPut = (path) =>
      path === "/c.js" ? new DOMException("Storage is full", "QuotaExceededError") : undefined;
    const page = load(caches, server, roomFor(1_000_000));
    await expect(page.launch.run()).resolves.toBe("play");
    expect(page.networkPlay).toEqual([{ reason: "quota" }]);
    expect(page.failures).toEqual([]);
    expect(await page.store.readState()).toEqual({});
    const stored = storedPaths(caches, V1);
    expect(stored).not.toContain("/c.js");
    cache.failPut = undefined;
    server.fileFetches.length = 0;
    const next = load(caches, server, roomFor(1_000_000));
    await expect(next.launch.run()).resolves.toBe("play");
    expect(next.networkPlay).toEqual([]);
    expect(server.fileFetches.sort()).toEqual(
      Object.keys(V1.bodies)
        .filter((url) => !stored.includes(url))
        .sort(),
    );
    expect(await next.store.readState()).toEqual({ active: "aaaa" });
  });
});

describe("resume", () => {
  it("resumes after a kill mid-install, fetching only files not yet stored", async () => {
    const caches = new MemoryCaches();
    const server = new FakeServer(V1);
    // A response that never arrives, as when the page is killed mid-file.
    const never = new Promise<void>(() => {});
    server.hold = (url) => (url === "/c.js" ? never : undefined);
    const killed = load(caches, server);
    void killed.launch.run();
    await settle();
    killed.launch.dispose();
    const stored = storedPaths(caches, V1);
    expect(stored.sort()).toEqual(["/a.js", "/b.js", "/play/"]);

    server.hold = undefined;
    server.fileFetches.length = 0;
    const next = load(caches, server);
    await expect(next.launch.run()).resolves.toBe("play");
    expect(server.fileFetches).toEqual(["/c.js"]);
    expect(await next.store.readState()).toEqual({ active: "aaaa" });
  });

  it("resumes after a kill between the last stored entry and the active record, fetching nothing", async () => {
    const caches = new MemoryCaches();
    const server = new FakeServer(V1);
    const records = await caches.open(recordsCacheName(POLICY));
    records.failPut = (path) =>
      path === ACTIVE_RECORD_PATH ? new Error("The page was closed") : undefined;
    const killed = load(caches, server);
    void killed.launch.run();
    await settle();
    killed.launch.dispose();
    expect(storedPaths(caches, V1).sort()).toEqual(Object.keys(V1.bodies).sort());
    expect(await killed.store.readState()).toEqual({});

    records.failPut = undefined;
    server.fileFetches.length = 0;
    const next = load(caches, server);
    await expect(next.launch.run()).resolves.toBe("play");
    expect(server.fileFetches).toEqual([]);
    expect(await next.store.readState()).toEqual({ active: "aaaa" });
  });
});

describe("redeploy mid-install", () => {
  it("restarts on the new manifest and fetches only the files it changed", async () => {
    const caches = new MemoryCaches();
    const server = new FakeServer(V1);
    // The deploy lands once every other file of V1 is stored, so /a.js arrives with V2's bytes.
    server.hold = async (url) => {
      if (url !== "/a.js" || server.deployed !== V1) {
        return;
      }
      while (storedPaths(caches, V1).length < 3) {
        // Polls the cache until the other lanes have stored their files.
        // eslint-disable-next-line no-await-in-loop
        await settle(1);
      }
      server.deployed = V2;
    };
    const page = load(caches, server);
    await expect(page.launch.run()).resolves.toBe("play");
    expect(server.fileFetches.filter((url) => url === "/a.js")).toHaveLength(2);
    expect(server.fileFetches.filter((url) => url !== "/a.js").sort()).toEqual([
      "/b.js",
      "/c.js",
      "/play/",
    ]);
    expect(await page.store.readState()).toEqual({ active: "bbbb" });
    expect(await page.store.complete(V2.manifest)).toBe(true);
    const v2 = caches.named.get(buildCacheName(POLICY, "bbbb"))!;
    expect(await (await v2.match("/a.js"))?.text()).toBe("alpha two");
    expect(await (await v2.match("/b.js"))?.text()).toBe("shared bravo");
  });
});
