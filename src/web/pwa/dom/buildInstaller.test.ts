import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

import { describe, expect, it, vi } from "vitest";

import { BUILD_HASH_HEADER, buildCacheName, type BuildManifest } from "../buildContract.ts";
import {
  BACKGROUND_INSTALL,
  BuildInstallError,
  type BuildInstallOptions,
  installBuild,
} from "./buildInstaller.ts";
import { createBuildStore } from "./buildStore.ts";

const ORIGIN = "https://game.test";
const policy = { cacheNamePrefix: "game-", hashedAssetPrefix: "/assets/" };

const pathOf = (key: Request | string) => {
  const url = new URL(key instanceof Request ? key.url : key, ORIGIN);
  return url.pathname + url.search;
};

class FakeCache {
  readonly entries = new Map<string, Response>();
  failPut: Error | undefined;

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
    if (this.failPut !== undefined) {
      throw this.failPut;
    }
    const body = await response.arrayBuffer();
    this.entries.set(pathOf(key), new Response(body, { headers: response.headers }));
  }
}

class FakeCaches {
  readonly named = new Map<string, FakeCache>();
  failPut: Error | undefined;

  delete(name: string): Promise<boolean> {
    return Promise.resolve(this.named.delete(name));
  }

  has(name: string): Promise<boolean> {
    return Promise.resolve(this.named.has(name));
  }

  keys(): Promise<string[]> {
    return Promise.resolve([...this.named.keys()]);
  }

  open(name: string): Promise<FakeCache> {
    const cache = this.named.get(name) ?? new FakeCache();
    cache.failPut = name.includes("build-") ? this.failPut : undefined;
    this.named.set(name, cache);
    return Promise.resolve(cache);
  }
}

const sha256 = (body: string) => createHash("sha256").update(body).digest("hex");

interface Served {
  body: string | Uint8Array<ArrayBuffer>;
  headers?: Record<string, string>;
  status?: number;
}

// Serves bodies by path. failures throws a network error that many times; stalls never answers
// that many times until the attempt aborts; chunks splits each body into that many reads.
class FakeServer {
  readonly calls: { init: RequestInit; url: string }[] = [];
  readonly failures = new Map<string, number>();
  readonly stalls = new Map<string, number>();
  inFlight = 0;
  maxInFlight = 0;

  constructor(readonly files: Map<string, Served>) {}

  readonly fetch = async (url: string, init: RequestInit): Promise<Response> => {
    this.calls.push({ init, url });
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      await new Promise((resolve) => {
        setTimeout(resolve, 1);
      });
      const stalls = this.stalls.get(url) ?? 0;
      if (stalls > 0) {
        this.stalls.set(url, stalls - 1);
        await new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason as Error));
        });
      }
      const failures = this.failures.get(url) ?? 0;
      if (failures > 0) {
        this.failures.set(url, failures - 1);
        throw new TypeError(`Failed to fetch ${url}`);
      }
      const served = this.files.get(url);
      const response = new Response(served?.body ?? "missing", {
        headers: served?.headers ?? { "content-type": "text/javascript" },
        status: served === undefined ? 404 : (served.status ?? 200),
      });
      Object.defineProperty(response, "url", { value: new URL(url, ORIGIN).href });
      return response;
    } finally {
      this.inFlight -= 1;
    }
  };

  fetched(): string[] {
    return this.calls.map((call) => call.url);
  }
}

// A clock whose timers fire only when settle finds no other progress.
class FakeClock {
  time = 0;
  private readonly timers = new Map<number, { at: number; handler: () => void }>();
  private nextId = 1;

  readonly now = () => this.time;

  readonly setTimeout = (handler: () => void, ms: number) => {
    const id = this.nextId;
    this.nextId += 1;
    this.timers.set(id, { at: this.time + ms, handler });
    return id;
  };

  readonly clearTimeout = (id: number) => {
    this.timers.delete(id);
  };

  fireNext(): boolean {
    const [id, timer] = [...this.timers].sort((a, b) => a[1].at - b[1].at)[0] ?? [];
    if (id === undefined || timer === undefined) {
      return false;
    }
    this.timers.delete(id);
    this.time = Math.max(this.time, timer.at);
    timer.handler();
    return true;
  }

