import { createHash } from "node:crypto";
import { setImmediate as yieldIO } from "node:timers/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ASSET_GROUPS_MESSAGE, type AssetGroupsResult } from "../assetGroups.ts";
import { cacheNameFor, type CachePolicy } from "../cachePolicy.ts";
import { DOWNLOAD_PROGRESS_MESSAGE, type DownloadProgress } from "../downloadProgress.ts";
import type { PrecacheManifest } from "../precacheList.ts";
import { encodePrecacheManifest, type PrecacheManifestWire } from "../precacheWire.ts";
import { verifiedJsonAliasCachePrefix } from "../verifiedJsonBody.ts";
import { createAssetGroups } from "./assetGroups.ts";
import { runServiceWorker } from "./serviceWorker.ts";

// Storage transactions have separate native IndexedDB coverage. These dispatcher scenarios
// control commit admission to exercise network, pinning and activation interleavings.
const durable = vi.hoisted(() => ({
  barrier: undefined as
    { owner: string; token: string; deadline: number; activating: boolean } | undefined,
  builds: new Map<string, readonly string[]>(),
}));
vi.mock("./groupStore.ts", () => ({
  createGroupStore: () => ({
    close: () => undefined,
    commit: async (build: string, ids: readonly string[], token?: string) => {
      const b = durable.barrier;
      if (
        b !== undefined &&
        (b.activating || b.deadline > Date.now()) &&
        (b.owner !== build || b.token !== token)
      ) {
        return "blocked";
      }
      durable.builds.set(build, [...new Set([...(durable.builds.get(build) ?? []), ...ids])]);
      return "stored";
    },
    finishActivation: async (build: string) => {
      if (durable.barrier?.owner === build) {
        durable.barrier = undefined;
      }
    },
    freeze: async (owner: string, token: string, deadline: number) => {
      if (durable.barrier?.owner === owner && durable.barrier.activating) {
        durable.barrier = { activating: true, deadline, owner, token };
        return { activating: true, snapshot: Object.fromEntries(durable.builds) };
      }
      if (
        durable.barrier !== undefined &&
        (durable.barrier.activating || durable.barrier.deadline > Date.now())
      ) {
        return undefined;
      }
      durable.barrier = { activating: false, deadline, owner, token };
      return { activating: false, snapshot: Object.fromEntries(durable.builds) };
    },
    markActivating: async (token: string) => {
      const b = durable.barrier;
      if (b === undefined || b.token !== token || b.deadline <= Date.now()) {
        return false;
      }
      b.activating = true;
      return true;
    },
    read: async (build: string) => durable.builds.get(build),
    release: async (token: string) => {
      if (durable.barrier?.token === token) {
        durable.barrier = undefined;
      }
    },
    remove: async (build: string) => {
      durable.builds.delete(build);
    },
    snapshot: async () => Object.fromEntries(durable.builds),
  }),
}));

const ORIGIN = "https://game.test";
const POLICY: CachePolicy = { cacheNamePrefix: "game-", hashedAssetPrefix: "/assets/" };

const hashOf = (text: string) => createHash("sha256").update(text).digest("base64url").slice(0, 8);

