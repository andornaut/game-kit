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

// A cache that holds text bodies by path.
class FakeCache {
  readonly bodies = new Map<string, Response>();

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

// The Request the worker builds, keeping the priority it asks for, which Node's Request drops.
class PrioritizedRequest extends Request {
  readonly priorityHint: RequestPriority | undefined;

  constructor(input: string, init?: RequestInit) {
    super(new URL(input, ORIGIN), init);
    this.priorityHint = init?.priority;
  }
}

// Serves files to the worker's fetch. A path in failures throws a network error for that many
// fetches, or for every fetch; a path in statuses answers with that status instead of its file.
class FakeServer {
  readonly failures = new Map<string, number | "always">();
  readonly fetched: string[] = [];
  inFlight = 0;
  maxInFlight = 0;
  readonly priorities: (RequestPriority | undefined)[] = [];
  readonly statuses = new Map<string, number>();

  constructor(readonly files: Readonly<Record<string, string>>) {}

  async fetch(request: Request): Promise<Response> {
    const path = pathOf(request);
    this.fetched.push(path);
    this.priorities.push((request as PrioritizedRequest).priorityHint);
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      await Promise.resolve();
      const failures = this.failures.get(path) ?? 0;
      if (failures === "always" || failures > 0) {
        if (failures !== "always") {
          this.failures.set(path, failures - 1);
        }
        throw new TypeError(`Failed to fetch ${path}`);
      }
      return new Response(this.files[path] ?? "", { status: this.statuses.get(path) ?? 200 });
    } finally {
      this.inFlight -= 1;
    }
  }
}

class FakeCaches {
  readonly named = new Map<string, FakeCache>();

  delete(name: string): Promise<boolean> {
    return Promise.resolve(this.named.delete(name));
  }

  keys(): Promise<string[]> {
    return Promise.resolve([...this.named.keys()]);
  }

  open(name: string): Promise<FakeCache> {
    const cache = this.named.get(name) ?? new FakeCache();
    this.named.set(name, cache);
    return Promise.resolve(cache);
  }

  // Seeds a cache an earlier version, or an earlier attempt, left.
  seed(name: string, files: Readonly<Record<string, string>>): void {
    const cache = new FakeCache();
    for (const [path, text] of Object.entries(files)) {
      cache.bodies.set(path, new Response(text, { status: 200 }));
    }
    this.named.set(name, cache);
  }
}

interface WorkerEvent {
  readonly request?: Request;
  respondWith?(response: Promise<Response>): void;
  waitUntil(promise: Promise<unknown>): void;
}

type Listener = (event: WorkerEvent) => void;

// A same-origin GET for path, as a navigation where navigate is set. Node's Request refuses the
// navigate mode, so it is set on the instance.
function requestFor(path: string, navigate = false): Request {
  const request = new Request(path);
  if (navigate) {
    Object.defineProperty(request, "mode", { value: "navigate" });
  }
  return request;
}

// Runs the worker for manifest over server and seeded caches in storage, and returns its
// lifecycle steps.
function startWorker(
  server: FakeServer,
  seeded: Readonly<Record<string, Readonly<Record<string, string>>>>,
  manifest: PrecacheManifest,
  storage = new FakeCaches(),
) {
  for (const [name, files] of Object.entries(seeded)) {
    storage.seed(name, files);
  }
  const listeners = new Map<string, Listener>();
  vi.stubGlobal("caches", storage);
  vi.stubGlobal("fetch", (request: Request) => server.fetch(request));
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
  // The worker's answer to request, or undefined where it leaves the request to the browser.
  const respond = async (request: Request): Promise<string | undefined> => {
    let answer: Promise<Response> | undefined;
    listeners.get("fetch")?.({
      request,
      respondWith: (response) => (answer = response),
      waitUntil: () => undefined,
    });
    return answer === undefined ? undefined : (await answer).text();
  };
  return {
    activate: () => dispatch("activate"),
    install: () => dispatch("install"),
    respond,
    storage,
  };
}