  async settle<T>(pending: Promise<T>): Promise<T> {
    let done = false;
    pending.then(
      () => {
        done = true;
      },
      () => {
        done = true;
      },
    );
    // done changes in the settlement callbacks above.
    // eslint-disable-next-line no-unmodified-loop-condition
    for (let round = 0; round < 1000 && !done; round += 1) {
      // Real time passes so fetches, streams and digests finish before a fake timer fires.
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => {
        setTimeout(resolve, 20);
      });
      if (!done) {
        this.fireNext();
      }
    }
    return pending;
  }
}

function buildOf(version: string, bodies: Record<string, string>): BuildManifest {
  return {
    boot: [],
    buildId: `build-${version}`,
    files: Object.entries(bodies).map(([url, body]) => ({
      byteSize: new TextEncoder().encode(body).byteLength,
      sha256: sha256(body),
      url,
    })),
    schema: 1,
    sounds: {},
    version,
  };
}

function setup(
  bodies: Record<string, Served["body"]>,
  storage?: { quota: number; usage: number },
  headers?: Record<string, Record<string, string>>,
) {
  const caches = new FakeCaches();
  const store = createBuildStore(
    { caches: caches as unknown as CacheStorage, origin: ORIGIN },
    policy,
  );
  const server = new FakeServer(
    new Map(
      Object.entries(bodies).map(([url, body]) => [
        url,
        {
          body,
          headers: headers?.[url] ?? { "content-type": "text/javascript" },
        },
      ]),
    ),
  );
  const clock = new FakeClock();
  const persist = vi.fn(() => Promise.resolve(true));
  const estimate = vi.fn(() => Promise.resolve(storage ?? { quota: 1e9, usage: 0 }));
  const context = {
    clearTimeout: clock.clearTimeout,
    fetch: server.fetch,
    now: clock.now,
    origin: ORIGIN,
    policy,
    setTimeout: clock.setTimeout,
    storage: { estimate, persist },
    store,
  };
  const install = (options: BuildInstallOptions) => installBuild(context, options);
  // For installs that wait on retry backoff or the inactivity timeout.
  const installTimed = (options: BuildInstallOptions) =>
    clock.settle(installBuild(context, options));
  return { caches, clock, context, estimate, install, installTimed, persist, server, store };
}

const files = { "/a.js": "alpha", "/b.js": "bravo", "/c.png": "charlie", "/d.js": "delta" };
const packUrl = `/.game-kit/pack-${"a".repeat(64)}.bin`;
const nextPackUrl = `/.game-kit/pack-${"b".repeat(64)}.bin`;
const packFiles = {
  "/a.svg": "α".repeat(80),
  "/b.json": "{}".repeat(80),
  "/c.ogg": "og".repeat(80),
};
const gzipFiles = { "/a.svg": "α".repeat(80), "/b.json": "{}".repeat(80) };
const gzipDecoded = Object.values(gzipFiles).join("");
const gzip = (body: string) => Uint8Array.from(gzipSync(body, { level: 9 }));
const packBody = gzip(Object.values(packFiles).join(""));
const packed = packedBuild("packed", packFiles, packUrl, packBody);
const envelope = gzip(gzipDecoded);
const gzipManifest = (encodedByteSize = envelope.byteLength): BuildManifest => ({
  ...buildOf("gzip", gzipFiles),
  packs: [{ encodedByteSize, encoding: "gzip", members: Object.keys(gzipFiles), url: packUrl }],
});

function packedBuild(
  version: string,
  bodies: Record<string, string>,
  url: string,
  body: Uint8Array,
): BuildManifest {
  return {
    ...buildOf(version, bodies),
    packs: [
      { encodedByteSize: body.byteLength, encoding: "gzip", members: Object.keys(bodies), url },
    ],
  };
}

