import { describe, expect, it, vi } from "vitest";

import {
  BUILD_HASH_HEADER,
  buildCacheName,
  type BuildManifest,
  buildManifestUrl,
  recordsCacheName,
} from "../../buildContract.ts";
import { createBuildStore } from "./buildStore.ts";

const ORIGIN = "https://game.test";
const policy = { cacheNamePrefix: "game-", hashedAssetPrefix: "/assets/" };

const pathOf = (key: Request | string) => {
  const url = new URL(key instanceof Request ? key.url : key, ORIGIN);
  return url.pathname + url.search;
};

class FakeCache {
  readonly entries = new Map<string, Response>();
  readonly putKeys: string[] = [];
  matches = 0;

  delete(key: Request | string): Promise<boolean> {
    return Promise.resolve(this.entries.delete(pathOf(key)));
  }

  keys(): Promise<Request[]> {
    return Promise.resolve([...this.entries.keys()].map((path) => new Request(ORIGIN + path)));
  }

  match(key: Request | string): Promise<Response | undefined> {
    this.matches += 1;
    return Promise.resolve(this.entries.get(pathOf(key))?.clone());
  }

  put(key: Request | string, response: Response): Promise<void> {
    this.putKeys.push(key instanceof Request ? key.url : key);
    this.entries.set(pathOf(key), response.clone());
    return Promise.resolve();
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

  open(name: string): Promise<FakeCache> {
    const cache = this.named.get(name) ?? new FakeCache();
    this.named.set(name, cache);
    return Promise.resolve(cache);
  }
}

const sha = (digit: string) => digit.repeat(64);

function manifestOf(version: string, files: Record<string, string>): BuildManifest {
  return {
    boot: [],
    buildId: `build-${version}`,
    files: Object.entries(files).map(([url, digest]) => ({ byteSize: 1, sha256: digest, url })),
    schema: 1,
    sounds: {},
    version,
  };
}

const entry = (digest: string, body = "x") =>
  new Response(body, { headers: { [BUILD_HASH_HEADER]: digest } });

function setup() {
  const caches = new FakeCaches();
  const store = createBuildStore(
    { caches: caches as unknown as CacheStorage, origin: ORIGIN },
    policy,
  );
  return { caches, store };
}

describe("records", () => {
  it("keeps active, staged and each pin as separate entries with no none value", async () => {
    const { caches, store } = setup();
    expect(await store.readState()).toEqual({});
    await store.setActive("v1");
    await store.setStaged("v2");
    await store.writePin("client a", "v1");
    await store.writePin("b", "v2");
    expect(await store.readState()).toEqual({ active: "v1", staged: "v2" });
    await store.setStaged(undefined);
    expect(await store.readState()).toEqual({ active: "v1" });
    expect(await store.readPin("client a")).toBe("v1");
    expect([...(await store.pinnedVersions())]).toEqual([
      ["client a", "v1"],
      ["b", "v2"],
    ]);
    await store.deletePin("client a");
    expect(await store.readPin("client a")).toBeUndefined();
    expect([...(await store.pinnedVersions())]).toEqual([["b", "v2"]]);
    expect(caches.named.get(recordsCacheName(policy))?.entries.size).toBe(2);
    expect([...caches.named.keys()]).toEqual([recordsCacheName(policy)]);
  });

  it("writes each record as {version} JSON under its same-origin absolute key", async () => {
    const { caches, store } = setup();
    await store.setActive("v1");
    await store.setStaged("v2");
    await store.writePin("a/b", "v1");
    await store.saveManifest(manifestOf("v1", {}));
    const records = caches.named.get(recordsCacheName(policy))!;
    expect(records.putKeys).toEqual([
      `${ORIGIN}/.game-kit/records/active`,
      `${ORIGIN}/.game-kit/records/staged`,
      `${ORIGIN}/.game-kit/records/pin/a%2Fb`,
      `${ORIGIN}${buildManifestUrl("v1")}`,
    ]);
    expect(await records.entries.get("/.game-kit/records/active")?.clone().json()).toEqual({
      version: "v1",
    });
    expect(await records.entries.get("/.game-kit/records/pin/a%2Fb")?.clone().json()).toEqual({
      version: "v1",
    });
    expect(await records.entries.get(buildManifestUrl("v1"))?.clone().json()).toEqual(
      manifestOf("v1", {}),
    );
    await records.put(`${ORIGIN}/.game-kit/records/staged`, new Response("v2"));
    await records.put(`${ORIGIN}/.game-kit/records/pin/c`, new Response('{"version":null}'));
    expect(await store.readState()).toEqual({ active: "v1" });
    expect(await store.readPin("c")).toBeUndefined();
  });

  it("refuses empty versions and client ids", async () => {
    const { store } = setup();
    await expect(store.setActive("")).rejects.toThrow(TypeError);
    await expect(store.writePin("", "v1")).rejects.toThrow(TypeError);
    await expect(store.setStaged("a b")).rejects.toThrow(TypeError);
  });

  it("round-trips manifests and treats a corrupt or foreign record as absent", async () => {
    const { caches, store } = setup();
    const manifest = manifestOf("v1", { "/a.js": sha("a") });
    await store.saveManifest(manifest);
    expect(await store.readManifest("v1")).toEqual(manifest);
    expect(await store.readManifest("v2")).toBeUndefined();
    const records = await caches.open(recordsCacheName(policy));
    await records.put(buildManifestUrl("v3"), new Response("{"));
    await records.put(buildManifestUrl("v4"), new Response(JSON.stringify(manifestOf("v5", {}))));
    expect(await store.readManifest("v3")).toBeUndefined();
    expect(await store.readManifest("v4")).toBeUndefined();
  });
});

describe("build caches", () => {
  it("reports absent files and entries whose digest header differs, by metadata only", async () => {
    const { caches, store } = setup();
    const manifest = manifestOf("v1", { "/a.js": sha("a"), "/b.js": sha("b"), "/c.js": sha("c") });
    expect((await store.missing(manifest)).map((file) => file.url)).toEqual([
      "/a.js",
      "/b.js",
      "/c.js",
    ]);
    expect(caches.named.has(buildCacheName(policy, "v1"))).toBe(false);
    await store.putFile("v1", "/a.js", entry(sha("a")));
    await store.putFile("v1", "/b.js", entry(sha("d")));
    const text = vi.spyOn(Response.prototype, "arrayBuffer");
    const digest = vi.spyOn(crypto.subtle, "digest");
    expect((await store.missing(manifest)).map((file) => file.url)).toEqual(["/b.js", "/c.js"]);
    expect(await store.complete(manifest)).toBe(false);
    await store.putFile("v1", "/b.js", entry(sha("b")));
    await store.putFile("v1", "/c.js", entry(sha("c")));
    expect(await store.complete(manifest)).toBe(true);
    expect(text).not.toHaveBeenCalled();
    expect(digest).not.toHaveBeenCalled();
    text.mockRestore();
    digest.mockRestore();
  });

  it("stores only entries carrying the digest header", async () => {
    const { store } = setup();
    await expect(store.putFile("v1", "/a.js", new Response("x"))).rejects.toThrow(TypeError);
  });

  it("finds an entry of any build by digest header through saved manifests", async () => {
    const { caches, store } = setup();
    await store.saveManifest(manifestOf("v1", { "/a.js": sha("a"), "/gone.js": sha("e") }));
    await store.saveManifest(manifestOf("v2", { "/b.js": sha("b"), "/stale.js": sha("c") }));
    await store.putFile("v1", "/a.js", entry(sha("a"), "A"));
    await store.putFile("v2", "/b.js", entry(sha("b"), "B"));
    await store.putFile("v2", "/stale.js", entry(sha("f")));
    expect(await (await store.findByHash(sha("a")))?.text()).toBe("A");
    expect((await store.findByHash(sha("b")))?.headers.get(BUILD_HASH_HEADER)).toBe(sha("b"));
    expect(await store.findByHash(sha("c"))).toBeUndefined();
    expect(await store.findByHash(sha("e"))).toBeUndefined();
    await caches.delete(buildCacheName(policy, "v1"));
    expect(await store.findByHash(sha("a"))).toBeUndefined();
  });

  it("reclaims builds neither active, staged, pinned nor the document's, and nothing else", async () => {
    const { caches, store } = setup();
    for (const version of ["v1", "v2", "v3", "v4", "v5", "v6"]) {
      // eslint-disable-next-line no-await-in-loop
      await store.saveManifest(manifestOf(version, {}));
      // eslint-disable-next-line no-await-in-loop
      await caches.open(buildCacheName(policy, version));
    }
    await caches.open("game-legacy-v0");
    await caches.open("other-build-v1");
    await store.setActive("v2");
    await store.setStaged("v3");
    await store.writePin("client", "v4");
    expect(await store.reclaim(["v5"])).toEqual([
      buildCacheName(policy, "v1"),
      buildCacheName(policy, "v6"),
    ]);
    expect([...caches.named.keys()].sort()).toEqual(
      [
        "game-build-v2",
        "game-build-v3",
        "game-build-v4",
        "game-build-v5",
        "game-legacy-v0",
        recordsCacheName(policy),
        "other-build-v1",
      ].sort(),
    );
    expect(await store.readManifest("v1")).toBeUndefined();
    expect(await store.readManifest("v4")).toBeDefined();
    expect(await store.readPin("client")).toBe("v4");
    // The router deletes the pin once its window closes.
    await store.deletePin("client");
    expect(await store.reclaim([])).toEqual([
      buildCacheName(policy, "v4"),
      buildCacheName(policy, "v5"),
    ]);
    expect(await store.readManifest("v4")).toBeUndefined();
  });
});
