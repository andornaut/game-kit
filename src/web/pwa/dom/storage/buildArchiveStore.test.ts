import { afterEach, describe, expect, it, vi } from "vitest";

import { BUILD_ARCHIVE_HEADER_BYTES, encodeBuildArchiveIndex } from "../../archive/buildArchive.ts";
import {
  BUILD_HASH_HEADER,
  buildCacheName,
  buildManifestUrl,
  recordsCacheName,
} from "../../buildContract.ts";
import { type ArchivedBuildPointer, createBuildArchiveStore } from "./buildArchiveStore.ts";
import { createBuildStore } from "./buildStore.ts";

const ORIGIN = "https://game.test";
const POLICY = { cacheNamePrefix: "game-", hashedAssetPrefix: "/assets/" };
const BODY_KEY = `${ORIGIN}/.game-kit/records/archive-body`;
const RECORDS = recordsCacheName(POLICY);
const markerKey = (version: string) => `${ORIGIN}/.game-kit/archive-record-${version}.json`;
const buildCache = (version: string) => buildCacheName(POLICY, version);

class FakeCache {
  readonly entries = new Map<string, Response>();

  readonly beforePut: (key: string) => void;

  constructor(beforePut: (key: string) => void) {
    this.beforePut = beforePut;
  }

  delete(key: string): Promise<boolean> {
    return Promise.resolve(this.entries.delete(key));
  }

  keys(): Promise<Request[]> {
    return Promise.resolve([...this.entries.keys()].map((key) => new Request(key)));
  }

  match(key: string): Promise<Response | undefined> {
    return Promise.resolve(this.entries.get(key)?.clone());
  }

  put(key: string, response: Response): Promise<void> {
    this.beforePut(key);
    this.entries.set(key, response.clone());
    return Promise.resolve();
  }
}

class FakeCaches {
  readonly named = new Map<string, FakeCache>();
  readonly writes: string[] = [];
  writeFailure: string | undefined;
  afterWrite: ((key: string) => void) | undefined;

  delete(name: string): Promise<boolean> {
    return Promise.resolve(this.named.delete(name));
  }

  keys(): Promise<string[]> {
    return Promise.resolve([...this.named.keys()]);
  }

  match(key: string, { cacheName }: { cacheName: string }): Promise<Response | undefined> {
    return this.named.get(cacheName)?.match(key) ?? Promise.resolve(undefined);
  }

  open(name: string): Promise<FakeCache> {
    const cache =
      this.named.get(name) ??
      new FakeCache((key) => {
        if (key === this.writeFailure) {
          throw new Error("Cache write refused");
        }
        this.writes.push(key);
        this.afterWrite?.(key);
      });
    this.named.set(name, cache);
    return Promise.resolve(cache);
  }
}

function setup() {
  const caches = new FakeCaches();
  const context = { caches: caches as unknown as CacheStorage, origin: ORIGIN };
  const store = createBuildArchiveStore({ ...context, policy: POLICY });
  return { caches, legacy: createBuildStore(context, POLICY), store };
}

function archiveOf(version = "v1") {
  const buildId = "source";
  const prefix = encodeBuildArchiveIndex({
    buildId,
    files: [["/play/", 3, "text/html; charset=utf-8"]],
    version,
  });
  const blob = new Blob([prefix, "abc"]);
  const pointer: ArchivedBuildPointer = {
    archive: { byteSize: blob.size, schema: 1, sha256: "a".repeat(64) },
    buildId,
    manifest: buildManifestUrl(version),
    schema: 1,
    version,
  };
  return { blob, pointer, prefix };
}

afterEach(() => vi.restoreAllMocks());

