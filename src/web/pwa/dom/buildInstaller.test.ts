import { createHash } from "node:crypto";

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
  body: string;
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
  bodies: Record<string, string>,
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

describe("installBuild", () => {
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

    const missing = setup(files);
    missing.server.files.delete("/b.js");
    await expect(
      missing.install({ attempts: 1, manifest: buildOf("v1", files) }),
    ).rejects.toMatchObject({ reason: "network", url: "/b.js" });
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