function virtualNetworkClock(): void {
  vi.useFakeTimers();
  // Real SHA-256, without racing a native crypto thread against simulated network deadlines.
  vi.spyOn(crypto.subtle, "digest").mockImplementation(async (_algorithm, input) => {
    const bytes = ArrayBuffer.isView(input)
      ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
      : new Uint8Array(input);
    return new Uint8Array(createHash("sha256").update(bytes).digest()).buffer;
  });
}

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
    const source = this.bodies.get(pathOf(key));
    const response = source?.clone();
    if (response !== undefined && source!.url !== "") {
      Object.defineProperty(response, "url", { value: source!.url });
    }
    return Promise.resolve(response);
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

  constructor(input: string | Request, init?: RequestInit) {
    super(typeof input === "string" ? new URL(input, ORIGIN) : input, init);
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

  constructor(
    readonly files: Readonly<Record<string, string>>,
    readonly jsonResponses = false,
  ) {}

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
      const response = new Response(this.files[path] ?? "", {
        ...(this.jsonResponses
          ? {
              headers: {
                "content-type": "application/json; charset=utf-8",
                "x-content-type-options": "nosniff",
              },
            }
          : {}),
        status: this.statuses.get(path) ?? 200,
      });
      if (this.jsonResponses) {
        Object.defineProperty(response, "url", { value: request.url });
      }
      return response;
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
  readonly ports?: readonly {
    addEventListener?(type: string, listener: () => void): void;
    removeEventListener?(type: string, listener: () => void): void;
    close?(): void;
    postMessage(value: unknown): void;
  }[];
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
  manifest: PrecacheManifest | PrecacheManifestWire,
  storage = new FakeCaches(),
  clients: { id: string }[] = [],
  outgoing:
    | "capable"
    | "legacy"
    | { postMessage(message: unknown, ports: Transferable[]): void } = "capable",
  run: typeof runServiceWorker = runServiceWorker,
) {
  for (const [name, files] of Object.entries(seeded)) {
    storage.seed(name, files);
  }
  const listeners = new Map<string, Listener>();
  const controlled = new Set<string>();
  vi.stubGlobal("caches", storage);
  vi.stubGlobal("fetch", (request: Request) => server.fetch(request));
  const skipWaiting = vi.fn(() => Promise.resolve());
  vi.stubGlobal("self", {
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    clients: {
      matchAll: ({ includeUncontrolled }: { includeUncontrolled: boolean }) =>
        Promise.resolve(clients.filter(({ id }) => includeUncontrolled || controlled.has(id))),
    },
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
  run(POLICY, manifest);
  const dispatch = async (type: string) => {
    let done: Promise<unknown> = Promise.resolve();
    listeners.get(type)?.({ waitUntil: (promise) => (done = promise) });
    await done;
  };
  // The worker's answer to request, or undefined where it leaves the request to the browser.
  const respondResponse = async (
    request: Request,
    clientId = "",
    resultingClientId = "",
  ): Promise<Response | undefined> => {
    let answer: Promise<Response> | undefined;
    listeners.get("fetch")?.({
      clientId,
      request,
      respondWith: (response) => (answer = response),
      resultingClientId,
      waitUntil: () => undefined,
    });
    if (answer === undefined) {
      return undefined;
    }
    const response = await answer;
    if (resultingClientId) {
      controlled.add(resultingClientId);
    }
    return response;
  };
  const respond = async (...args: Parameters<typeof respondResponse>) =>
    (await respondResponse(...args))?.text();
  return {
    activate: () => dispatch("activate"),
    clients,
    controlled,
    groupWorker: {
      postMessage: (data: unknown, ports: Transferable[]) => {
        listeners.get("message")?.({
          data,
          ports: ports as MessagePort[],
          source: { id: "page" },
          waitUntil: () => undefined,
        });
      },
    },
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
    requestGroups: async (
      buildId: string,
      groups: readonly string[],
      requester = "page",
      version?: string,
    ) => {
      const replies: unknown[] = [];
      let done = Promise.resolve<unknown>(undefined);
      listeners.get("message")?.({
        data: {
          buildId,
          groups,
          type: ASSET_GROUPS_MESSAGE,

          ...(version === undefined ? {} : { version }),
        },
        ports: [
          {
            addEventListener: () => undefined,
            close: () => undefined,
            postMessage: (reply) => replies.push(reply),
            removeEventListener: () => undefined,
          },
        ],
        source: { id: requester },
        waitUntil: (promise) => {
          done = promise;
        },
      });
      await done;
      return (replies.at(-1) as { type: "result"; result: AssetGroupsResult }).result;
    },
    respond,
    respondResponse,
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
      // Stream and WebCrypto I/O must settle before advancing the simulated network deadline.
      await yieldIO();
      if (!settled) {
        await vi.advanceTimersByTimeAsync(1000);
      }
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

function collectProgress(worker: ReturnType<typeof startWorker>) {
  const snapshots: DownloadProgress[] = [];
  const close = vi.fn();
  worker.nativeWorker.postMessage({ type: DOWNLOAD_PROGRESS_MESSAGE }, [
    {
      close,
      postMessage: (snapshot: DownloadProgress) => snapshots.push(snapshot),
    } as unknown as MessagePort,
  ]);
  return { close, snapshots };
}

describe("streamed precache progress", () => {
  beforeEach(() => vi.stubGlobal("Request", PrioritizedRequest));
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const manifest = (files: Record<string, string>): PrecacheManifest => ({
    byteSizes: Object.fromEntries(
      Object.entries(files).map(([url, body]) => [url, new TextEncoder().encode(body).byteLength]),
    ),
    contentHashes: Object.fromEntries(
      Object.entries(files).map(([url, body]) => [url, hashOf(body)]),
    ),
    sounds: {},
    urls: Object.keys(files),
    version: "v2",
  });

  it("reports decoded chunks rather than Content-Length and completes only after the build record", async () => {
    const files = { "/file": "abcdefgh" };
    const server = new FakeServer(files);
    let body!: ReadableStreamDefaultController<Uint8Array>;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.spyOn(server, "fetch").mockImplementation(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              body = controller;
              started();
            },
          }),
          { headers: { "Content-Encoding": "gzip", "Content-Length": "2" } },
        ),
    );
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const worker = startWorker(server, {}, manifest(files));
    const { close, snapshots } = collectProgress(worker);
    const install = worker.install();
    await ready;
    now = 100;
    body.enqueue(new TextEncoder().encode("abcd"));
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(snapshots.at(-1)).toMatchObject({ phase: "downloading", value: 0.5 });
    expect(snapshots.some((snapshot) => snapshot.phase === "complete")).toBe(false);
    body.enqueue(new TextEncoder().encode("efgh"));
    body.close();
    await install;
    expect(snapshots.at(-1)).toMatchObject({ phase: "complete", value: 1 });
    expect(
      await worker.storage.named
        .get("game-kit-routing:game-")
        ?.match("/.game-kit-routing/build/game-v2"),
    ).toBeDefined();
    expect(close).toHaveBeenCalledOnce();
    expect(collectProgress(worker).snapshots).toEqual([snapshots.at(-1)]);
  });

  it("excludes verified cache reuse and alternative sound formats from the download", async () => {
    const files = { "/cached": "kept", "/new": "new", "/sound.mp3": "mp3", "/sound.ogg": "ogg" };
    const selected = {
      ...manifest(files),
      sounds: { mp3: ["/sound.mp3"], ogg: ["/sound.ogg", "/sound.ogg"] },
      urls: ["/cached", "/new", "/sound.ogg"],
    };
    const server = new FakeServer(files);
    const worker = startWorker(server, { [NEW]: { "/cached": "kept" } }, selected);
    const { snapshots } = collectProgress(worker);
    await worker.install();
    expect(server.fetched.sort()).toEqual(["/new", "/sound.ogg"]);
    expect(snapshots.at(-1)).toMatchObject({ phase: "complete", value: 1 });
  });

  it("refetches a named cached asset whose recorded byte size is wrong", async () => {
    const files = { "/assets/picture-hash.png": "good" };
    const server = new FakeServer(files);
    const worker = startWorker(
      server,
      { [NEW]: { "/assets/picture-hash.png": "x" } },
      { ...manifest(files), contentHashes: {} },
    );
    await worker.install();
    expect(server.fetched).toEqual(["/assets/picture-hash.png"]);
    expect(await worker.storage.named.get(NEW)?.texts()).toEqual(files);
  });

  it("reports failure rather than readiness when the final durable build record cannot be written", async () => {
    const files = { "/file": "body" };
    const storage = new FakeCaches();
    const records = await storage.open("game-kit-routing:game-");
    vi.spyOn(records, "put").mockRejectedValue(new Error("quota"));
    const worker = startWorker(new FakeServer(files), {}, manifest(files), storage);
    const { snapshots } = collectProgress(worker);
    await expect(worker.install()).rejects.toThrow("quota");
    expect(snapshots.at(-1)).toMatchObject({ phase: "failed", value: undefined });
    expect(snapshots.some((snapshot) => snapshot.phase === "complete")).toBe(false);
  });

  it("keeps legacy manifest progress indeterminate instead of inventing a byte total", async () => {
    const worker = startWorker(new FakeServer(FILES), {}, MANIFEST);
    const { snapshots } = collectProgress(worker);
    await worker.install();
    expect(
      snapshots
        .filter((snapshot) => snapshot.phase !== "complete")
        .every((snapshot) => snapshot.value === undefined),
    ).toBe(true);
    expect(snapshots.at(-1)?.value).toBe(1);
  });

  it("bounds a stalled response body, retries and ends failed without false completion", async () => {
    vi.useFakeTimers();
    const files = { "/file": "body" };
    const server = new FakeServer(files);
    const fetched = vi
      .spyOn(server, "fetch")
      .mockImplementation(async () => new Response(new ReadableStream()));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const worker = startWorker(server, {}, manifest(files));
    const { snapshots } = collectProgress(worker);
    await expect(withTimersRun(worker.install())).rejects.toThrow("Precache failed");
    expect(fetched).toHaveBeenCalledTimes(3);
    expect(snapshots.at(-1)?.phase).toBe("failed");
    expect(snapshots.some((snapshot) => snapshot.phase === "complete")).toBe(false);
  });

  it("does not leave verification pending forever when a cache write stalls", async () => {
    vi.useFakeTimers();
    const files = { "/file": "body" };
    const storage = new FakeCaches();
    const cache = await storage.open(NEW);
    let started!: () => void;
    const nextWrite = () =>
      new Promise<void>((resolve) => {
        started = resolve;
      });
    const put = vi.spyOn(cache, "put").mockImplementation(() => {
      started();
      return new Promise<void>(() => {
        /* The cache write deliberately never settles. */
      });
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const worker = startWorker(new FakeServer(files), {}, manifest(files), storage);
    const { snapshots } = collectProgress(worker);
    const first = nextWrite();
    const failed = expect(worker.install()).rejects.toThrow("Precache failed");
    await first;
    const expireAndRetry = async (delay: number) => {
      const following = nextWrite();
      await vi.advanceTimersByTimeAsync(30_000);
      await vi.advanceTimersByTimeAsync(delay);
      await following;
    };
    await expireAndRetry(1000);
    await expireAndRetry(3000);
    await vi.advanceTimersByTimeAsync(30_000);
    await failed;
    expect(put).toHaveBeenCalledTimes(3);
    expect(snapshots.at(-1)?.phase).toBe("failed");
    expect(snapshots.some((snapshot) => snapshot.phase === "complete")).toBe(false);
  });
});

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
    virtualNetworkClock();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const storage = new FakeCaches();
    const first = new FakeServer(FILES);
    first.failures.set("/art/new.png", "always");
    await expect(
      withTimersRun(startWorker(first, {}, MANIFEST, storage).install()),
    ).rejects.toThrow("/art/new.png");
    expect(error).toHaveBeenCalledTimes(1);
    expect(first.fetched.filter((path) => path === "/art/new.png")).toHaveLength(3);
    expect(first.fetched.filter((path) => path !== "/art/new.png").sort()).toEqual(
      Object.keys(without("/art/new.png", FILES)).sort(),
    );
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
    virtualNetworkClock();
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
    virtualNetworkClock();
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

describe("grouped precache dispatcher", () => {
  const buildId = "a".repeat(40);
  const files = { "/first": "one", "/play/": "page", "/second": "two", "/third": "three" };
  const grouped = (version = "v2", identity = buildId): PrecacheManifest => ({
    buildId: identity,
    byteSizes: Object.fromEntries(Object.entries(files).map(([url, body]) => [url, body.length])),
    contentHashes: Object.fromEntries(
      Object.entries(files).map(([url, body]) => [url, hashOf(body)]),
    ),
    groups: {
      initial: ["first"],
      urls: { first: ["/first"], second: ["/second"], third: ["/third"] },
    },
    sounds: {},
    urls: Object.keys(files),
    version,
  });
  beforeEach(() => {
    durable.builds.clear();
    durable.barrier = undefined;
    vi.stubGlobal("Request", PrioritizedRequest);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("retains compact group successes and semantic durable records across retries and updates", async () => {
    virtualNetworkClock();
    const manifest = grouped("0123456789abcdef");
    const name = cacheNameFor(POLICY, manifest.version);
    const server = new FakeServer(files);
    const worker = startWorker(server, {}, encodePrecacheManifest(manifest), undefined, [
      { id: "page" },
    ]);
    await withTimersRun(worker.install());
    const routing = await worker.storage.open("game-kit-routing:game-");
    const record = await (await routing.match(`/.game-kit-routing/build/${name}`))!.json();
    expect(record.manifest).toEqual(manifest);
    expect(Array.isArray(record.manifest)).toBe(false);
    server.statuses.set("/third", 503);
    await expect(
      withTimersRun(worker.requestGroups(buildId, ["second", "third"])),
    ).resolves.toEqual({ reason: "failed", status: "unavailable" });
    expect(durable.builds.get(name)).toEqual(["first"]);
    const secondFetches = server.fetched.filter((url) => url === "/second").length;
    server.statuses.delete("/third");
    await expect(
      withTimersRun(worker.requestGroups(buildId, ["second", "third"])),
    ).resolves.toMatchObject({ readyGroups: ["first", "second", "third"], status: "available" });
    expect(server.fetched.filter((url) => url === "/second")).toHaveLength(secondFetches);
    const restart = startWorker(server, {}, manifest, worker.storage, [{ id: "page" }]);
    await expect(withTimersRun(restart.requestGroups(buildId, []))).resolves.toMatchObject({
      status: "available",
    });
    (await worker.storage.open(name)).bodies.set("/second", new Response("corrupt"));
    await expect(withTimersRun(restart.requestGroups(buildId, []))).resolves.toEqual({
      reason: "failed",
      status: "unavailable",
    });
    // A compact candidate uses the existing union and activation barrier with semantic pins.
    const nextManifest = grouped("fedcba9876543210", "b".repeat(40));
    const next = startWorker(server, {}, encodePrecacheManifest(nextManifest), worker.storage, [
      { id: "page" },
    ]);
    await withTimersRun(next.install());
    expect(durable.builds.get(cacheNameFor(POLICY, nextManifest.version))).toEqual([
      "first",
      "second",
      "third",
    ]);
    expect(await withTimersRun(next.requestActivation("page"))).toEqual(["activating"]);
    await withTimersRun(next.activate());
  });

  it("rejects malformed compact input before reading worker globals or registering listeners", () => {
    const addEventListener = vi.fn();
    vi.stubGlobal("self", { addEventListener });
    const wire = structuredClone(
      encodePrecacheManifest(grouped("0123456789abcdef")),
    ) as unknown as unknown[];
    wire[0] = 99;
    expect(() => runServiceWorker(POLICY, wire as unknown as PrecacheManifestWire)).toThrow();
    expect(addEventListener).not.toHaveBeenCalled();
  });

  it("preserves base/initial groups, rejects unknown batches and survives a worker restart", async () => {
    const server = new FakeServer(files);
    const worker = startWorker(server, {}, grouped(), undefined, [{ id: "page" }]);
    await worker.install();
    expect(server.fetched.sort()).toEqual(["/first", "/play/"]);
    expect(await worker.requestGroups(buildId, [])).toEqual({
      readyGroups: ["first"],
      status: "available",
      version: "v2",
    });
    const routing = await worker.storage.open("game-kit-routing:game-");
    expect(await (await routing.match("/.game-kit-routing/client/page"))!.json()).toBe(NEW);
    expect(await worker.requestGroups(buildId, ["second", "unknown"])).toEqual({
      status: "invalid-groups",
      unknownGroups: ["unknown"],
    });
    expect(server.fetched).not.toContain("/second");
    const results = await Promise.all([
      worker.requestGroups(buildId, ["second"]),
      worker.requestGroups(buildId, ["second"]),
    ]);
    expect(results).toEqual(
      Array(2).fill({ readyGroups: ["first", "second"], status: "available", version: "v2" }),
    );
    expect(server.fetched.filter((url) => url === "/second")).toHaveLength(1);
    const restart = startWorker(server, {}, grouped(), worker.storage, [{ id: "page" }]);
    server.failures.set("/second", "always");
    expect(await restart.requestGroups(buildId, [])).toMatchObject({
      readyGroups: ["first", "second"],
      status: "available",
    });
    expect(await restart.requestGroups("b".repeat(40), ["third"])).toEqual({
      reason: "wrong-build",
      status: "unavailable",
    });
    expect(await restart.requestGroups(buildId, ["third"], "page", "other-version")).toEqual({
      reason: "wrong-build",
      status: "unavailable",
    });
    await routing.delete("/.game-kit-routing/client/page");
    restart.controlled.add("page");
    expect(await restart.requestGroups(buildId, ["third"], "page", "v2")).toEqual({
      reason: "wrong-build",
      status: "unavailable",
    });
    expect(server.fetched).not.toContain("/third");
  });

  it("keeps a queued native client alive through predecessor chunks and verifies before readiness", async () => {
    const server = new FakeServer(files);
    const worker = startWorker(server, {}, grouped(), undefined, [{ id: "page" }]);
    await worker.install();
    vi.useFakeTimers();
    let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
    const original = server.fetch.bind(server);
    vi.stubGlobal("fetch", (request: Request) =>
      pathOf(request) === "/second"
        ? Promise.resolve(
            new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  stream = controller;
                },
              }),
            ),
          )
        : original(request),
    );
    const firstReports: DownloadProgress[] = [];
    const firstClient = createAssetGroups({
      buildId,
      container: { controller: worker.groupWorker, getRegistration: async () => undefined },
      onDownloadProgress: (snapshot) => firstReports.push(snapshot),
      requestTimeoutMs: 1000,
      timeoutMode: "inactivity",
    });
    const nextClient = createAssetGroups({
      buildId,
      container: { controller: worker.groupWorker, getRegistration: async () => undefined },
      requestTimeoutMs: 1000,
      timeoutMode: "inactivity",
    });
    const first = firstClient.ensureGroups(["second"]);
    await nativeUntil(() => stream !== undefined);
    const second = nextClient.ensureGroups(["third"]);
    let settled = false;
    void second.then(() => {
      settled = true;
    });
    // Let the validated second request enter the same FIFO behind the streaming first job.
    await nativeTurns(10);
    for (const byte of new TextEncoder().encode("two")) {
      // eslint-disable-next-line no-await-in-loop
      await vi.advanceTimersByTimeAsync(700);
      const reports = firstReports.length;
      stream!.enqueue(new Uint8Array([byte]));
      // eslint-disable-next-line no-await-in-loop
      await nativeUntil(() => firstReports.length > reports);
      // eslint-disable-next-line no-await-in-loop
      await nativeTurn();
      expect(settled).toBe(false);
    }
    expect(durable.builds.get(NEW)).not.toContain("second");
    stream!.close();
    await expect(first).resolves.toMatchObject({
      readyGroups: ["first", "second"],
      status: "available",
    });
    await expect(second).resolves.toMatchObject({
      readyGroups: ["first", "second", "third"],
      status: "available",
    });
    expect(worker.skipWaiting).not.toHaveBeenCalled();
    firstClient.dispose();
    nextClient.dispose();
  });

  it("renews on completed cache checks but expires a stalled verification without inventing readiness", async () => {
    const server = new FakeServer(files);
    const worker = startWorker(server, {}, grouped(), undefined, [{ id: "page" }]);
    await worker.install();
    await worker.requestGroups(buildId, ["second", "third"]);
    virtualNetworkClock();
    const cache = await worker.storage.open(NEW);
    const original = cache.match.bind(cache);
    const checks = new Map<string, () => void>();
    const match = vi.spyOn(cache, "match").mockImplementation(async (key) => {
      const response = await original(key);
      return new Promise<Response | undefined>((resolve) => {
        checks.set(pathOf(key), () => resolve(response));
      });
    });
    const client = createAssetGroups({
      buildId,
      container: { controller: worker.groupWorker, getRegistration: async () => undefined },
      requestTimeoutMs: 1000,
      timeoutMode: "inactivity",
    });
    const pending = client.readState();
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await nativeUntil(() => checks.size === 4);
    for (const url of ["/first", "/second", "/third"]) {
      // Each completed body check must be observed before the next inactivity window.
      // eslint-disable-next-line no-await-in-loop
      await vi.advanceTimersByTimeAsync(700);
      checks.get(url)!();
      // eslint-disable-next-line no-await-in-loop
      await nativeTurns(10);
      expect(settled).toBe(false);
    }
    await vi.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toEqual({ reason: "timeout", status: "unavailable" });
    checks.get("/play/")!();
    match.mockRestore();
    await nativeTurns(10);
    // Expiry closes only this client. Verified durable coverage remains available to a retry.
    await expect(client.readState()).resolves.toMatchObject({ status: "available" });
    expect(server.fetched).toHaveLength(4);
    expect(worker.skipWaiting).not.toHaveBeenCalled();
    client.dispose();
  });

  it("expires a stalled FIFO and ignores unrelated fetches and later queued work without canceling it", async () => {
    const server = new FakeServer(files);
    const worker = startWorker(server, {}, grouped(), undefined, [{ id: "page" }]);
    await worker.install();
    vi.useFakeTimers();
    let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
    const original = server.fetch.bind(server);
    vi.stubGlobal("fetch", (request: Request) =>
      pathOf(request) === "/second"
        ? Promise.resolve(
            new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  stream = controller;
                },
              }),
            ),
          )
        : original(request),
    );
    const makeClient = () =>
      createAssetGroups({
        buildId,
        container: { controller: worker.groupWorker, getRegistration: async () => undefined },
        requestTimeoutMs: 1000,
        timeoutMode: "inactivity",
      });
    const firstClient = makeClient(),
      nextClient = makeClient(),
      laterClient = makeClient();
    const first = firstClient.ensureGroups(["second"]);
    await nativeUntil(() => stream !== undefined);
    const second = nextClient.ensureGroups(["third"]);
    await nativeTurns(10);
    await vi.advanceTimersByTimeAsync(700);
    await worker.respond(requestFor("/first"));
    const later = laterClient.readState();
    await nativeTurns(10);
    await vi.advanceTimersByTimeAsync(300);
    await expect(first).resolves.toMatchObject({ reason: "timeout" });
    await expect(second).resolves.toMatchObject({ reason: "timeout" });
    laterClient.dispose();
    await expect(later).resolves.toMatchObject({ reason: "disposed" });
    // Closed clients do not cancel the worker's finite fetch/commit operation.
    stream!.enqueue(new TextEncoder().encode("two"));
    stream!.close();
    await nativeUntil(() => durable.builds.get(NEW)?.includes("third") === true);
    expect(worker.skipWaiting).not.toHaveBeenCalled();
    firstClient.dispose();
    nextClient.dispose();
  });

  it("retains successful files for retry without committing partial groups", async () => {
    const manifest = grouped();
    manifest.groups = {
      initial: ["first"],
      urls: { first: ["/first"], pair: ["/second", "/third"] },
    };
    const server = new FakeServer(files);
    const worker = startWorker(server, {}, manifest, undefined, [{ id: "page" }]);
    await worker.install();
    server.failures.set("/third", "always");
    virtualNetworkClock();
    const failed = worker.requestGroups(buildId, ["pair"]);
    await withTimersRun(failed);
    expect(await failed).toEqual({ reason: "failed", status: "unavailable" });
    expect(durable.builds.get(NEW)).toEqual(["first"]);
    server.failures.clear();
    const retry = worker.requestGroups(buildId, ["pair"]);
    await withTimersRun(retry);
    expect(await retry).toMatchObject({ readyGroups: ["first", "pair"], status: "available" });
    expect(server.fetched.filter((url) => url === "/second")).toHaveLength(1);
    (await worker.storage.open(NEW)).bodies.delete("/third");
    expect(await worker.requestGroups(buildId, [])).toEqual({
      reason: "failed",
      status: "unavailable",
    });
  });

  it("revalidates hashed-name copies against grouped metadata rather than trusting their name", async () => {
    const manifest = grouped();
    manifest.urls.push("/assets/unchanged-name.js");
    manifest.contentHashes["/assets/unchanged-name.js"] = hashOf("correct");
    manifest.byteSizes!["/assets/unchanged-name.js"] = 7;
    const server = new FakeServer({ ...files, "/assets/unchanged-name.js": "correct" });
    const worker = startWorker(
      server,
      { [OLD]: { "/assets/unchanged-name.js": "corrupt" } },
      manifest,
      undefined,
      [{ id: "page" }],
    );
    await worker.install();
    expect(server.fetched).toContain("/assets/unchanged-name.js");
    expect(await worker.respond(requestFor(`${ORIGIN}/assets/unchanged-name.js`))).toBe("correct");
  });

  it("stages the late installed-group union and blocks outgoing commits through native activation", async () => {
    const server = new FakeServer(files);
    const old = startWorker(server, {}, grouped("v1"), undefined, [{ id: "old" }, { id: "page" }]);
    await old.install();
    await old.activate();
    await old.respond(requestFor(`${ORIGIN}/play/`, true), "", "old");
    const nextId = "b".repeat(40);
    const next = startWorker(server, {}, grouped("v2", nextId), old.storage, [
      { id: "old" },
      { id: "page" },
    ]);
    await next.install();
    expect(await old.requestGroups(buildId, ["second"], "old")).toMatchObject({
      status: "available",
    });
    let blocked!: AssetGroupsResult;
    // Force a candidate cache miss so the barrier is observed during the staging operation.
    (await next.storage.open(NEW)).bodies.delete("/second");
    const cache = await next.storage.open(NEW);
    const put = cache.put.bind(cache);
    vi.spyOn(cache, "put").mockImplementation(async (key, response) => {
      if (pathOf(key) === "/second") {
        blocked = await old.requestGroups(buildId, ["third"], "old");
      }
      return put(key, response);
    });
    expect(await next.requestActivation("page")).toEqual(["activating"]);
    expect(blocked).toEqual({ reason: "failed", status: "unavailable" });
    expect(durable.builds.get(OLD)).toEqual(["first", "second"]);
    expect(durable.builds.get(NEW)).toEqual(["first", "second"]);
    expect(durable.barrier?.activating).toBe(true);
    await next.activate();
    expect(durable.barrier).toBeUndefined();
    expect(await next.requestGroups(buildId, [], "old")).toMatchObject({
      readyGroups: ["first", "second"],
      status: "available",
      version: "v1",
    });
    expect(await next.requestGroups(nextId, [], "old")).toEqual({
      reason: "wrong-build",
      status: "unavailable",
    });
  });

  it("includes late groups at client-free activation without a manual switch", async () => {
    const server = new FakeServer(files);
    const old = startWorker(server, {}, grouped("v1"), undefined, [{ id: "page" }]);
    await old.install();
    const next = startWorker(server, {}, grouped("v2", "b".repeat(40)), old.storage, []);
    await next.install();
    expect(await old.requestGroups(buildId, ["second"])).toMatchObject({ status: "available" });
    await next.activate();
    expect(durable.builds.get(NEW)).toEqual(["first", "second"]);
    expect(durable.builds.has(OLD)).toBe(false);
  });
});