describe("build archive store", () => {
  it("commits one body and a separate pointer, then reads the bounded index without opening caches", async () => {
    const { caches, legacy, store } = setup();
    const { blob, pointer, prefix } = archiveOf();

    expect(await store.read("v1")).toEqual({ kind: "unknown" });
    expect(await store.complete("v1")).toBe(false);
    expect(caches.named.size).toBe(0);
    await store.put(pointer, blob);
    expect(caches.writes).toEqual([BODY_KEY, markerKey("v1")]);
    expect([...caches.named.get(buildCache("v1"))!.entries.keys()]).toEqual([BODY_KEY]);
    expect(await legacy.readState()).toEqual({});
    await legacy.saveManifest({
      boot: [],
      buildId: pointer.buildId,
      files: [],
      schema: 1,
      sounds: {},
      version: pointer.version,
    });

    const slice = vi.spyOn(Blob.prototype, "slice");
    const open = vi.spyOn(caches, "open");
    expect(await store.complete("v1", pointer)).toBe(true);
    expect(await store.complete("v1", { ...pointer, buildId: "other" })).toBe(false);
    expect(slice).not.toHaveBeenCalled();
    const read = await store.read("v1");
    expect(read.kind).toBe("ready");
    if (read.kind !== "ready") {
      throw new Error("Expected a ready archive");
    }
    expect(read.pointer).toEqual(pointer);
    expect(slice.mock.calls).toEqual([
      [0, BUILD_ARCHIVE_HEADER_BYTES],
      [0, prefix.byteLength],
    ]);
    expect(open).not.toHaveBeenCalled();
    expect(read.index.files).toEqual([
      {
        byteSize: 3,
        contentType: "text/html; charset=utf-8",
        offset: prefix.byteLength,
        url: "/play/",
      },
    ]);
    expect(await read.blob.slice(prefix.byteLength).text()).toBe("abc");
  });

  it("rejects invalid sizes, references and indexes before any cache write", async () => {
    const { caches, store } = setup();
    const { blob, pointer } = archiveOf();
    await expect(store.put(pointer, new Blob([]))).rejects.toThrow(/size/);
    await expect(store.put({ ...pointer, buildId: "other" }, blob)).rejects.toThrow(/identity/);
    await expect(
      store.put({ ...pointer, archive: { ...pointer.archive, sha256: "bad" } }, blob),
    ).rejects.toThrow(/reference/);
    expect(caches.named.size).toBe(0);
  });

  it("publishes no marker after a body failure or abort, and retries an interrupted marker write", async () => {
    const { caches, store } = setup();
    const { blob, pointer } = archiveOf();
    caches.writeFailure = BODY_KEY;
    await expect(store.put(pointer, blob)).rejects.toThrow(/refused/);
    expect(caches.writes).toEqual([]);

    caches.writeFailure = undefined;
    const abort = new AbortController();
    caches.afterWrite = () => abort.abort(new Error("disposed"));
    await expect(store.put(pointer, blob, abort.signal)).rejects.toThrow("disposed");
    expect(caches.writes).toEqual([BODY_KEY]);
    expect(await store.read("v1")).toEqual({ kind: "unknown" });

    caches.afterWrite = undefined;
    caches.writeFailure = markerKey("v1");
    await expect(store.put(pointer, blob)).rejects.toThrow(/refused/);
    expect(await store.complete("v1")).toBe(false);
    expect(await store.read("v1")).toEqual({ kind: "unknown" });
    caches.writeFailure = undefined;
    await store.put(pointer, blob);
    expect(await store.complete("v1")).toBe(true);
  });

  it("keeps known missing or truncated bodies distinct from unknown versions and allows exact repair", async () => {
    const { caches, store } = setup();
    const { blob, pointer } = archiveOf();
    await store.put(pointer, blob);
    const cache = caches.named.get(buildCache("v1"))!;
    const original = cache.entries.get(BODY_KEY)!;

    const wrongDigest = new Headers(original.headers);
    wrongDigest.set(BUILD_HASH_HEADER, "b".repeat(64));
    cache.entries.set(BODY_KEY, new Response(blob, { headers: wrongDigest }));
    expect(await store.complete("v1")).toBe(false);
    cache.entries.set(BODY_KEY, new Response("short", { headers: original.headers }));
    expect(await store.complete("v1")).toBe(false);
    expect(await store.read("v1")).toEqual({ kind: "unavailable", pointer });
    await caches.delete(buildCache("v1"));
    expect(await store.read("v1")).toEqual({ kind: "unavailable", pointer });
    expect(caches.named.has(buildCache("v1"))).toBe(false);

    const other = { ...pointer, archive: { ...pointer.archive, sha256: "b".repeat(64) } };
    await expect(store.put(other, blob)).rejects.toThrow(/conflicting/i);
    await store.put(pointer, blob);
    expect(await store.complete("v1", pointer)).toBe(true);
  });

  it("fails closed on a malformed marker or stored index", async () => {
    const { caches, store } = setup();
    const { blob, pointer } = archiveOf();
    await store.put(pointer, blob);
    const cache = caches.named.get(buildCache("v1"))!;
    const original = cache.entries.get(BODY_KEY)!;
    cache.entries.set(
      BODY_KEY,
      new Response(new Uint8Array(blob.size), { headers: original.headers }),
    );
    expect(await store.read("v1")).toEqual({ kind: "unavailable", pointer });

    caches.named.get(RECORDS)!.entries.set(markerKey("v1"), new Response("{"));
    expect(await store.read("v1")).toEqual({ kind: "unavailable" });
    expect(await store.complete("v1")).toBe(false);
  });

  it("reclaims stale archive versions and retains active, staged, pinned, and live versions", async () => {
    const { caches, legacy, store } = setup();
    for (const version of ["active", "staged", "pinned", "live", "stale", "body-lost"]) {
      const { blob, pointer } = archiveOf(version);
      // eslint-disable-next-line no-await-in-loop -- build-state transactions are sequential.
      await store.put(pointer, blob);
    }
    await caches.delete(buildCache("body-lost"));
    await legacy.setActive("active");
    await legacy.setStaged("staged");
    await legacy.writePin("client", "pinned");
    expect(await legacy.reclaim(["live"])).toEqual([buildCache("stale")]);
    const records = caches.named.get(RECORDS)!;
    for (const version of ["active", "staged", "pinned", "live"]) {
      expect(records.entries.has(markerKey(version))).toBe(true);
      expect(caches.named.has(buildCache(version))).toBe(true);
    }
    expect(records.entries.has(markerKey("stale"))).toBe(false);
    expect(records.entries.has(markerKey("body-lost"))).toBe(false);
  });
});