// Settles promise under fake timers, advancing them until it does, and returns it.
async function withTimersRun(promise: Promise<unknown>): Promise<unknown> {
  let settled = false;
  const watched = promise.then(
    () => (settled = true),
    () => (settled = true),
  );
  // Each step lets the pending backoff waits and the work after them run.
  const advance = async (): Promise<void> => {
    if (!settled) {
      await vi.advanceTimersByTimeAsync(1000);
      await advance();
    }
  };
  await advance();
  await watched;
  return promise;
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

const without = (path: string, files: Readonly<Record<string, string>>) =>
  Object.fromEntries(Object.entries(files).filter(([other]) => other !== path));

const OLD = cacheNameFor(POLICY, "v1");
const NEW = cacheNameFor(POLICY, "v2");

describe("runServiceWorker's install", () => {
  beforeEach(() => {
    // The worker resolves relative URLs against its own location, as a browser does.
    vi.stubGlobal("Request", PrioritizedRequest);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
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

  it("fetches at most four files at once, each at low priority", async () => {
    const files = Object.fromEntries(
      Array.from({ length: 10 }, (_, index) => [`/art/${index}.png`, `art ${index}`]),
    );
    const server = new FakeServer(files);
    const { install, storage } = startWorker(server, {}, { ...MANIFEST, urls: Object.keys(files) });
    await install();
    expect(server.maxInFlight).toBe(4);
    expect(server.priorities).toEqual(Array.from({ length: 10 }, () => "low"));
    expect(await storage.named.get(NEW)?.texts()).toEqual(files);
  });

  it("keeps what a failed attempt stored, and the next attempt fetches only what is missing", async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const storage = new FakeCaches();
    const first = new FakeServer(FILES);
    first.failures.set("/art/new.png", "always");
    await expect(
      withTimersRun(startWorker(first, {}, MANIFEST, storage).install()),
    ).rejects.toThrow("/art/new.png");
    expect(error).toHaveBeenCalledTimes(1);
    expect(await storage.named.get(NEW)?.texts()).toEqual(without("/art/new.png", FILES));
    const second = new FakeServer(FILES);
    await startWorker(second, {}, MANIFEST, storage).install();
    expect(second.fetched).toEqual(["/art/new.png"]);
    expect(await storage.named.get(NEW)?.texts()).toEqual(FILES);
  });

  it("refetches a file an earlier attempt stored only where its bytes lack the recorded hash", async () => {
    const server = new FakeServer(FILES);
    const { install, storage } = startWorker(
      server,
      {
        [NEW]: {
          "/art/new.png": "new",
          "/art/same.png": "same, truncated",
          "/art/unrecorded.json": "unrecorded",
          "/assets/main-new.js": "main v2",
        },
      },
      MANIFEST,
    );
    await install();
    expect(server.fetched.sort()).toEqual([
      "/art/changed.png",
      "/art/same.png",
      "/assets/shared-abc.js",
      "/play/",
    ]);
    expect(await storage.named.get(NEW)?.texts()).toEqual(FILES);
  });

  it("retries a failed fetch after a backoff, up to three attempts", async () => {
    vi.useFakeTimers();
    const server = new FakeServer(FILES);
    server.failures.set("/play/", 2);
    const { install, storage } = startWorker(server, {}, { ...MANIFEST, urls: ["/play/"] });
    const done = install();
    await vi.advanceTimersByTimeAsync(999);
    expect(server.fetched).toEqual(["/play/"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(server.fetched).toEqual(["/play/", "/play/"]);
    await vi.advanceTimersByTimeAsync(2999);
    expect(server.fetched).toEqual(["/play/", "/play/"]);
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(server.fetched).toEqual(["/play/", "/play/", "/play/"]);
    expect(await storage.named.get(NEW)?.texts()).toEqual({ "/play/": "page v2" });
  });

  it("stores every other file, logs the failed one and rejects when a file always fails", async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const server = new FakeServer(FILES);
    server.failures.set("/art/same.png", "always");
    const { install, storage } = startWorker(server, {}, MANIFEST);
    await expect(withTimersRun(install())).rejects.toThrow(
      "Precache failed for 1 of 7 files: /art/same.png",
    );
    expect(server.fetched.filter((path) => path === "/art/same.png")).toHaveLength(3);
    expect(await storage.named.get(NEW)?.texts()).toEqual(without("/art/same.png", FILES));
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]?.[0]).toContain("/art/same.png");
    expect(String(error.mock.calls[0]?.[1])).toContain("Failed to fetch /art/same.png");
  });

  it("names the first ten failed files and counts the rest", async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const urls = Array.from(
      { length: 12 },
      (_, index) => `/art/${String(index).padStart(2, "0")}.png`,
    );
    const server = new FakeServer({});
    for (const url of urls) {
      server.failures.set(url, "always");
    }
    const { install } = startWorker(server, {}, { ...MANIFEST, urls });
    await expect(withTimersRun(install())).rejects.toThrow(
      `Precache failed for 12 of 12 files: ${urls.slice(0, 10).join(", ")} and 2 more`,
    );
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("retries bytes that lack the recorded content hash, then fails without storing them", async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const server = new FakeServer({ ...FILES, "/art/same.png": "same, a newer deploy" });
    const { install, storage } = startWorker(server, {}, MANIFEST);
    await expect(withTimersRun(install())).rejects.toThrow(
      "Precache failed for 1 of 7 files: /art/same.png",
    );
    expect(server.fetched.filter((path) => path === "/art/same.png")).toHaveLength(3);
    expect(String(error.mock.calls[0]?.[1])).toContain(
      `Content hash ${hashOf("same, a newer deploy")} for /art/same.png, expected ${hashOf("same")}`,
    );
    expect(await storage.named.get(NEW)?.texts()).toEqual(without("/art/same.png", FILES));
  });

  it("stores bytes that gain the recorded content hash on a later attempt", async () => {
    vi.useFakeTimers();
    const files: Record<string, string> = { ...FILES, "/play/": "page v3" };
    const server = new FakeServer(files);
    const fetchFile = server.fetch.bind(server);
    vi.spyOn(server, "fetch").mockImplementation(async (request) => {
      const response = await fetchFile(request);
      files["/play/"] = FILES["/play/"];
      return response;
    });
    const { install, storage } = startWorker(server, {}, { ...MANIFEST, urls: ["/play/"] });
    await withTimersRun(install());
    expect(server.fetched).toEqual(["/play/", "/play/"]);
    expect(await storage.named.get(NEW)?.texts()).toEqual({ "/play/": "page v2" });
  });

  it("counts a response that is not ok as a failed attempt", async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const server = new FakeServer(FILES);
    server.statuses.set("/art/new.png", 404);
    const { install, storage } = startWorker(server, {}, MANIFEST);
    await expect(withTimersRun(install())).rejects.toThrow("/art/new.png");
    expect(String(error.mock.calls[0]?.[1])).toContain("HTTP 404 for /art/new.png");
    expect(server.fetched.filter((path) => path === "/art/new.png")).toHaveLength(3);
    expect(await storage.named.get(NEW)?.texts()).toEqual(without("/art/new.png", FILES));
  });
});