describe("explicit verified JSON body reuse", () => {
  beforeEach(() => {
    virtualNetworkClock();
    vi.stubGlobal("Request", PrioritizedRequest);
    durable.builds.clear();
    durable.barrier = undefined;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  const fixture = (counts = [4, 4, 3]) => {
    const files: Record<string, string> = {};
    const verifiedJsonBodies = counts.map((count, index) => {
      const body = JSON.stringify({ values: Array.from({ length: index + 1 }, () => index) });
      const urls = Array.from({ length: count }, (_, item) => `/family-${index}/item-${item}.json`);
      for (const url of urls) {
        files[url] = body;
      }
      return {
        byteSize: Buffer.byteLength(body),
        sha256: createHash("sha256").update(body).digest("hex"),
        urls,
      };
    });
    const manifest: PrecacheManifest = {
      byteSizes: Object.fromEntries(
        Object.entries(files).map(([url, text]) => [url, Buffer.byteLength(text)]),
      ),
      contentHashes: Object.fromEntries(
        Object.entries(files).map(([url, text]) => [url, hashOf(text)]),
      ),
      sounds: {},
      urls: Object.keys(files),
      verifiedJsonBodies,
      version: "reuse",
    };
    return { files, manifest, server: new FakeServer(files, true) };
  };

  it("fetches three representatives for eleven URLs and preserves complete offline coverage", async () => {
    const f = fixture();
    const fetch = f.server.fetch.bind(f.server);
    vi.spyOn(f.server, "fetch").mockImplementation(async (request) => {
      expect(request.credentials).toBe("omit");
      expect(request.redirect).toBe("error");
      const response = await fetch(request);
      response.headers.set("content-encoding", "gzip");
      response.headers.set("content-length", "1");
      return response;
    });
    const worker = startWorker(f.server, {}, f.manifest);
    const { snapshots } = collectProgress(worker);
    await withTimersRun(worker.install());
    expect(f.server.fetched).toHaveLength(3);
    expect(f.server.maxInFlight).toBeLessThanOrEqual(4);
    const cached = worker.storage.named.get("game-reuse")!;
    expect(await cached.texts()).toEqual(f.files);
    await Promise.all(
      f.manifest.verifiedJsonBodies!.map(async (family) => {
        const alias = await cached.match(family.urls[1]!);
        expect(alias?.url).toBe("");
        expect([...alias!.headers]).toEqual([
          ["content-type", "application/json; charset=utf-8"],
          ["x-content-type-options", "nosniff"],
        ]);
      }),
    );
    expect(snapshots.at(-1)).toMatchObject({ phase: "complete", value: 1 });
    await worker.activate();
    await Promise.all(
      Object.entries(f.files).map(async ([url, text]) => {
        expect(await worker.respond(new Request(`${ORIGIN}${url}`))).toBe(text);
      }),
    );
    expect(f.server.fetched).toHaveLength(3);
  });

  it("fully reverifies canonical empty-URL family sources from earlier caches", async () => {
    const f = fixture();
    const storage = new FakeCaches();
    const previous = await storage.open("game-old");
    for (const family of f.manifest.verifiedJsonBodies!) {
      previous.bodies.set(
        family.urls[0]!,
        new Response(f.files[family.urls[0]!]!, {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "x-content-type-options": "nosniff",
          },
        }),
      );
    }
    const worker = startWorker(f.server, {}, f.manifest, storage);
    await withTimersRun(worker.install());
    expect(f.server.fetched).toEqual([]);
    expect(await storage.named.get("game-reuse")!.texts()).toEqual(f.files);
  });

  it("rejects a short-hash collision in cache and rechecks full identity before activation", async () => {
    const f = fixture([2]);
    const full = (text: string) => {
      const bytes = createHash("sha256").update(text).digest();
      bytes.fill(0, 0, 6);
      return bytes;
    };
    vi.spyOn(crypto.subtle, "digest").mockImplementation(async (_algorithm, input) => {
      const bytes = ArrayBuffer.isView(input)
        ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
        : new Uint8Array(input);
      const digest = createHash("sha256").update(bytes).digest();
      digest.fill(0, 0, 6);
      return new Uint8Array(digest).buffer;
    });
    const family = f.manifest.verifiedJsonBodies![0]!;
    f.manifest.verifiedJsonBodies = [
      { ...family, sha256: full(f.files[family.urls[0]!]!).toString("hex") },
    ];
    f.manifest.contentHashes = Object.fromEntries(family.urls.map((url) => [url, "AAAAAAAA"]));
    const storage = new FakeCaches();
    const cache = await storage.open("game-reuse");
    const corrupt = f.files[family.urls[0]!]!.replace("0", "9");
    for (const url of family.urls) {
      cache.bodies.set(
        url,
        new Response(corrupt, {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "x-content-type-options": "nosniff",
          },
        }),
      );
    }
    const worker = startWorker(f.server, {}, f.manifest, storage);
    await withTimersRun(worker.install());
    expect(f.server.fetched).toHaveLength(1);
    expect(await cache.texts()).toEqual(f.files);
    cache.bodies.set(
      family.urls[1]!,
      new Response(corrupt, {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "x-content-type-options": "nosniff",
        },
      }),
    );
    await worker.activate();
    await expect(
      worker.respond(requestFor(family.urls[0]!, true), "", "new-document"),
    ).rejects.toThrow(/complete/);
  });

  it("rejects conflicting full/logical metadata before opening a build cache", () => {
    const f = fixture([2]);
    f.manifest.contentHashes[f.manifest.urls[1]!] = "conflict";
    const storage = new FakeCaches();
    expect(() => startWorker(f.server, {}, f.manifest, storage)).toThrow(/conflicts/);
    expect(storage.named.size).toBe(0);
    expect(f.server.fetched).toEqual([]);
  });

  it("does not commit readiness while a verified alias write is pending", async () => {
    const f = fixture([2]);
    const storage = new FakeCaches();
    const cache = await storage.open("game-reuse");
    const alias = f.manifest.verifiedJsonBodies![0]!.urls[1]!;
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const writing = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const put = cache.put.bind(cache);
    vi.spyOn(cache, "put").mockImplementation(async (key, response) => {
      if (pathOf(key) === alias) {
        entered();
        await gate;
      }
      await put(key, response);
    });
    const worker = startWorker(f.server, {}, f.manifest, storage);
    const { snapshots } = collectProgress(worker);
    const installing = worker.install();
    await writing;
    expect(snapshots.some(({ phase }) => phase === "complete")).toBe(false);
    expect(
      storage.named
        .get("game-kit-routing:game-")
        ?.bodies.has("/.game-kit-routing/build/game-reuse") ?? false,
    ).toBe(false);
    release();
    await installing;
    expect(snapshots.at(-1)?.phase).toBe("complete");
    expect(await cache.texts()).toEqual(f.files);
  });

  it("retains successes after a family 503 and serializes parallel group Retry", async () => {
    const f = fixture();
    f.manifest.buildId = "a".repeat(40);
    f.manifest.groups = { initial: [], urls: { later: [...f.manifest.urls] } };
    const failed = f.manifest.verifiedJsonBodies![1]!.urls[0]!;
    f.server.statuses.set(failed, 503);
    const worker = startWorker(f.server, {}, f.manifest, undefined, [{ id: "page" }]);
    await withTimersRun(worker.install());
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const first = await withTimersRun(worker.requestGroups(f.manifest.buildId, ["later"]));
    expect(first).toEqual({ reason: "failed", status: "unavailable" });
    expect(durable.builds.get("game-reuse")).toEqual([]);
    expect(worker.storage.named.get("game-reuse")!.bodies.size).toBe(7);
    const fetched = f.server.fetched.length;
    f.server.statuses.delete(failed);
    const retry = await withTimersRun(
      Promise.all([
        worker.requestGroups(f.manifest.buildId, ["later"]),
        worker.requestGroups(f.manifest.buildId, ["later"]),
      ]),
    );
    expect(retry).toEqual([
      expect.objectContaining({ status: "available" }),
      expect.objectContaining({ status: "available" }),
    ]);
    expect(f.server.fetched.length - fetched).toBe(1);
    expect(await worker.storage.named.get("game-reuse")!.texts()).toEqual(f.files);
  });

  it.each([
    "header",
    "mime",
    "redirect",
    "origin",
    "partial",
    "size",
    "hash",
    "aborted",
    "private",
    "vary",
    "length",
    "empty-url",
    "full-without-short",
  ])("rejects an invalid body source without alias or readiness commit: %s", async (reason) => {
    const f = fixture([2]);
    if (reason === "full-without-short") {
      f.manifest.contentHashes = {};
    }
    const url = f.manifest.verifiedJsonBodies![0]!.urls[0]!;
    const original = f.server.fetch.bind(f.server);
    if (reason === "aborted") {
      f.server.stalls.set(url, 3);
    }
    vi.spyOn(f.server, "fetch").mockImplementation(async (request) => {
      const response = await original(request);
      if (reason === "aborted") {
        return response;
      }
      const text = f.files[url]!;
      const headers: Record<string, string> = {
        "content-type": "application/json; charset=utf-8",
        "x-content-type-options": "nosniff",
      };
      if (reason === "header") {
        headers["content-location"] = "/other.json";
      }
      if (reason === "mime") {
        headers["content-type"] = "text/plain";
      }
      if (reason === "private") {
        headers["cache-control"] = "private";
      }
      if (reason === "vary") {
        headers.vary = "Accept-Language";
      }
      if (reason === "length") {
        headers["content-length"] = "1";
      }
      const body =
        reason === "size"
          ? `${text} `
          : reason === "hash" || reason === "full-without-short"
            ? text.replace("0", "9")
            : text;
      const changed = new Response(body, { headers, status: reason === "partial" ? 206 : 200 });
      Object.defineProperty(changed, "url", {
        value:
          reason === "origin"
            ? "https://other.test/x.json"
            : reason === "empty-url"
              ? ""
              : request.url,
      });
      if (reason === "redirect") {
        Object.defineProperty(changed, "redirected", { value: true });
      }
      return changed;
    });
    const worker = startWorker(f.server, {}, f.manifest);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(withTimersRun(worker.install())).rejects.toThrow(/Precache failed/);
    expect(worker.storage.named.get("game-reuse")!.bodies.size).toBe(0);
    expect(
      worker.storage.named
        .get("game-kit-routing:game-")
        ?.bodies.has("/.game-kit-routing/build/game-reuse") ?? false,
    ).toBe(false);
  });
});