describe("installBuild", () => {
  it("decodes a gzip envelope served without HTTP compression and reports encoded progress", async () => {
    const { caches, install, server, store } = setup({ ...gzipFiles, [packUrl]: envelope });
    const manifest = gzipManifest();
    const progress = vi.fn();
    await expect(install({ manifest, onBytes: progress })).resolves.toBe("complete");
    expect(server.fetched()).toEqual([packUrl]);
    expect(progress).toHaveBeenLastCalledWith(envelope.byteLength, envelope.byteLength);
    const cache = await caches.open(buildCacheName(policy, manifest.version));
    expect(await (await cache.match("/a.svg"))?.text()).toBe(gzipFiles["/a.svg"]);
    expect(await store.complete(manifest)).toBe(true);
  });

  it.each([
    ["encoded length", envelope, envelope.byteLength - 1],
    ["expanded length", gzip(gzipDecoded + "x".repeat(150)), undefined],
    ["short decoded body", gzip(gzipDecoded.slice(0, -1)), undefined],
    ["invalid gzip", new Uint8Array(envelope.byteLength), undefined],
  ] as const)("falls back when the gzip pack has %s", async (_case, body, advertisedSize) => {
    const { install, server, store } = setup({ ...gzipFiles, [packUrl]: body });
    const manifest = gzipManifest(advertisedSize ?? body.byteLength);
    await expect(install({ lanes: 1, manifest })).resolves.toBe("complete");
    expect(server.fetched()).toEqual([packUrl, ...Object.keys(gzipFiles)]);
    expect(await store.complete(manifest)).toBe(true);
  });

  it("uses individual URLs when gzip decoding is unavailable", async () => {
    const { install, server } = setup({ ...gzipFiles, [packUrl]: envelope });
    vi.stubGlobal("DecompressionStream", undefined);
    try {
      await expect(install({ manifest: gzipManifest() })).resolves.toBe("complete");
      expect(server.fetched().sort()).toEqual(Object.keys(gzipFiles));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("downloads one pack and stores each verified member under its normal URL and media type", async () => {
    const { caches, install, server, store } = setup({ [packUrl]: packBody, ...packFiles });
    const progress = vi.fn();
    await expect(install({ manifest: packed, onBytes: progress })).resolves.toBe("complete");
    expect(server.fetched()).toEqual([packUrl]);
    expect(server.calls[0]?.init.cache).toBe("no-store");
    expect(progress).toHaveBeenLastCalledWith(packBody.byteLength, packBody.byteLength);
    const cache = await caches.open(buildCacheName(policy, packed.version));
    expect([...cache.entries.keys()]).toEqual(Object.keys(packFiles));
    expect(await store.complete(packed)).toBe(true);
    const svg = await cache.match("/a.svg");
    expect(await svg?.text()).toBe(packFiles["/a.svg"]);
    expect(svg?.headers.get("content-type")).toBe("image/svg+xml");
    expect(svg?.headers.get(BUILD_HASH_HEADER)).toBe(sha256(packFiles["/a.svg"]));
    expect((await cache.match("/b.json"))?.headers.get("content-type")).toBe("application/json");
    expect((await cache.match("/c.ogg"))?.headers.get("content-type")).toBe("audio/ogg");
  });

  it.each([
    ["sparse", { ...packFiles, "/b.json": "[]".repeat(80) }, ["/b.json"]],
    [
      "dense",
      { ...packFiles, "/b.json": "[]".repeat(80), "/c.ogg": "xx".repeat(80) },
      [nextPackUrl],
    ],
  ] as const)("uses the appropriate transport after %s reuse", async (label, update, requests) => {
    const { install, server, store } = setup({ [packUrl]: packBody, ...packFiles });
    await expect(install({ manifest: packed })).resolves.toBe("complete");
    server.calls.length = 0;
    server.files.set("/b.json", { body: update["/b.json"] });
    server.files.set("/c.ogg", { body: update["/c.ogg"] });
    const body = gzip(Object.values(update).join(""));
    server.files.set(nextPackUrl, { body });
    const next = packedBuild("next", update, nextPackUrl, body);
    const bytes = label === "dense" ? body.byteLength : Buffer.byteLength(update["/b.json"]);
    const progress = vi.fn();
    await expect(
      install({ ...BACKGROUND_INSTALL, manifest: next, onBytes: progress }),
    ).resolves.toBe("complete");
    expect(server.fetched()).toEqual(requests);
    expect(progress).toHaveBeenLastCalledWith(bytes, bytes);
    expect(await store.complete(next)).toBe(true);
  });

  it("keeps the verified prefix of a corrupt pack and fetches the outstanding individual members", async () => {
    const corrupt = gzip(packFiles["/a.svg"] + "[]".repeat(80) + packFiles["/c.ogg"]);
    const manifest = packedBuild(packed.version, packFiles, packUrl, corrupt);
    const { caches, install, server } = setup({ [packUrl]: corrupt, ...packFiles });
    const progress = vi.fn();
    await expect(install({ lanes: 1, manifest, onBytes: progress })).resolves.toBe("complete");
    expect(server.fetched()).toEqual([packUrl, "/b.json", "/c.ogg"]);
    expect(progress).toHaveBeenLastCalledWith(320, 320);
    const cache = await caches.open(buildCacheName(policy, packed.version));
    expect(await (await cache.match("/b.json"))?.text()).toBe(packFiles["/b.json"]);
  });

  it("fetches individual files when most pack members are reusable even if they are small", async () => {
    const previous = {
      "/a.svg": "a".repeat(100),
      "/b.svg": "b".repeat(100),
      "/c.svg": "c",
      "/d.svg": "d",
      "/e.svg": "e",
    };
    const update = { ...previous, "/a.svg": "x".repeat(100), "/b.svg": "y".repeat(100) };
    const { install, server } = setup(previous);
    await expect(install({ manifest: buildOf("old", previous) })).resolves.toBe("complete");
    server.calls.length = 0;
    server.files.set("/a.svg", { body: update["/a.svg"] });
    server.files.set("/b.svg", { body: update["/b.svg"] });
    const body = gzip(Object.values(update).join(""));
    server.files.set(packUrl, { body });
    const manifest = packedBuild("new", update, packUrl, body);
    await expect(install({ manifest })).resolves.toBe("complete");
    expect(server.fetched()).toEqual(["/a.svg", "/b.svg"]);
  });

  it("installs added pack members and keeps removed files only in the old pinned build", async () => {
    const previous = { "/a.svg": packFiles["/a.svg"], "/removed.svg": "old" };
    const update = {
      "/a.svg": previous["/a.svg"],
      "/new-a.svg": "new-a".repeat(50),
      "/new-b.svg": "new-b".repeat(50),
    };
    const { caches, install, server, store } = setup({ ...previous, ...update });
    const old = buildOf("old", previous);
    await expect(install({ manifest: old })).resolves.toBe("complete");
    await store.setActive(old.version);
    await store.writePin("old-client", old.version);
    server.calls.length = 0;
    const body = gzip(Object.values(update).join(""));
    server.files.set(nextPackUrl, { body });
    const next = packedBuild("new", update, nextPackUrl, body);
    await expect(install({ ...BACKGROUND_INSTALL, manifest: next })).resolves.toBe("complete");
    expect(server.fetched()).toEqual([nextPackUrl]);
    const target = await caches.open(buildCacheName(policy, next.version));
    expect([...target.entries.keys()]).toEqual(Object.keys(update));
    const original = await caches.open(buildCacheName(policy, old.version));
    expect(await (await original.match("/removed.svg"))?.text()).toBe("old");
    expect(await store.readPin("old-client")).toBe(old.version);
    expect(await store.readState()).toEqual({ active: old.version });
  });

  it("falls back from a missing pack and detects a missing pinned individual file", async () => {
    const { install, server, store } = setup({
      "/a.svg": packFiles["/a.svg"],
      "/c.ogg": packFiles["/c.ogg"],
    });
    await expect(install({ lanes: 1, manifest: packed })).resolves.toBe("changed");
    expect(server.fetched()).toEqual([packUrl, "/a.svg", "/b.json"]);
    expect(await store.complete(packed)).toBe(false);
  });

  it("uses individual URLs when a pack body is truncated", async () => {
    const { install, server } = setup({
      [packUrl]: packBody.subarray(0, packBody.byteLength - 1),
      ...packFiles,
    });
    await expect(install({ lanes: 1, manifest: packed })).resolves.toBe("complete");
    expect(server.fetched()).toEqual([packUrl, ...Object.keys(packFiles)]);
  });

  it("aborts a pack without individual fallback and resumes from previously verified members", async () => {
    const { caches, install, server } = setup({ [packUrl]: packBody, ...packFiles });
    const cache = await caches.open(buildCacheName(policy, packed.version));
    const controller = new AbortController();
    const stop = new Error("Page closed");
    const put = cache.put.bind(cache);
    vi.spyOn(cache, "put").mockImplementationOnce(async (key, response) => {
      await put(key, response);
      controller.abort(stop);
    });
    await expect(install({ manifest: packed, signal: controller.signal })).rejects.toBe(stop);
    expect(server.fetched()).toEqual([packUrl]);
    expect([...cache.entries.keys()]).toEqual(["/a.svg"]);
    server.calls.length = 0;
    await expect(install({ manifest: packed })).resolves.toBe("complete");
    expect(server.fetched()).toEqual([packUrl]);
    expect([...cache.entries.keys()]).toEqual(Object.keys(packFiles));
    expect((await cache.match("/a.svg"))?.headers.get(BUILD_HASH_HEADER)).toBe(
      sha256(packFiles["/a.svg"]),
    );
  });

  it("fetches, verifies and stores every file with its digest header and content type", async () => {
    const { caches, install, persist, server, store } = setup(files, undefined, {
      "/c.png": { "content-type": "image/png", "server-timing": "edge" },
    });
    const manifest = buildOf("v1", files);
    const bytes: [number, number][] = [];
    const result = await install({
      manifest,
      onBytes: (received, total) => bytes.push([received, total]),
    });
    expect(result).toBe("complete");
    expect(persist).toHaveBeenCalledOnce();
    expect(await store.complete(manifest)).toBe(true);
    expect(await store.readManifest("v1")).toEqual(manifest);
    expect(server.calls[0]?.init).toMatchObject({
      cache: "no-store",
      credentials: "same-origin",
      priority: "auto",
      redirect: "error",
    });
    const stored = await (await caches.open(buildCacheName(policy, "v1"))).match("/c.png");
    expect(stored?.headers.get(BUILD_HASH_HEADER)).toBe(sha256("charlie"));
    expect(stored?.headers.get("content-type")).toBe("image/png");
    expect(stored?.headers.has("server-timing")).toBe(false);
    expect(await stored?.text()).toBe("charlie");
    expect(bytes.at(0)).toEqual([0, 22]);
    expect(bytes.at(-1)).toEqual([22, 22]);
    expect(await store.readState()).toEqual({});
  });

  it("lets the HTTP cache answer hashed files and fetches every other URL past it", async () => {
    const bodies = { "/assets/app-1a2b.js": "hashed", "/play/": "page" };
    const { install, server } = setup(bodies);
    expect(await install({ manifest: buildOf("v1", bodies) })).toBe("complete");
    const modes = Object.fromEntries(server.calls.map(({ init, url }) => [url, init.cache]));
    expect(modes).toEqual({ "/assets/app-1a2b.js": "default", "/play/": "no-store" });
  });

  it("fetches at most lanes files at once", async () => {
    const many = Object.fromEntries(
      Array.from({ length: 20 }, (_, index) => [`/f${index}.js`, `body ${index}`]),
    );
    const foreground = setup(many);
    await foreground.install({ manifest: buildOf("v1", many) });
    expect(foreground.server.maxInFlight).toBe(6);
    const background = setup(many);
    await background.install({ ...BACKGROUND_INSTALL, manifest: buildOf("v1", many) });
    expect(background.server.maxInFlight).toBe(2);
    expect(background.server.calls.every((call) => call.init.priority === "low")).toBe(true);
  });

  it("resumes by fetching only absent files and entries with a different digest header", async () => {
    const { install, server, store } = setup(files);
    const manifest = buildOf("v1", files);
    await store.putFile(
      "v1",
      "/a.js",
      new Response("alpha", { headers: { [BUILD_HASH_HEADER]: sha256("alpha") } }),
    );
    await store.putFile(
      "v1",
      "/b.js",
      new Response("old", { headers: { [BUILD_HASH_HEADER]: sha256("old") } }),
    );
    expect(await install({ manifest })).toBe("complete");
    expect(server.fetched().sort()).toEqual(["/b.js", "/c.png", "/d.js"]);
    server.calls.length = 0;
    expect(await install({ manifest })).toBe("complete");
    expect(server.calls).toEqual([]);
  });

  it("copies files another build holds by digest without fetching or hashing them", async () => {
    const { install, server, store } = setup({ ...files, "/e.js": "echo" });
    await install({ manifest: buildOf("v1", files) });
    server.calls.length = 0;
    const digest = vi.spyOn(crypto.subtle, "digest");
    const next = buildOf("v2", { "/a.js": "alpha", "/e.js": "echo", "/moved.js": "bravo" });
    expect(await install({ manifest: next })).toBe("complete");
    expect(server.fetched()).toEqual(["/e.js"]);
    expect(digest).toHaveBeenCalledOnce();
    digest.mockRestore();
    expect(await store.complete(next)).toBe(true);
    expect(await store.complete(buildOf("v1", files))).toBe(true);
  });

  it("resolves changed when a body stops matching, keeping verified entries for the restart", async () => {
    const { install, server, store } = setup(files);
    const manifest = buildOf("v1", files);
    server.files.set("/c.png", { body: "charlie 2" });
    expect(await install({ lanes: 1, manifest })).toBe("changed");
    expect((await store.missing(manifest)).map((file) => file.url)).toEqual(["/c.png", "/d.js"]);
    server.calls.length = 0;
    const redeployed = buildOf("v2", { ...files, "/c.png": "charlie 2" });
    expect(await install({ manifest: redeployed })).toBe("complete");
    expect(server.fetched().sort()).toEqual(["/c.png", "/d.js"]);
  });

  it("resolves changed for a body of the same size with a different digest", async () => {
    const { install, server } = setup(files);
    server.files.set("/a.js", { body: "ALPHA" });
    expect(await install({ manifest: buildOf("v1", files) })).toBe("changed");
  });

  it("retries a failed fetch and fails with network once attempts run out", async () => {
    const retried = setup(files);
    retried.server.failures.set("/a.js", 2);
    expect(await retried.installTimed({ manifest: buildOf("v1", files) })).toBe("complete");
    expect(retried.server.fetched().filter((url) => url === "/a.js")).toHaveLength(3);

    const failed = setup(files);
    failed.server.failures.set("/a.js", 3);
    const error = await failed
      .installTimed({ manifest: buildOf("v1", files) })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BuildInstallError);
    expect(error).toMatchObject({ reason: "network", url: "/a.js" });

    const erroring = setup(files);
    erroring.server.files.set("/b.js", { body: "bravo", status: 500 });
    await expect(
      erroring.install({ attempts: 1, manifest: buildOf("v1", files) }),
    ).rejects.toMatchObject({ reason: "network", url: "/b.js" });
  });

  it.each([404, 410])("resolves changed when a pinned file is gone (%i)", async (status) => {
    const { install, server } = setup(files);
    server.files.set("/b.js", { body: "gone", status });
    expect(await install({ attempts: 1, manifest: buildOf("v1", files) })).toBe("changed");
  });

  it("aborts an attempt with no progress within inactivityMs and retries it", async () => {
    const { clock, installTimed, server } = setup(files);
    server.stalls.set("/a.js", 1);
    expect(await installTimed({ inactivityMs: 30_000, manifest: buildOf("v1", files) })).toBe(
      "complete",
    );
    expect(server.fetched().filter((url) => url === "/a.js")).toHaveLength(2);
    expect(clock.time).toBeGreaterThanOrEqual(31_000);
  });

  it("fails with quota before fetching when the estimate is short, and on a full cache", async () => {
    const short = setup(files, { quota: 100, usage: 90 });
    await expect(short.install({ manifest: buildOf("v1", files) })).rejects.toMatchObject({
      reason: "quota",
    });
    expect(short.server.calls).toEqual([]);

    const full = setup(files);
    full.caches.failPut = new DOMException("Full", "QuotaExceededError");
    await expect(full.install({ lanes: 1, manifest: buildOf("v1", files) })).rejects.toMatchObject({
      reason: "quota",
    });
    expect(full.server.calls).toHaveLength(1);
  });

  it("starts no attempt while paused", async () => {
    const { clock, context, server } = setup(files);
    let paused = true;
    const pending = installBuild(context, {
      ...BACKGROUND_INSTALL,
      manifest: buildOf("v1", files),
      paused: () => paused,
    });
    for (let round = 0; round < 3; round += 1) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => {
        setTimeout(resolve, 20);
      });
      clock.fireNext();
    }
    expect(server.calls).toEqual([]);
    paused = false;
    expect(await clock.settle(pending)).toBe("complete");
    expect(server.calls).toHaveLength(4);
  });

  it("rejects with the signal's reason when aborted", async () => {
    const { install, server } = setup(files);
    const controller = new AbortController();
    server.stalls.set("/a.js", 1);
    const pending = install({
      lanes: 1,
      manifest: buildOf("v1", files),
      signal: controller.signal,
    });
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
    controller.abort(new Error("Stopped"));
    await expect(pending).rejects.toThrow("Stopped");
    expect(server.fetched()).toEqual(["/a.js"]);
  });
});

