import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cacheNameFor, type CachePolicy } from "../cachePolicy.ts";
import type { PrecacheManifest } from "../precacheList.ts";
import { runServiceWorker } from "./serviceWorker.ts";

const ORIGIN = "https://game.test";
const POLICY: CachePolicy = { cacheNamePrefix: "game-", hashedAssetPrefix: "/assets/" };

const hashOf = (text: string) => createHash("sha256").update(text).digest("base64url").slice(0, 8);

const pathOf = (key: Request | string) =>
  new URL(key instanceof Request ? key.url : key, ORIGIN).pathname;

// A cache that holds text bodies by path. addAll fetches each request from the server.
class FakeCache {
  readonly bodies = new Map<string, Response>();

  constructor(private readonly server: FakeServer) {}

  addAll(requests: readonly Request[]): Promise<void> {
    for (const request of requests) {
      this.bodies.set(pathOf(request), this.server.fetch(pathOf(request)));
    }
    return Promise.resolve();
  }

  keys(): Promise<Request[]> {
    return Promise.resolve([...this.bodies.keys()].map((path) => new Request(`${ORIGIN}${path}`)));
  }

  match(key: Request | string): Promise<Response | undefined> {
    return Promise.resolve(this.bodies.get(pathOf(key))?.clone());
  }

  put(key: Request | string, response: Response): Promise<void> {
    this.bodies.set(pathOf(key), response);
    return Promise.resolve();
  }

  async texts(): Promise<Record<string, string>> {
    const entries = await Promise.all(
      [...this.bodies].map(
        async ([path, response]) => [path, await response.clone().text()] as const,
      ),
    );
    return Object.fromEntries(entries);
  }
}

class FakeServer {
  readonly fetched: string[] = [];

  constructor(readonly files: Readonly<Record<string, string>>) {}

  fetch(path: string): Response {
    this.fetched.push(path);
    return new Response(this.files[path] ?? "", { status: 200 });
  }
}

class FakeCaches {
  readonly named = new Map<string, FakeCache>();

  constructor(private readonly server: FakeServer) {}

  delete(name: string): Promise<boolean> {
    return Promise.resolve(this.named.delete(name));
  }

  keys(): Promise<string[]> {
    return Promise.resolve([...this.named.keys()]);
  }

  open(name: string): Promise<FakeCache> {
    const cache = this.named.get(name) ?? new FakeCache(this.server);
    this.named.set(name, cache);
    return Promise.resolve(cache);
  }

  // Seeds a cache an earlier version left.
  seed(name: string, files: Readonly<Record<string, string>>): void {
    const cache = new FakeCache(this.server);
    for (const [path, text] of Object.entries(files)) {
      cache.bodies.set(path, new Response(text, { status: 200 }));
    }
    this.named.set(name, cache);
  }
}

type Listener = (event: { waitUntil(promise: Promise<unknown>): void }) => void;

// Runs the worker for manifest over server and earlier caches, and returns its lifecycle steps.
function startWorker(
  server: FakeServer,
  earlier: Readonly<Record<string, Readonly<Record<string, string>>>>,
  manifest: PrecacheManifest,
) {
  const storage = new FakeCaches(server);
  for (const [name, files] of Object.entries(earlier)) {
    storage.seed(name, files);
  }
  const listeners = new Map<string, Listener>();
  vi.stubGlobal("caches", storage);
  vi.stubGlobal("self", {
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    location: { href: `${ORIGIN}/sw.js?sound=ogg`, origin: ORIGIN },
    skipWaiting: () => Promise.resolve(),
  });
  runServiceWorker(POLICY, manifest);
  const dispatch = async (type: string) => {
    let done: Promise<unknown> = Promise.resolve();
    listeners.get(type)?.({ waitUntil: (promise) => (done = promise) });
    await done;
  };
  return { activate: () => dispatch("activate"), install: () => dispatch("install"), storage };
}

const FILES = {
  "/art/changed.png": "changed v2",
  "/art/new.png": "new",
  "/art/same.png": "same",
  "/art/unrecorded.json": "unrecorded",
  "/assets/main-new.js": "main v2",
  "/assets/shared-abc.js": "shared",
  "/play/": "page v2",
};

const MANIFEST: PrecacheManifest = {
  contentHashes: Object.fromEntries(
    Object.entries(FILES)
      .filter(([path]) => !path.startsWith("/assets/") && path !== "/art/unrecorded.json")
      .map(([path, text]) => [path, hashOf(text)]),
  ),
  sounds: {},
  urls: Object.keys(FILES),
  version: "v2",
};

const OLD = cacheNameFor(POLICY, "v1");
const NEW = cacheNameFor(POLICY, "v2");

describe("runServiceWorker's install", () => {
  beforeEach(() => {
    // The worker resolves relative URLs against its own location, as a browser does.
    const NativeRequest = Request;
    vi.stubGlobal(
      "Request",
      class extends NativeRequest {
        constructor(input: string, init?: RequestInit) {
          super(new URL(input, ORIGIN), init);
        }
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches every file on a first install", async () => {
    const server = new FakeServer(FILES);
    const { install, storage } = startWorker(server, {}, MANIFEST);
    await install();
    expect(server.fetched.sort()).toEqual(Object.keys(FILES).sort());
    expect(await storage.named.get(NEW)?.texts()).toEqual(FILES);
  });

  it("copies unchanged files from an earlier cache and fetches only the rest", async () => {
    const server = new FakeServer(FILES);
    const { activate, install, storage } = startWorker(
      server,
      {
        [OLD]: {
          "/art/changed.png": "changed v1",
          "/art/same.png": "same",
          "/art/unrecorded.json": "unrecorded",
          "/assets/main-old.js": "main v1",
          "/assets/shared-abc.js": "shared",
          "/play/": "page v1",
        },
      },
      MANIFEST,
    );
    await install();
    expect(server.fetched.sort()).toEqual([
      "/art/changed.png",
      "/art/new.png",
      "/art/unrecorded.json",
      "/assets/main-new.js",
      "/play/",
    ]);
    expect(await storage.named.get(NEW)?.texts()).toEqual(FILES);
    expect([...storage.named.keys()]).toEqual([OLD, NEW]);
    await activate();
    expect([...storage.named.keys()]).toEqual([NEW]);
  });

  it("copies from whichever earlier cache holds the file's recorded content", async () => {
    const server = new FakeServer(FILES);
    const { install, storage } = startWorker(
      server,
      {
        [cacheNameFor(POLICY, "v0")]: { "/play/": "page v1" },
        [OLD]: { "/play/": "page v2" },
      },
      { ...MANIFEST, urls: ["/play/"] },
    );
    await install();
    expect(server.fetched).toEqual([]);
    expect(await storage.named.get(NEW)?.texts()).toEqual({ "/play/": "page v2" });
  });
});