async function nativeTurn(): Promise<void> {
  const channel = new MessageChannel();
  await new Promise<void>((resolve) => {
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(null);
  });
  channel.port1.close();
  channel.port2.close();
}
async function nativeUntil(predicate: () => boolean): Promise<void> {
  for (let turn = 0; turn < 1000; turn += 1) {
    if (predicate()) {
      return;
    }
    // eslint-disable-next-line no-await-in-loop
    await nativeTurn();
  }
  throw new Error("Native message or stream milestone was not reached");
}

async function nativeTurns(count: number): Promise<void> {
  for (let turn = 0; turn < count; turn += 1) {
    // Native tasks are drained in order without advancing the deadline.
    // eslint-disable-next-line no-await-in-loop
    await nativeTurn();
  }
}

function dataProfileFixture(version = "0123456789abcdef") {
  const files: Record<string, string> = {};
  const verifiedJsonBodies = [4, 4, 3].map((count, index) => {
    const body = JSON.stringify({ sample: index, values: [index, index + 1] });
    const urls = Array.from({ length: count }, (_, item) => `/data-${index}/item-${item}.json`);
    for (const url of urls) {
      files[url] = body;
    }
    return {
      byteSize: Buffer.byteLength(body),
      responseProfile: "fetch-json-data-v1" as const,
      sha256: createHash("sha256").update(body).digest("hex"),
      urls,
    };
  });
  const manifest: PrecacheManifest = {
    buildId: "d".repeat(40),
    byteSizes: Object.fromEntries(
      Object.entries(files).map(([url, body]) => [url, Buffer.byteLength(body)]),
    ),
    contentHashes: Object.fromEntries(
      Object.entries(files).map(([url, body]) => [url, hashOf(body)]),
    ),
    groups: { initial: [], urls: {} },
    sounds: {},
    urls: Object.keys(files),
    verifiedJsonBodies,
    version,
  };
  const server = new FakeServer(files, true);
  const nativeFetch = server.fetch.bind(server);
  vi.spyOn(server, "fetch").mockImplementation(async (request) => {
    const source = await nativeFetch(request);
    const headers = new Headers(source.headers);
    for (const [name, value] of Object.entries({
      "alt-svc": 'h2=":443"',
      "content-encoding": "zstd",
      nel: '{"max_age":1,"report_to":"fixture"}',
      "permissions-policy": "geolocation=()",
      "referrer-policy": "no-referrer",
      "report-to": '{"group":"fixture","max_age":1,"endpoints":[]}',
    })) {
      headers.set(name, value);
    }
    const response = new Response(source.body, { headers, status: source.status });
    Object.defineProperty(response, "url", { value: request.url });
    return response;
  });
  return { files, manifest, server };
}