describe("verified JSON bodies", () => {
  const json = '{"level":1}';
  const bodies = { "/one.json": json, "/two.json": json };
  const manifestWith = (): BuildManifest => ({
    ...buildOf("v1", bodies),
    verifiedJsonBodies: [
      { byteSize: json.length, sha256: sha256(json), urls: ["/one.json", "/two.json"] },
    ],
  });
  const base = { "content-type": "application/json; charset=utf-8" };

  it("keeps response-profile checks even when a pack index names a verified family", async () => {
    const { install, server } = setup({ ...bodies, [packUrl]: json + json }, undefined, {
      "/one.json": base,
      "/two.json": base,
    });
    const manifest: BuildManifest = {
      ...manifestWith(),
      packs: [{ encodedByteSize: 1, encoding: "gzip", members: Object.keys(bodies), url: packUrl }],
    };
    await expect(install({ manifest })).resolves.toBe("complete");
    expect(server.fetched().sort()).toEqual(Object.keys(bodies));
    expect(server.calls.every((call) => call.init.credentials === "omit")).toBe(true);
  });

  it("ignores unknown and HTTP/1.1 transport headers and fetches without credentials", async () => {
    const extra = {
      ...base,
      connection: "keep-alive",
      "keep-alive": "timeout=5",
      priority: "u=1",
      "server-timing": "cfEdge;dur=1",
    };
    const { install, server } = setup(bodies, undefined, {
      "/one.json": extra,
      "/two.json": extra,
    });
    expect(await install({ manifest: manifestWith() })).toBe("complete");
    expect(server.calls.every((call) => call.init.credentials === "omit")).toBe(true);
  });

  it("fetches a hashed family member past the HTTP cache", async () => {
    const hashed = { "/assets/one.json": json, "/assets/two.json": json };
    const { install, server } = setup(hashed, undefined, {
      "/assets/one.json": base,
      "/assets/two.json": base,
    });
    const manifest: BuildManifest = {
      ...buildOf("v1", hashed),
      verifiedJsonBodies: [
        { byteSize: json.length, sha256: sha256(json), urls: Object.keys(hashed) },
      ],
    };
    expect(await install({ manifest })).toBe("complete");
    expect(server.calls.map((call) => call.init.cache)).toEqual(["no-store", "no-store"]);
  });

  it.each([
    "clear-site-data",
    "content-disposition",
    "content-location",
    "content-range",
    "refresh",
    "set-cookie",
  ])("fails verification on %s", async (header) => {
    const { installTimed } = setup(bodies, undefined, {
      "/one.json": { ...base, [header]: "x" },
      "/two.json": base,
    });
    await expect(installTimed({ manifest: manifestWith() })).rejects.toMatchObject({
      reason: "verification",
      url: "/one.json",
    });
  });

  it("fails verification when a family's digest differs from the manifest", async () => {
    const { install, server } = setup(bodies);
    const manifest = manifestWith();
    await expect(
      install({
        manifest: {
          ...manifest,
          verifiedJsonBodies: [
            { byteSize: json.length, sha256: "0".repeat(64), urls: ["/one.json", "/two.json"] },
          ],
        },
      }),
    ).rejects.toMatchObject({ reason: "verification" });
    expect(server.calls).toEqual([]);
  });
});
