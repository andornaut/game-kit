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

  delete(key: Request | string): Promise<boolean> {
    return Promise.resolve(this.bodies.delete(pathOf(key)));
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

// The Request the worker builds, keeping the priority it asks for, which Node's Request drops.
class PrioritizedRequest extends Request {
  readonly priorityHint: RequestPriority | undefined;

  constructor(input: string, init?: RequestInit) {
    super(new URL(input, ORIGIN), init);
    this.priorityHint = init?.priority;
  }
}

// Serves files to the worker's fetch. A path in failures throws a network error for that many
// fetches, or for every fetch; a path in statuses answers with that status instead of its file; a
// path in stalls never answers that many fetches until the request is aborted.
class FakeServer {
  readonly failures = new Map<string, number | "always">();
  readonly stalls = new Map<string, number>();
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
      const stalls = this.stalls.get(path) ?? 0;
      if (stalls > 0) {
        this.stalls.set(path, stalls - 1);
        await new Promise((_, reject) => {
          request.signal.addEventListener("abort", () => reject(request.signal.reason as Error));
        });
      }
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
  readonly clientId?: string;
  readonly resultingClientId?: string;
  readonly data?: unknown;
  readonly source?: unknown;
  readonly ports?: readonly { postMessage(value: unknown): void }[];
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
  clients: { id: string }[] = [],
  outgoing:
    | "capable"
    | "legacy"
    | { postMessage(message: unknown, ports: Transferable[]): void } = "capable",
) {
  for (const [name, files] of Object.entries(seeded)) {
    storage.seed(name, files);
  }
  const listeners = new Map<string, Listener>();
  vi.stubGlobal("caches", storage);
  vi.stubGlobal("fetch", (request: Request) => server.fetch(request));
  const skipWaiting = vi.fn(() => Promise.resolve());
  vi.stubGlobal("self", {
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    clients: { matchAll: () => Promise.resolve(clients) },
    location: { href: `${ORIGIN}/sw.js?sound=ogg`, origin: ORIGIN },
    registration: {
      active:
        typeof outgoing === "string"
          ? {
              postMessage: (_message: unknown, ports: MessagePort[]) => {
                if (outgoing === "capable") {
                  ports[0]?.postMessage(true);
                }
              },
            }
          : outgoing,
    },
    skipWaiting,
  });
  runServiceWorker(POLICY, manifest);
  const dispatch = async (type: string) => {
    let done: Promise<unknown> = Promise.resolve();
    listeners.get(type)?.({ waitUntil: (promise) => (done = promise) });
    await done;
  };
  // The worker's answer to request, or undefined where it leaves the request to the browser.
  const respond = async (
    request: Request,
    clientId = "",
    resultingClientId = "",
  ): Promise<string | undefined> => {
    let answer: Promise<Response> | undefined;
    listeners.get("fetch")?.({
      clientId,
      request,
      respondWith: (response) => (answer = response),
      resultingClientId,
      waitUntil: () => undefined,
    });
    return answer === undefined ? undefined : (await answer).text();
  };
  return {
    activate: () => dispatch("activate"),
    clients,
    install: () => dispatch("install"),
    nativeWorker: {
      postMessage: (data: unknown, ports: Transferable[]) => {
        listeners.get("message")?.({
          data,
          ports: ports as MessagePort[],
          waitUntil: () => undefined,
        });
      },
    },
    requestActivation: async (requester: string, deadline = Date.now() + 10_000) => {
      const replies: unknown[] = [];
      let done = Promise.resolve<unknown>(undefined);
      listeners.get("message")?.({
        data: { deadline, type: "skip-waiting" },
        ports: [{ postMessage: (value) => replies.push(value) }],
        source: { id: requester },
        waitUntil: (promise) => {
          done = promise;
        },
      });
      await done;
      return replies;
    },
    respond,
    sendLegacyAccept: () => {
      const reply = vi.fn();
      listeners.get("message")?.({
        data: "skip-waiting",
        ports: [],
        source: { id: "legacy-requester", postMessage: reply },
        waitUntil: () => undefined,
      });
      return reply;
    },
    skipWaiting,
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
    expect([...storage.named.keys()]).toEqual([OLD, NEW, "game-kit-routing:game-"]);
    await activate();
    expect([...storage.named.keys()]).toEqual([NEW, "game-kit-routing:game-"]);
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

  it("aborts an attempt that has not answered after 30 s and retries it", async () => {
    vi.useFakeTimers();
    const server = new FakeServer(FILES);
    server.stalls.set("/play/", 1);
    const { install, storage } = startWorker(server, {}, { ...MANIFEST, urls: ["/play/"] });
    const done = install();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(server.fetched).toEqual(["/play/"]);
    await vi.advanceTimersByTimeAsync(1 + 1000);
    await done;
    expect(server.fetched).toEqual(["/play/", "/play/"]);
    expect(await storage.named.get(NEW)?.texts()).toEqual({ "/play/": "page v2" });
  });

  it("rejects the install when a file never answers, so its bar ends", async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const server = new FakeServer(FILES);
    server.stalls.set("/play/", 3);
    const { install } = startWorker(server, {}, { ...MANIFEST, urls: ["/play/"] });
    const done = expect(install()).rejects.toThrow("Precache failed for 1 of 1 files: /play/");
    await vi.advanceTimersByTimeAsync(3 * 30_000 + 1000 + 3000);
    await done;
    expect(server.fetched).toEqual(["/play/", "/play/", "/play/"]);
    expect(String(error.mock.calls[0]?.[1])).toContain("No answer within 30000 ms for");
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
    const { respond } = startWorker(
      server,
      { [NEW]: INSTALLED },
      {
        ...MANIFEST,
        contentHashes: Object.fromEntries(
          Object.entries(INSTALLED).map(([key, text]) => [key, hashOf(text)]),
        ),
        urls: Object.keys(INSTALLED),
      },
    );
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

  it.each([
    ["/art/new.png", false],
    ["/play/index.html", true],
  ])("rejects newer deploy bytes on an active-cache miss for %s", async (path, navigate) => {
    const files: Record<string, string> = { ...FILES };
    const server = new FakeServer(files);
    const worker = startWorker(server, {}, MANIFEST);
    await worker.install();
    await worker.activate();
    const key = path === "/play/index.html" ? "/play/" : path;
    worker.storage.named.get(NEW)?.bodies.delete(key);
    files[key] = "bytes from a newer deploy";
    await expect(worker.respond(requestFor(path, navigate))).rejects.toThrow("active build");
    expect(worker.storage.named.get(NEW)?.bodies.has(key)).toBe(false);
  });

  it("rejects wrong miss bytes even when the cache write would fail", async () => {
    const server = new FakeServer({ ...FILES, "/art/new.png": "art v3" });
    const { respond, storage } = startWorker(server, { [NEW]: {} }, MANIFEST);
    const cache = storage.named.get(NEW);
    if (cache === undefined) {
      throw new Error("Missing cache");
    }
    const put = vi.spyOn(cache, "put").mockRejectedValue(new Error("quota"));
    await expect(respond(requestFor("/art/new.png"))).rejects.toThrow("active build");
    expect(put).not.toHaveBeenCalled();
    put.mockRestore();
  });

  it("answers verified miss bytes even when the cache write fails", async () => {
    const { respond, storage } = startWorker(new FakeServer(FILES), { [NEW]: {} }, MANIFEST);
    const cache = storage.named.get(NEW);
    if (cache === undefined) {
      throw new Error("Missing cache");
    }
    const put = vi.spyOn(cache, "put").mockRejectedValue(new Error("quota"));
    expect(await respond(requestFor("/art/new.png"))).toBe("new");
    expect(await cache.texts()).toEqual({});
    put.mockRestore();
  });

  // Built in the test, once Request resolves paths against the worker's origin.
  it.each<[string, () => Request]>([
    ["a file outside the precache", () => requestFor("/art/notes.json")],
    ["a navigation outside the precache", () => requestFor("/", true)],
    ["a precached file posted to", () => new Request("/play/", { body: "x", method: "POST" })],
  ])("leaves %s to the network", async (_, request) => {
    const server = new FakeServer(FILES);
    const { respond } = startWorker(server, { [NEW]: INSTALLED }, MANIFEST);
    const input = request();
    expect(await respond(input)).toBe(
      input.method === "POST"
        ? undefined
        : ((FILES as Record<string, string>)[pathOf(input)] ?? ""),
    );
  });
});

describe("document build pins", () => {
  beforeEach(() => vi.stubGlobal("Request", PrioritizedRequest));
  afterEach(() => vi.unstubAllGlobals());

  const firstFiles = {
    "/art/card.json": "manifest A",
    "/art/card.png": "art A",
    "/play/": "page A",
  };
  const secondFiles = {
    "/art/card.json": "manifest B",
    "/art/card.png": "art B",
    "/play/": "page B",
  };
  const manifestFor = (version: string, files: Record<string, string>): PrecacheManifest => ({
    contentHashes: Object.fromEntries(
      Object.entries(files).map(([path, text]) => [path, hashOf(text)]),
    ),
    sounds: {},
    urls: Object.keys(files),
    version,
  });

  it("pins before returning HTML, retains A through B activation, and assigns B to reload", async () => {
    const storage = new FakeCaches();
    const clients = [{ id: "old-document" }, { id: "fresh-launch" }];
    const first = startWorker(
      new FakeServer(firstFiles),
      {},
      manifestFor("a", firstFiles),
      storage,
      clients,
    );
    await first.install();
    expect(await first.respond(requestFor("/play/", true), "", "old-document")).toBe("page A");
    const routing = storage.named.get("game-kit-routing:game-");
    expect(
      await routing?.bodies.get("/.game-kit-routing/client/old-document")?.clone().json(),
    ).toBe("game-a");
    const second = startWorker(
      new FakeServer(secondFiles),
      {},
      manifestFor("b", secondFiles),
      storage,
      clients,
    );
    await second.install();
    expect(await second.requestActivation("fresh-launch")).toEqual(["activating"]);
    expect(second.skipWaiting).toHaveBeenCalledOnce();
    await second.activate();
    expect(storage.named.has("game-a")).toBe(true);
    expect(await second.respond(requestFor("/art/card.json"), "old-document")).toBe("manifest A");
    expect(await second.respond(requestFor("/art/card.png"), "old-document")).toBe("art A");
    expect(
      await second.respond(requestFor("/play/", true), "fresh-launch", "reloaded-document"),
    ).toBe("page B");
    expect(await second.respond(requestFor("/art/card.json"), "reloaded-document")).toBe(
      "manifest B",
    );
    expect(await second.respond(requestFor("/art/card.png"), "reloaded-document")).toBe("art B");
    storage.named.get("game-a")?.bodies.delete("/art/card.png");
    await expect(second.respond(requestFor("/art/card.png"), "old-document")).rejects.toThrow(
      "active build",
    );
  });

  it("refuses activation with an unpinned legacy peer and preserves its cache", async () => {
    const worker = startWorker(
      new FakeServer(secondFiles),
      { [OLD]: firstFiles },
      manifestFor("b", secondFiles),
      new FakeCaches(),
      [{ id: "legacy" }, { id: "requester" }],
    );
    await worker.install();
    expect(await worker.requestActivation("requester")).toEqual(["blocked"]);
    expect(worker.skipWaiting).not.toHaveBeenCalled();
    await worker.activate();
    expect(worker.storage.named.has(OLD)).toBe(true);
  });

  it("ignores a legacy string accept without activating or replying to immutable old code", async () => {
    const worker = startWorker(new FakeServer(secondFiles), {}, manifestFor("b", secondFiles));
    await worker.install();
    const reply = worker.sendLegacyAccept();
    expect(worker.skipWaiting).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });

  it("allows a lone unpinned requester behind a capable worker, but rejects incomplete stages and expiry", async () => {
    const worker = startWorker(
      new FakeServer(secondFiles),
      {},
      manifestFor("b", secondFiles),
      new FakeCaches(),
      [{ id: "requester" }],
    );
    await worker.install();
    expect(await worker.requestActivation("requester", Date.now() - 1)).toEqual(["blocked"]);
    worker.storage.named.get("game-b")?.bodies.delete("/art/card.png");
    expect(await worker.requestActivation("requester")).toEqual(["blocked"]);
    expect(worker.skipWaiting).not.toHaveBeenCalled();
    worker.storage.named.get("game-b")?.bodies.set("/art/card.png", new Response("art B"));
    expect(await worker.requestActivation("requester")).toEqual(["activating"]);
  });

  it("fails closed for missing pins and metadata errors", async () => {
    const worker = startWorker(
      new FakeServer(secondFiles),
      {},
      manifestFor("b", secondFiles),
      new FakeCaches(),
      [{ id: "peer" }],
    );
    await worker.install();
    await expect(worker.respond(requestFor("/art/card.png"), "unknown")).rejects.toThrow(
      "Missing document build pin",
    );
    const records = worker.storage.named.get("game-kit-routing:game-");
    if (records === undefined) {
      throw new Error("Missing routing records");
    }
    const match = vi.spyOn(records, "match").mockRejectedValue(new Error("storage unavailable"));
    expect(await worker.requestActivation("requester")).toEqual(["blocked"]);
    await worker.activate();
    expect(worker.skipWaiting).not.toHaveBeenCalled();
    match.mockRestore();
  });

  it("records a network-only navigation before passing its document's subresources through", async () => {
    const server = new FakeServer({ "/tuning/": "tuning page", "/tuning/editor.js": "editor" });
    const worker = startWorker(server, {}, manifestFor("b", secondFiles));
    expect(await worker.respond(requestFor("/tuning/", true), "", "non-game")).toBe("tuning page");
    expect(await worker.respond(requestFor("/tuning/editor.js"), "non-game")).toBe("editor");
    expect(server.fetched).toEqual(["/tuning/", "/tuning/editor.js"]);
    expect(
      await worker.storage.named
        .get("game-kit-routing:game-")
        ?.match("/.game-kit-routing/client/non-game")
        .then((response) => response?.json()),
    ).toBeNull();
  });

  it("refuses unknown documents even for URLs absent from every recorded manifest", async () => {
    const server = new FakeServer({ "/tuning/editor.js": "editor" });
    const worker = startWorker(server, {}, manifestFor("b", secondFiles));
    await expect(worker.respond(requestFor("/tuning/editor.js"), "unknown")).rejects.toThrow(
      "Missing document build pin",
    );
    expect(server.fetched).toEqual([]);
  });

  it("does not serve a non-game navigation if its network-only pin cannot be persisted", async () => {
    const worker = startWorker(
      new FakeServer({ "/tuning/": "tuning page" }),
      {},
      manifestFor("b", secondFiles),
    );
    const records = await worker.storage.open("game-kit-routing:game-");
    const put = vi.spyOn(records, "put").mockRejectedValue(new Error("quota"));
    await expect(worker.respond(requestFor("/tuning/", true), "", "non-game")).rejects.toThrow(
      "quota",
    );
    put.mockRestore();
  });

  it("requires a new navigation after a network-only document's pin is evicted", async () => {
    const server = new FakeServer({ "/tuning/": "tuning page", "/tuning/editor.js": "editor" });
    const worker = startWorker(server, {}, manifestFor("b", secondFiles));
    await worker.respond(requestFor("/tuning/", true), "", "non-game");
    await worker.storage.delete("game-kit-routing:game-");
    server.fetched.length = 0;
    await expect(worker.respond(requestFor("/tuning/editor.js"), "non-game")).rejects.toThrow(
      "Missing document build pin",
    );
    expect(server.fetched).toEqual([]);
    await worker.respond(requestFor("/tuning/", true), "non-game", "new-document");
    expect(await worker.respond(requestFor("/tuning/editor.js"), "new-document")).toBe("editor");
  });

  it("recognises a positively pinned non-game peer without requiring a build manifest for it", async () => {
    const worker = startWorker(
      new FakeServer({ ...secondFiles, "/tuning/": "tuning page" }),
      {},
      manifestFor("b", secondFiles),
      new FakeCaches(),
      [{ id: "non-game" }, { id: "requester" }],
    );
    await worker.install();
    await worker.respond(requestFor("/tuning/", true), "", "non-game");
    expect(await worker.requestActivation("requester")).toEqual(["activating"]);
  });

  it("keeps the requesting running document on A until its reload navigation", async () => {
    const storage = new FakeCaches();
    const clients = [{ id: "requester" }];
    const first = startWorker(
      new FakeServer(firstFiles),
      {},
      manifestFor("a", firstFiles),
      storage,
      clients,
    );
    await first.install();
    await first.respond(requestFor("/play/", true), "", "requester");
    const second = startWorker(
      new FakeServer(secondFiles),
      {},
      manifestFor("b", secondFiles),
      storage,
      clients,
    );
    await second.install();
    expect(await second.requestActivation("requester")).toEqual(["activating"]);
    await second.activate();
    expect(await second.respond(requestFor("/art/card.json"), "requester")).toBe("manifest A");
    expect(await second.respond(requestFor("/art/card.png"), "requester")).toBe("art A");
  });

  it("does not fetch an older build's removed asset when its document pin is missing", async () => {
    const storage = new FakeCaches();
    const first = startWorker(
      new FakeServer(firstFiles),
      {},
      manifestFor("a", firstFiles),
      storage,
    );
    await first.install();
    const server = new FakeServer(secondFiles);
    const nextManifest = manifestFor("b", { "/play/": "page B" });
    const second = startWorker(server, {}, nextManifest, storage);
    await second.install();
    server.fetched.length = 0;
    await expect(second.respond(requestFor("/art/card.png"), "lost-pin")).rejects.toThrow(
      "Missing document build pin",
    );
    expect(server.fetched).toEqual([]);
  });

  it("does not fetch A-only URLs from B after all routing metadata is evicted while A runs", async () => {
    const storage = new FakeCaches();
    const clients = [{ id: "running-A" }];
    const first = startWorker(
      new FakeServer(firstFiles),
      {},
      manifestFor("a", firstFiles),
      storage,
      clients,
    );
    await first.install();
    await first.respond(requestFor("/play/", true), "", "running-A");
    const server = new FakeServer({ ...secondFiles, "/art/card.png": "B bytes for A-only URL" });
    const second = startWorker(
      server,
      {},
      manifestFor("b", { "/play/": "page B" }),
      storage,
      clients,
      first.nativeWorker,
    );
    await second.install();
    expect(await second.requestActivation("running-A")).toEqual(["activating"]);
    await second.activate();
    await storage.delete("game-kit-routing:game-");
    server.fetched.length = 0;
    await expect(second.respond(requestFor("/art/card.png"), "running-A")).rejects.toThrow(
      "Missing document build pin",
    );
    expect(server.fetched).toEqual([]);
  });

  it("reports a skipWaiting rejection instead of acknowledging activation", async () => {
    const worker = startWorker(
      new FakeServer(secondFiles),
      {},
      manifestFor("b", secondFiles),
      new FakeCaches(),
      [{ id: "requester" }],
    );
    await worker.install();
    worker.skipWaiting.mockRejectedValue(new Error("activation rejected"));
    expect(await worker.requestActivation("requester")).toEqual(["blocked"]);
  });

  it("requires the selected sound format without demanding other formats", async () => {
    const files = { ...secondFiles, "/audio/theme.m4a": "m4a", "/audio/theme.ogg": "ogg" };
    const manifest = manifestFor("b", files);
    manifest.urls = Object.keys(secondFiles);
    manifest.sounds = { m4a: ["/audio/theme.m4a"], ogg: ["/audio/theme.ogg"] };
    const worker = startWorker(new FakeServer(files), {}, manifest, new FakeCaches(), [
      { id: "requester" },
    ]);
    await worker.install();
    expect(worker.storage.named.get("game-b")?.bodies.has("/audio/theme.m4a")).toBe(false);
    expect(await worker.requestActivation("requester")).toEqual(["activating"]);
    worker.storage.named.get("game-b")?.bodies.delete("/audio/theme.ogg");
    expect(await worker.requestActivation("requester")).toEqual(["blocked"]);
  });

  it("refuses a legacy outgoing worker even when a new unpinned navigation appears during the request", async () => {
    vi.useFakeTimers();
    try {
      const clients = [{ id: "requester" }];
      const worker = startWorker(
        new FakeServer(secondFiles),
        {},
        manifestFor("b", secondFiles),
        new FakeCaches(),
        clients,
        "legacy",
      );
      await worker.install();
      const switchResult = worker.requestActivation("requester");
      clients.push({ id: "late-legacy-navigation" });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await switchResult).toEqual(["blocked"]);
      expect(worker.skipWaiting).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("verifies routing capability through the actual outgoing worker's handler", async () => {
    const storage = new FakeCaches();
    const clients = [{ id: "requester" }];
    const first = startWorker(
      new FakeServer(firstFiles),
      {},
      manifestFor("a", firstFiles),
      storage,
      clients,
    );
    await first.install();
    await first.respond(requestFor("/play/", true), "", "requester");
    const second = startWorker(
      new FakeServer(secondFiles),
      {},
      manifestFor("b", secondFiles),
      storage,
      clients,
      first.nativeWorker,
    );
    await second.install();
    expect(await second.requestActivation("requester")).toEqual(["activating"]);
  });

  it("selects the complete old build offline when B loses a file before natural activation", async () => {
    const storage = new FakeCaches();
    const first = startWorker(
      new FakeServer(firstFiles),
      {},
      manifestFor("a", firstFiles),
      storage,
    );
    await first.install();
    await first.activate();
    const server = new FakeServer(secondFiles);
    const second = startWorker(server, {}, manifestFor("b", secondFiles), storage);
    await second.install();
    storage.named.get("game-b")?.bodies.delete("/art/card.png");
    await second.activate();
    server.fetched.length = 0;
    server.failures.set("/play/", "always");
    server.failures.set("/art/card.png", "always");
    expect(storage.named.has("game-a")).toBe(true);
    expect(await second.respond(requestFor("/play/", true), "", "fallback-document")).toBe(
      "page A",
    );
    expect(await second.respond(requestFor("/art/card.json"), "fallback-document")).toBe(
      "manifest A",
    );
    expect(await second.respond(requestFor("/art/card.png"), "fallback-document")).toBe("art A");
    expect(server.fetched).toEqual([]);
  });

  it("does not serve B when natural activation has no complete cached build", async () => {
    const worker = startWorker(new FakeServer(secondFiles), {}, manifestFor("b", secondFiles));
    await worker.install();
    worker.storage.named.get("game-b")?.bodies.delete("/art/card.png");
    await worker.activate();
    await expect(worker.respond(requestFor("/play/", true), "", "new-document")).rejects.toThrow(
      "No complete cached build",
    );
  });

  it("does not return a navigation response if its pin cannot be stored", async () => {
    const worker = startWorker(new FakeServer(firstFiles), {}, manifestFor("a", firstFiles));
    await worker.install();
    const records = worker.storage.named.get("game-kit-routing:game-");
    if (records === undefined) {
      throw new Error("Missing routing records");
    }
    const put = vi.spyOn(records, "put").mockRejectedValue(new Error("quota"));
    await expect(worker.respond(requestFor("/play/", true), "", "new-document")).rejects.toThrow(
      "quota",
    );
    put.mockRestore();
  });
});
