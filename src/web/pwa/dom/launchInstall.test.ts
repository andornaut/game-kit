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
  soundFormat?: string,
) {
  const reload = vi.fn();
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
    location: { href: `${ORIGIN}/play/`, reload },
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
      soundFormat,
    },
  );
  return { failures, launch, networkPlay, reload, store };
}

// The bound on waiting for an observable install outcome.
const WAIT = { interval: 1, timeout: 5000 };

const storedPaths = (caches: MemoryCaches, build: Build) => [
  ...(caches.named.get(buildCacheName(POLICY, build.manifest.version))?.entries.keys() ?? []),
];

// Resolves once count of the build's files are stored.
const storedCount = (caches: MemoryCaches, build: Build, count: number): Promise<void> =>
  vi.waitFor(() => expect(storedPaths(caches, build)).toHaveLength(count), WAIT);

const roomFor = (free: number): Pick<StorageManager, "estimate" | "persist"> => ({
  estimate: async () => ({ quota: 1_000_000, usage: 1_000_000 - free }),
  persist: async () => true,
});

describe("startup storage recovery", () => {
  it.each(["lookup", "body"] as const)(
    "retries an active record %s failure without installing or writing",
    async (failure) => {
      const caches = new MemoryCaches();
      const server = new FakeServer(V1);
      const installed = load(caches, server);
      await expect(installed.launch.run()).resolves.toBe("play");
      installed.launch.dispose();
      const records = await caches.open(recordsCacheName(POLICY));
      const recordMatch = records.match.bind(records);
      const write = vi.spyOn(records, "put");
      const read = vi.spyOn(records, "match").mockImplementation(async (key) => {
        if (pathOf(key) !== ACTIVE_RECORD_PATH) {
          return recordMatch(key);
        }
        const error = new Error("cache read refused");
        if (failure === "lookup") {
          throw error;
        }
        return new Response(new ReadableStream({ start: (controller) => controller.error(error) }));
      });
      const fetch = vi.spyOn(server, "fetch");
      const page = load(caches, server);
      const launched = page.launch.run().catch((error: unknown) => error);
      await vi.waitFor(() => expect(page.failures).toHaveLength(1), WAIT);
      expect(page.failures[0]?.reason).toBe("verification");
      expect(page.networkPlay).toEqual([]);
      expect(fetch).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
      read.mockRestore();
      page.failures[0]!.retry();
      page.failures[0]!.retry();
      await expect(launched).resolves.toBe("play");
      expect(await page.store.readState()).toEqual({ active: "aaaa" });
      expect(write).not.toHaveBeenCalled();
      expect(page.reload).not.toHaveBeenCalled();
      page.launch.dispose();
    },
  );
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
    const { fileFetches } = server;
    const killed = load(caches, server);
    void killed.launch.run();
    // The kill lands once every other file is stored and /c.js is in flight.
    await storedCount(caches, V1, 3);
    await vi.waitFor(() => expect(fileFetches).toContain("/c.js"), WAIT);
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
    // The refused active record ends the attempt with a failure.
    await vi.waitFor(() => expect(killed.failures).toHaveLength(1), WAIT);
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
  it("reloads the controlled old document into the new build instead of playing it", async () => {
    const caches = new MemoryCaches();
    const server = new FakeServer(V1);
    server.hold = (url) =>
      url === "/a.js" && server.deployed === V1
        ? storedCount(caches, V1, 3).then(() => {
            server.deployed = V2;
          })
        : undefined;
    const page = load(caches, server);
    await expect(page.launch.run()).resolves.toBe("reloading");
    expect(page.reload).toHaveBeenCalledTimes(1);
    expect(await page.store.readState()).toEqual({ active: "bbbb" });

    // The reloaded document is the new build's, served from the active build with no fetch.
    const fetched = server.fileFetches.length;
    const next = load(caches, server);
    await expect(next.launch.run()).resolves.toBe("play");
    expect(next.reload).not.toHaveBeenCalled();
    expect(server.fileFetches.slice(fetched)).toEqual([]);
  });

  it("restarts on the new manifest and fetches only the files it changed", async () => {
    const caches = new MemoryCaches();
    const server = new FakeServer(V1);
    // The deploy lands once every other file of V1 is stored, so /a.js arrives with V2's bytes.
    server.hold = (url) =>
      url === "/a.js" && server.deployed === V1
        ? storedCount(caches, V1, 3).then(() => {
            server.deployed = V2;
          })
        : undefined;
    const page = load(caches, server);
    await expect(page.launch.run()).resolves.toBe("reloading");
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

describe("sound formats", () => {
  const SOUNDS = buildOf("ssss", {
    "/a.js": "alpha",
    "/play/": "<html>",
    "/s/hit.m4a": "hit m4a",
    "/s/hit.ogg": "hit ogg",
    "/s/hum.m4a": "hum m4a",
    "/s/hum.ogg": "hum ogg",
  });
  const deployed: Build = {
    ...SOUNDS,
    manifest: {
      ...SOUNDS.manifest,
      sounds: { "/s/hit": ["/s/hit.ogg", "/s/hit.m4a"], "/s/hum": ["/s/hum.ogg", "/s/hum.m4a"] },
    },
  };

  it("fetches, stores and checks only the chosen format, durably for the next launch", async () => {
    const caches = new MemoryCaches();
    const server = new FakeServer(deployed);
    const page = load(caches, server, undefined, "ogg");
    await expect(page.launch.run()).resolves.toBe("play");
    const chosen = ["/a.js", "/play/", "/s/hit.ogg", "/s/hum.ogg"];
    expect(server.fileFetches.sort()).toEqual(chosen);
    expect(storedPaths(caches, deployed).sort()).toEqual(chosen);
    const saved = await page.store.readManifest("ssss");
    expect(saved?.soundFormat).toBe("ogg");
    expect(await page.store.complete(saved!)).toBe(true);
    expect(await page.store.complete(deployed.manifest)).toBe(false);

    server.fileFetches.length = 0;
    const next = load(caches, server, undefined, "ogg");
    await expect(next.launch.run()).resolves.toBe("play");
    expect(server.fileFetches).toEqual([]);
  });

  it("installs every alternative without a sound format", async () => {
    const caches = new MemoryCaches();
    const server = new FakeServer(deployed);
    const page = load(caches, server);
    await expect(page.launch.run()).resolves.toBe("play");
    expect(server.fileFetches.sort()).toEqual(Object.keys(deployed.bodies).sort());
    expect(await page.store.complete(deployed.manifest)).toBe(true);
  });
});