describe("guarded JSON data response profile", () => {
  beforeEach(() => {
    virtualNetworkClock();
    vi.stubGlobal("Request", PrioritizedRequest);
    durable.builds.clear();
    durable.barrier = undefined;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("isolates eleven data URLs with three GETs and preserves original nondata policies", async () => {
    const f = dataProfileFixture();
    const worker = startWorker(f.server, {}, encodePrecacheManifest(f.manifest), undefined, [
      { id: "page" },
    ]);
    await withTimersRun(worker.install());
    expect(f.server.fetched).toHaveLength(3);
    const aliasName = verifiedJsonAliasCachePrefix(POLICY) + f.manifest.version;
    expect(aliasName.startsWith(POLICY.cacheNamePrefix)).toBe(false);
    const aliases = await worker.storage.open(aliasName);
    expect(aliases.bodies.size).toBe(11);
    const original = await worker.storage.open(cacheNameFor(POLICY, f.manifest.version));
    expect(original.bodies.size).toBe(3);
    const routing = await worker.storage.open("game-kit-routing:game-");
    const record = await (await routing.match(
      `/.game-kit-routing/build/game-${f.manifest.version}`,
    ))!.json();
    expect(record.manifest[0]).toBe(2);
    await expect(worker.requestGroups(f.manifest.buildId!, [])).resolves.toMatchObject({
      status: "available",
    });
    for (const [url, body] of Object.entries(f.files)) {
      // Each result must be consumed before inspecting the next logical URL.
      // eslint-disable-next-line no-await-in-loop
      const response = (await worker.respondResponse(requestFor(url), "page"))!;
      expect(response.url).toBe("");
      expect([...response.headers.keys()].sort()).toEqual([
        "content-type",
        "x-content-type-options",
      ]);
      // eslint-disable-next-line no-await-in-loop
      expect(await response.text()).toBe(body);
    }
    expect(f.server.fetched).toHaveLength(3);
    const target = f.manifest.urls[1]!;
    const script = requestFor(target);
    Object.defineProperty(script, "destination", { value: "script" });
    const source = (await worker.respondResponse(script, "page"))!;
    expect(source.url).toBe(ORIGIN + target);
    expect(source.headers.get("referrer-policy")).toBe("no-referrer");
    expect(source.headers.get("permissions-policy")).toBe("geolocation=()");
    expect(f.server.fetched).toHaveLength(4);
    const navigation = (await worker.respondResponse(requestFor(target, true), "", "document"))!;
    expect(navigation.url).toBe(ORIGIN + target);
    expect(navigation.headers.get("report-to")).toBe(source.headers.get("report-to"));
    const unavailable = f.manifest.urls[2]!;
    f.server.failures.set(unavailable, "always");
    await expect(worker.respond(requestFor(unavailable, true))).rejects.toThrow();
    await expect(worker.respond(requestFor(unavailable), "page")).resolves.toBe(
      f.files[unavailable],
    );
    const count = f.server.fetched.length;
    await expect(worker.respond(requestFor(`${target}?variant=1`), "page")).rejects.toThrow(
      "exact canonical URL",
    );
    expect(f.server.fetched).toHaveLength(count);
    // Worker/range contexts can use only their own native original, never aliases.
    const request = requestFor(target);
    Object.defineProperty(request, "destination", { value: "worker" });
    expect((await worker.respondResponse(request, "page"))!.url).toBe(ORIGIN + target);
    const range = new PrioritizedRequest(target, { headers: { Range: "bytes=0-1" } });
    expect((await worker.respondResponse(range, "page"))!.url).toBe(ORIGIN + target);
  });

  it("retains 503 successes, gates partial aliases and repairs corruption on explicit retry", async () => {
    const f = dataProfileFixture();
    f.manifest.groups = { initial: [], urls: { optional: [...f.manifest.urls] } };
    const worker = startWorker(f.server, {}, f.manifest, undefined, [{ id: "page" }]);
    await withTimersRun(worker.install());
    expect(f.server.fetched).toHaveLength(0);
    await expect(worker.respond(requestFor(f.manifest.urls[0]!), "page")).rejects.toThrow();
    const failed = f.manifest.verifiedJsonBodies![2]!.urls[0]!;
    f.server.statuses.set(failed, 503);
    await expect(
      withTimersRun(worker.requestGroups(f.manifest.buildId!, ["optional"])),
    ).resolves.toMatchObject({ reason: "failed" });
    await expect(worker.respond(requestFor(f.manifest.urls[0]!), "page")).rejects.toThrow(
      "committed",
    );
    const before = [...f.server.fetched];
    f.server.statuses.delete(failed);
    await expect(
      withTimersRun(worker.requestGroups(f.manifest.buildId!, ["optional"])),
    ).resolves.toMatchObject({ readyGroups: ["optional"], status: "available" });
    expect(f.server.fetched.slice(before.length)).toEqual([failed]);
    const aliases = await worker.storage.open(
      verifiedJsonAliasCachePrefix(POLICY) + f.manifest.version,
    );
    aliases.bodies.set(f.manifest.urls[1]!, new Response("broken"));
    await expect(worker.requestGroups(f.manifest.buildId!, [])).resolves.toMatchObject({
      reason: "failed",
    });
    const requests = f.server.fetched.length;
    await expect(
      withTimersRun(worker.requestGroups(f.manifest.buildId!, ["optional"])),
    ).resolves.toMatchObject({ status: "available" });
    expect(f.server.fetched).toHaveLength(requests);
    const routing = await worker.storage.open("game-kit-routing:game-");
    const key = `/.game-kit-routing/build/game-${f.manifest.version}`;
    await routing.put(
      key,
      new Response(JSON.stringify({ manifest: f.manifest, urls: f.manifest.urls })),
    );
    await expect(worker.requestGroups(f.manifest.buildId!, [])).resolves.toMatchObject({
      reason: "wrong-build",
    });
  });

  it("rejects colliding namespaces before resources and rejects unknown profile headers", async () => {
    const f = dataProfileFixture();
    const open = vi.fn();
    const listener = vi.fn();
    vi.stubGlobal("caches", { open });
    vi.stubGlobal("self", { addEventListener: listener });
    for (const cacheNamePrefix of ["", "!", "!game-kit-"]) {
      expect(() => runServiceWorker({ ...POLICY, cacheNamePrefix }, f.manifest)).toThrow(
        "collides",
      );
    }
    expect(open).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    const source = vi.mocked(f.server.fetch).getMockImplementation()!;
    vi.mocked(f.server.fetch).mockImplementation(async (request) => {
      const response = await source(request);
      response.headers.set("x-unqualified", "test");
      return response;
    });
    const worker = startWorker(f.server, {}, f.manifest);
    await expect(withTimersRun(worker.install())).rejects.toThrow("Precache failed");
    expect(f.server.fetched).toHaveLength(9);
  });

  it("preserves live profile pairs and reclaims both caches only after complete client-free activation", async () => {
    const f = dataProfileFixture();
    const old = startWorker(f.server, {}, f.manifest, undefined, [{ id: "page" }]);
    await withTimersRun(old.install());
    await old.requestGroups(f.manifest.buildId!, []);
    const nextManifest = { ...f.manifest, buildId: "e".repeat(40), version: "fedcba9876543210" };
    const clients = [{ id: "page" }];
    const next = startWorker(f.server, {}, nextManifest, old.storage, clients);
    await withTimersRun(next.install());
    await withTimersRun(next.activate());
    expect(next.storage.named.has(cacheNameFor(POLICY, f.manifest.version))).toBe(true);
    expect(next.storage.named.has(verifiedJsonAliasCachePrefix(POLICY) + f.manifest.version)).toBe(
      true,
    );
    await expect(next.respond(requestFor(f.manifest.urls[1]!), "page")).resolves.toBe(
      f.files[f.manifest.urls[1]!],
    );
    clients.splice(0);
    await withTimersRun(next.activate());
    expect(next.storage.named.has(cacheNameFor(POLICY, f.manifest.version))).toBe(false);
    expect(next.storage.named.has(verifiedJsonAliasCachePrefix(POLICY) + f.manifest.version)).toBe(
      false,
    );
    expect(
      next.storage.named.has(verifiedJsonAliasCachePrefix(POLICY) + nextManifest.version),
    ).toBe(true);
  });
});

// The focused historical harness supplies the actual frozen kernel, never a copied reader model.
export async function proveHistoricalProfileIsolation(
  runLegacy: typeof runServiceWorker,
): Promise<string[]> {
  virtualNetworkClock();
  vi.stubGlobal("Request", PrioritizedRequest);
  durable.builds.clear();
  durable.barrier = undefined;
  const f = dataProfileFixture();
  const url = f.manifest.urls[1]!;
  const body = f.files[url]!;
  const previous: PrecacheManifest = {
    contentHashes: { [url]: hashOf(body) },
    sounds: {},
    urls: [url],
    version: "v1",
  };
  const clients = [{ id: "old" }];
  const old = startWorker(f.server, {}, previous, undefined, clients, "capable", runLegacy);
  await withTimersRun(old.install());
  await old.respond(requestFor(url, true), "", "old");
  const oldCache = await old.storage.open(OLD);
  const original = (await oldCache.match(url))!;
  const next = startWorker(f.server, {}, f.manifest, old.storage, [
    { id: "old" },
    { id: "profile" },
  ]);
  await withTimersRun(next.install());
  const aliasName = verifiedJsonAliasCachePrefix(POLICY) + f.manifest.version;
  expect(next.storage.named.has(aliasName)).toBe(true);
  expect((await next.storage.open(cacheNameFor(POLICY, f.manifest.version))).bodies.has(url)).toBe(
    false,
  );
  await expect(next.respond(requestFor(url), "old")).resolves.toBe(body);
  await expect(next.requestGroups(f.manifest.buildId!, [], "profile")).resolves.toMatchObject({
    status: "available",
  });
  clients.push({ id: "profile" });
  await expect(old.requestGroups(f.manifest.buildId!, [], "profile")).resolves.toMatchObject({
    reason: "wrong-build",
  });
  oldCache.bodies.delete(url);
  f.server.statuses.set(url, 503);
  const fetched = f.server.fetched.length;
  await expect(withTimersRun(old.install())).rejects.toThrow("Precache failed");
  expect(f.server.fetched.slice(fetched)).toEqual([url, url, url]);
  expect(oldCache.bodies.has(url)).toBe(false);
  await expect(old.respond(requestFor(url, true))).rejects.toThrow();
  // An older activation may remove ordinary stale caches only after all clients leave.
  await oldCache.put(url, original);
  await withTimersRun(old.activate());
  expect(next.storage.named.has(cacheNameFor(POLICY, f.manifest.version))).toBe(true);
  expect(next.storage.named.has(aliasName)).toBe(true);
  clients.splice(0);
  await withTimersRun(old.activate());
  expect(next.storage.named.has(cacheNameFor(POLICY, f.manifest.version))).toBe(false);
  expect(next.storage.named.has(aliasName)).toBe(true);
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  return [
    "actual old copy cannot borrow alias",
    "actual old durable reader rejects wire2",
    "old pin readable by new kernel",
    "actual old navigation never receives alias",
    "old live reclamation preserves pairs",
    "old client-free reclamation cannot reach private aliases",
  ];
}