describe("runServiceWorker's fetch", () => {
  beforeEach(() => {
    vi.stubGlobal("Request", PrioritizedRequest);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // The installed version's files, which the network has since replaced with a newer deploy's.
  const INSTALLED = {
    "/art/same.png": "same v1",
    "/art/unrecorded.json": "unrecorded v1",
    "/play/": "page v1",
  };

  it.each([
    ["the precached page", "/play/", true, "page v1"],
    ["the precached page at its other path", "/play/index.html", true, "page v1"],
    ["an unhashed file with a recorded hash", "/art/same.png", false, "same v1"],
    ["an unhashed file with no recorded hash", "/art/unrecorded.json", false, "unrecorded v1"],
  ])("answers %s from this version's cache without fetching", async (_, path, navigate, text) => {
    const server = new FakeServer(FILES);
    const { respond } = startWorker(server, { [NEW]: INSTALLED }, MANIFEST);
    expect(await respond(requestFor(path, navigate))).toBe(text);
    expect(server.fetched).toEqual([]);
  });

  it("fetches and stores a precached file the cache lacks", async () => {
    const server = new FakeServer(FILES);
    const { respond, storage } = startWorker(server, { [NEW]: INSTALLED }, MANIFEST);
    expect(await respond(requestFor("/art/new.png"))).toBe("new");
    expect(server.fetched).toEqual(["/art/new.png"]);
    expect(await storage.named.get(NEW)?.texts()).toEqual({ ...INSTALLED, "/art/new.png": "new" });
  });

  // Built in the test, once Request resolves paths against the worker's origin.
  it.each<[string, () => Request]>([
    ["a file outside the precache", () => requestFor("/art/notes.json")],
    ["a navigation outside the precache", () => requestFor("/", true)],
    ["a precached file posted to", () => new Request("/play/", { body: "x", method: "POST" })],
  ])("leaves %s to the network", async (_, request) => {
    const server = new FakeServer(FILES);
    const { respond } = startWorker(server, { [NEW]: INSTALLED }, MANIFEST);
    expect(await respond(request())).toBeUndefined();
  });
});
