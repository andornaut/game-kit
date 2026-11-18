// The one loader: registers the router worker, installs the first build in the foreground under the
// loading screen, stages later builds in the background and offers Update now during a session
// (docs/install-and-update.md). The page drives every download; the router only serves the
// recorded active build or a window's pin.
import {
  BUILD_HASH_HEADER,
  BUILD_POINTER_URL,
  buildCacheName,
  type BuildFile,
  type BuildManifest,
  buildManifestUrl,
  type BuildPointer,
  type BuildPolicy,
  type BuildState,
  type LaunchFailure,
  type LaunchProgress,
  type LaunchResult,
  type UpdateOffer,
  type UpdateState,
} from "../buildContract.ts";
import { verifiedJsonAliasCachePrefix } from "../verifiedJsonBody.ts";
import { type VisibilitySource, watchVisibility } from "./visibility.ts";

export type InstallFailureReason = "network" | "quota" | "verification";

// The build store (dom/buildStore), as far as launch uses it. Every record write is atomic.
export interface LaunchStore {
  readState(): Promise<BuildState>;
  setActive(version: string): Promise<void>;
  setStaged(version: string | undefined): Promise<void>;
  readManifest(version: string): Promise<BuildManifest | undefined>;
  saveManifest(manifest: BuildManifest): Promise<void>;
  // The manifest's files with no verified entry in its build cache.
  missing(manifest: BuildManifest): Promise<readonly BuildFile[]>;
  // A metadata check: every file has an entry whose recorded hash matches the manifest.
  complete(manifest: BuildManifest): Promise<boolean>;
  // Deletes every build that is neither active, staged nor named in pinned.
  reclaim(pinned: readonly string[]): Promise<void>;
  // The versions the router has pinned for live window clients.
  pinnedVersions(): Promise<readonly string[]>;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface InstallContext {
  readonly fetch: FetchLike;
  readonly store: LaunchStore;
}

export interface InstallOptions {
  readonly manifest: BuildManifest;
  readonly lanes: number;
  readonly priority: "auto" | "low";
  readonly signal: AbortSignal;
  // Received and total bytes of this install's fetches.
  readonly onProgress: (receivedBytes: number, totalBytes: number) => void;
  // Awaited before each request; resolves at once unless the install is paused.
  readonly whenRunnable: () => Promise<void>;
}

// "changed": the deployed bytes stopped matching the pinned manifest. Rejections carry
// { reason: InstallFailureReason }.
export type InstallBuild = (
  context: InstallContext,
  options: InstallOptions,
) => Promise<"complete" | "changed">;

// The service worker container, as far as launch uses it.
export interface LaunchContainer extends EventTarget {
  readonly controller: { readonly scriptURL: string } | null;
  register(url: string, options: { scope: string; updateViaCache: "none" }): Promise<unknown>;
}

export interface LaunchTimers {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

export interface CacheLike {
  match(url: string): Promise<Response | undefined>;
  put(url: string, response: Response): Promise<void>;
}

export interface CacheStorageLike {
  delete(name: string): Promise<boolean>;
  keys(): Promise<string[]>;
  open(name: string): Promise<CacheLike>;
}

export type SessionLike = Pick<Storage, "getItem" | "removeItem" | "setItem">;

export interface LaunchStorage {
  readonly caches: CacheStorageLike | undefined;
  readonly indexedDB: Pick<IDBFactory, "deleteDatabase"> | undefined;
  // The tab's sessionStorage. Without it the fallback launch reload never runs.
  readonly session: SessionLike | undefined;
}

// What launch needs of the page, so tests can pass fakes. eventTarget is its window.
export interface LaunchPage {
  readonly container: LaunchContainer;
  readonly eventTarget: EventTarget;
  readonly fetch: FetchLike;
  readonly location: { readonly href: string; reload(): void };
  online(): boolean;
  readonly storage: LaunchStorage;
  readonly timers: LaunchTimers;
  readonly visibility: VisibilitySource;
}

export interface LaunchContext {
  readonly installBuild: InstallBuild;
  readonly page: LaunchPage;
  readonly store: LaunchStore;
}

// A required update's state, for a save a newer version wrote. "updating": a newer build is being
// found, staged or activated, or the page is reloading into it; the game shows its travelling
// loading bar. "unavailable": none of that is under way; the game shows its one "connect to
// update" message, and launch retries when the device reconnects and the page comes into view.
export type RequiredUpdateState = "unavailable" | "updating";

export interface LaunchOptions {
  readonly onFailure: (failure: LaunchFailure) => void;
  readonly onProgress: (progress: LaunchProgress) => void;
  // Reported only after requireNewer().
  readonly onRequireNewer?: (state: RequiredUpdateState) => void;
  readonly onUpdateReady: (offer: UpdateOffer) => void;
  readonly onUpdateState: (state: UpdateState) => void;
  readonly policy: BuildPolicy;
  // The router worker's URL, registered with scope "/".
  readonly serviceWorkerUrl: string;
}

export interface Launch {
  // Once at document boot, before game construction or save access. "reloading" means the
  // caller must not start the game. A first install that fails stays pending until onFailure's
  // retry succeeds.
  run(): Promise<LaunchResult>;
  // The boot loader's settled reads, in any unit, counted into the same progress value.
  bootProgress(done: number, total: number): void;
  // A save a newer version wrote: activate a newer build and reload, never offering it, and
  // report each state through onRequireNewer. The caller keeps Start, save loading and writes
  // blocked in both states. Idempotent; it lasts for the page.
  requireNewer(): void;
  dispose(): void;
}

// The shortest time between update checks, so resuming the app asks the server at most once a
// minute.
export const UPDATE_CHECK_MS = 60_000;

// How long a completed first install waits for the router to control the page before reloading.
export const CONTROL_WAIT_MS = 10_000;

// Foreground and background installer settings.
const FOREGROUND = { lanes: 6, priority: "auto" } as const;
const BACKGROUND = { lanes: 2, priority: "low" } as const;

// A redeploy restarts an install on the new manifest; this bounds repeated restarts.
const MAX_RESTARTS = 3;

// The progress share held back until the active record is written.
const RECORD_SHARE = 0.01;

// Session keys: the build a fallback launch reload targeted, and first-install progress carried
// across the reload that boots the new build.
export const LAUNCH_RELOAD_KEY = "game-kit:launch-reload";
export const LAUNCH_PROGRESS_KEY = "game-kit:launch-progress";

class LaunchError extends Error {
  readonly reason: LaunchFailure["reason"];

  constructor(reason: LaunchFailure["reason"], message: string) {
    super(message);
    this.name = "LaunchError";
    this.reason = reason;
  }
}

function failureReason(error: unknown): LaunchFailure["reason"] {
  const reason = (error as { reason?: unknown } | null)?.reason;
  return reason === "network" ||
    reason === "quota" ||
    reason === "verification" ||
    reason === "unsupported"
    ? reason
    : "network";
}

const SHA256 = /^[0-9a-f]{64}$/;

function isBuildPointer(value: unknown): value is BuildPointer {
  const pointer = value as Partial<BuildPointer> | null;
  return (
    typeof pointer === "object" &&
    pointer !== null &&
    pointer.schema === 1 &&
    typeof pointer.version === "string" &&
    pointer.version.length > 0 &&
    typeof pointer.buildId === "string" &&
    pointer.manifest === buildManifestUrl(pointer.version)
  );
}

function isBuildManifest(value: unknown, pointer: BuildPointer): value is BuildManifest {
  const manifest = value as Partial<BuildManifest> | null;
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    manifest.schema !== 1 ||
    manifest.version !== pointer.version ||
    manifest.buildId !== pointer.buildId ||
    !Array.isArray(manifest.files) ||
    !Array.isArray(manifest.boot) ||
    typeof manifest.sounds !== "object" ||
    manifest.sounds === null
  ) {
    return false;
  }
  const urls = new Set<string>();
  for (const file of manifest.files as unknown[]) {
    const { byteSize, sha256, url } = (file ?? {}) as Partial<BuildFile>;
    if (
      typeof url !== "string" ||
      !url.startsWith("/") ||
      typeof sha256 !== "string" ||
      !SHA256.test(sha256) ||
      !Number.isSafeInteger(byteSize) ||
      (byteSize as number) < 0
    ) {
      return false;
    }
    urls.add(url);
  }
  return (manifest.boot as unknown[]).every((url) => typeof url === "string" && urls.has(url));
}

function bootBytesOf(manifest: BuildManifest): number {
  const sizes = new Map(manifest.files.map((file) => [file.url, file.byteSize]));
  return [...new Set(manifest.boot)].reduce((sum, url) => sum + (sizes.get(url) ?? 0), 0);
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

interface ProgressCarry {
  readonly bootBytes: number;
  readonly receivedBytes: number;
  readonly version: string;
}

function readCarry(session: SessionLike | undefined): ProgressCarry | undefined {
  try {
    const text = session?.getItem(LAUNCH_PROGRESS_KEY);
    if (text === null || text === undefined) {
      return undefined;
    }
    const carry = JSON.parse(text) as Partial<ProgressCarry>;
    return typeof carry.version === "string" &&
      Number.isFinite(carry.receivedBytes) &&
      Number.isFinite(carry.bootBytes)
      ? (carry as ProgressCarry)
      : undefined;
  } catch {
    return undefined;
  }
}

function writeSession(session: SessionLike | undefined, key: string, value: string | undefined) {
  try {
    if (value === undefined) {
      session?.removeItem(key);
    } else {
      session?.setItem(key, value);
    }
  } catch {
    // Without storage, progress restarts from the boot reads and no fallback reload runs.
  }
}

// CLEANUP (added 2026-11-18): remove once all three games deploy the router.
// Pre-router workers kept one cache per version (<prefix><16 hex>), verified JSON alias caches,
// a routing records cache and an asset-group database.
const LEGACY_VERSION = /^[0-9a-f]{16}$/;

function legacyAliasPrefix(policy: BuildPolicy): string | undefined {
  try {
    return verifiedJsonAliasCachePrefix(policy);
  } catch {
    return undefined;
  }
}

function legacyVersionCaches(policy: BuildPolicy, names: readonly string[]): string[] {
  const alias = legacyAliasPrefix(policy);
  return names.filter(
    (name) =>
      (name.startsWith(policy.cacheNamePrefix) &&
        LEGACY_VERSION.test(name.slice(policy.cacheNamePrefix.length))) ||
      (alias !== undefined &&
        name.startsWith(alias) &&
        LEGACY_VERSION.test(name.slice(alias.length))),
  );
}

export function legacyRoutingCacheName(policy: BuildPolicy): string {
  return `game-kit-routing:${policy.cacheNamePrefix}`;
}

export function legacyGroupDatabaseName(policy: BuildPolicy): string {
  return `game-kit-groups:${policy.cacheNamePrefix}`;
}

const LEGACY_CONTROL_RELOAD_KEY = "game-kit:control-reload";
const LEGACY_COPY_LANES = 4;

// Copies each missing file an old version cache holds with the manifest's size and SHA-256 into
// the new build's cache, hashing each copy once. Returns the bytes copied.
async function copyLegacyEntries(
  storage: LaunchStorage,
  context: { readonly policy: BuildPolicy; readonly store: LaunchStore },
  manifest: BuildManifest,
  onCopied: (bytes: number) => void,
): Promise<void> {
  const { caches } = storage;
  if (caches === undefined) {
    return;
  }
  const names = legacyVersionCaches(context.policy, await caches.keys());
  if (names.length === 0) {
    return;
  }
  const sources = await Promise.all(names.map((name) => caches.open(name)));
  const target = await caches.open(buildCacheName(context.policy, manifest.version));
  // Tries each old cache in turn, stopping at the first copy with the manifest's size and hash.
  const copyFrom = async (file: BuildFile, index: number): Promise<void> => {
    const source = sources[index];
    if (source === undefined) {
      return;
    }
    const response = await source.match(file.url);
    const bytes = await response?.arrayBuffer();
    if (
      response === undefined ||
      bytes === undefined ||
      bytes.byteLength !== file.byteSize ||
      hex(await crypto.subtle.digest("SHA-256", bytes)) !== file.sha256
    ) {
      await copyFrom(file, index + 1);
      return;
    }
    const headers = new Headers(response.headers);
    headers.set(BUILD_HASH_HEADER, file.sha256);
    headers.set("content-length", String(bytes.byteLength));
    await target.put(file.url, new Response(bytes, { headers, status: 200 }));
    onCopied(bytes.byteLength);
  };
  const queue = [...(await context.store.missing(manifest))];
  const lane = async (): Promise<void> => {
    const file = queue.shift();
    if (file !== undefined) {
      await copyFrom(file, 0);
      await lane();
    }
  };
  await Promise.all(Array.from({ length: LEGACY_COPY_LANES }, lane));
}

async function deleteLegacy(storage: LaunchStorage, policy: BuildPolicy): Promise<void> {
  const { caches } = storage;
  writeSession(storage.session, LEGACY_CONTROL_RELOAD_KEY, undefined);
  try {
    storage.indexedDB?.deleteDatabase(legacyGroupDatabaseName(policy));
  } catch {
    // An unavailable database has nothing to delete.
  }
  if (caches === undefined) {
    return;
  }
  const names = await caches.keys();
  await Promise.all(
    [...legacyVersionCaches(policy, names), legacyRoutingCacheName(policy)]
      .filter((name) => names.includes(name))
      .map((name) => caches.delete(name)),
  );
}

// The browser's page, or undefined where it has no service workers or Cache Storage.
export function browserLaunchPage(): LaunchPage | undefined {
  if (!("serviceWorker" in navigator) || typeof caches === "undefined") {
    return undefined;
  }
  let session: SessionLike | undefined;
  try {
    session = window.sessionStorage;
  } catch {
    session = undefined;
  }
  return {
    container: navigator.serviceWorker,
    eventTarget: window,
    fetch: (input, init) => fetch(input, init),
    location: window.location,
    online: () => navigator.onLine,
    storage: {
      caches,
      indexedDB: typeof indexedDB === "undefined" ? undefined : indexedDB,
      session,
    },
    timers: {
      clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
      now: () => Date.now(),
      setTimeout: (callback, ms) => setTimeout(callback, ms),
    },
    visibility: document,
  };
}

// Call run() once at document boot. With no active build it installs the deployed build in the
// foreground and reports onProgress, or onFailure with a resuming retry. With an active build it
// resolves "play" at once, then checks build.json at launch and on resume and stages a newer
// build in the background. Staging never activates: a staged build becomes active through
// Update now, requireNewer, or the router's promotion at the next launch navigation.
export function createLaunch(context: LaunchContext, options: LaunchOptions): Launch {
  const { installBuild, page, store } = context;
  const { policy } = options;
  const { session } = page.storage;
  const routerUrl = new URL(options.serviceWorkerUrl, page.location.href).href;
  const aborts = new AbortController();
  let disposed = false;
  let reloading = false;
  // The build this document runs, once run() resolves "play".
  let documentVersion: string | undefined;
  let visible = page.visibility.visibilityState !== "hidden";
  let visibleWaiters: (() => void)[] = [];
  const cleanups: (() => void)[] = [];

  // One determinate value over download bytes plus boot bytes. RECORD_SHARE of it is held back
  // until the active record is written, so only a recorded, fully booted build reaches 1.
  let progress = { bootBytes: 0, received: 0, recorded: false, total: 0 };
  let lastValue = 0;
  let ready = false;
  const report = (phase: LaunchProgress["phase"], bootFraction: number) => {
    const { bootBytes, received, recorded, total } = progress;
    const all = total + bootBytes;
    const read = phase === "ready" ? all : received + bootBytes * bootFraction;
    const share = all > 0 ? read / all : bootFraction;
    const raw = (1 - RECORD_SHARE) * Math.min(1, share) + (recorded ? RECORD_SHARE : 0);
    lastValue = phase === "ready" ? 1 : Math.max(lastValue, Math.min(raw, 1 - Number.EPSILON));
    try {
      options.onProgress({
        phase,
        receivedBytes: Math.round(read),
        totalBytes: all,
        value: lastValue,
      });
    } catch (error) {
      console.error("Launch progress callback failed.", error);
    }
  };

  const reload = () => {
    reloading = true;
    aborts.abort();
    page.location.reload();
  };

  const fetchJson = async (url: string, init: RequestInit): Promise<unknown> => {
    let response: Response;
    try {
      response = await page.fetch(url, init);
    } catch {
      throw new LaunchError("network", `Could not fetch ${url}`);
    }
    if (!response.ok) {
      throw new LaunchError("network", `Could not fetch ${url}: ${response.status}`);
    }
    try {
      return await response.json();
    } catch {
      throw new LaunchError("verification", `Invalid JSON at ${url}`);
    }
  };

  const readPointer = async (): Promise<BuildPointer> => {
    const pointer = await fetchJson(BUILD_POINTER_URL, { cache: "no-store" });
    if (!isBuildPointer(pointer)) {
      throw new LaunchError("verification", "Invalid build pointer");
    }
    return pointer;
  };

  // The pinned manifest the pointer names, from the store when an earlier attempt saved it.
  const readPinnedManifest = async (pointer: BuildPointer): Promise<BuildManifest> => {
    const saved = await store.readManifest(pointer.version);
    if (saved !== undefined && saved.buildId === pointer.buildId) {
      return saved;
    }
    const manifest = await fetchJson(pointer.manifest, {});
    if (!isBuildManifest(manifest, pointer)) {
      throw new LaunchError("verification", `Invalid build manifest for ${pointer.version}`);
    }
    return manifest;
  };

  const register = () =>
    page.container.register(options.serviceWorkerUrl, { scope: "/", updateViaCache: "none" });

  const controlledByRouter = () => page.container.controller?.scriptURL === routerUrl;

  // Resolves once the router controls the page, or after CONTROL_WAIT_MS.
  const waitForRouter = () =>
    new Promise<void>((resolve) => {
      if (controlledByRouter()) {
        resolve();
        return;
      }
      const done = () => {
        page.container.removeEventListener("controllerchange", changed);
        page.timers.clearTimeout(timer);
        resolve();
      };
      const changed = () => {
        if (controlledByRouter()) {
          done();
        }
      };
      const timer = page.timers.setTimeout(done, CONTROL_WAIT_MS);
      page.container.addEventListener("controllerchange", changed);
    });

  const whenVisible = (): Promise<void> =>
    visible || disposed
      ? Promise.resolve()
      : new Promise((resolve) => {
          visibleWaiters.push(resolve);
        });

  // First install, in the foreground. Resolves once this document can play the active build or
  // has reloaded into it.
  const firstInstall = async (): Promise<LaunchResult> => {
    try {
      await register();
    } catch (error) {
      throw new LaunchError(
        "unsupported",
        `Service worker registration failed: ${String((error as Error)?.message ?? error)}`,
      );
    }
    return installDeployed(0);
  };

  // Installs the build the pointer names; a redeploy mid-install restarts on the new manifest.
  const installDeployed = async (restarts: number): Promise<LaunchResult> => {
    const pointer = await readPointer();
    const manifest = await readPinnedManifest(pointer);
    let copied = 0;
    progress = { ...progress, bootBytes: bootBytesOf(manifest), received: 0, total: 0 };
    const missingBytes = (await store.missing(manifest)).reduce(
      (sum, file) => sum + file.byteSize,
      0,
    );
    progress = { ...progress, total: missingBytes };
    report("installing", 0);
    // CLEANUP (added 2026-11-18): remove once all three games deploy the router.
    await copyLegacyEntries(page.storage, { policy, store }, manifest, (bytes) => {
      copied += bytes;
      progress = { ...progress, received: copied };
      report("installing", 0);
    });
    const result = await installBuild(
      { fetch: page.fetch, store },
      {
        ...FOREGROUND,
        manifest,
        onProgress: (receivedBytes, totalBytes) => {
          progress = {
            ...progress,
            received: copied + receivedBytes,
            total: copied + totalBytes,
          };
          report("installing", 0);
        },
        signal: aborts.signal,
        whenRunnable: () => Promise.resolve(),
      },
    );
    if (result === "changed") {
      if (restarts + 1 >= MAX_RESTARTS) {
        throw new LaunchError("verification", "The deployed build kept changing during install");
      }
      return installDeployed(restarts + 1);
    }
    await store.saveManifest(manifest);
    await store.setActive(manifest.version);
    progress = { ...progress, received: progress.total, recorded: true };
    report("installing", 0);
    // CLEANUP (added 2026-11-18): remove once all three games deploy the router.
    await deleteLegacy(page.storage, policy).catch((error: unknown) =>
      console.warn("Could not delete legacy offline caches.", error),
    );
    if (controlledByRouter()) {
      return play(manifest.version);
    }
    await waitForRouter();
    if (disposed) {
      return "reloading";
    }
    writeSession(
      session,
      LAUNCH_PROGRESS_KEY,
      JSON.stringify({
        bootBytes: progress.bootBytes,
        receivedBytes: progress.total,
        version: manifest.version,
      } satisfies ProgressCarry),
    );
    reload();
    return "reloading";
  };

  // Retries a failed first install until it succeeds; each retry resumes from stored entries.
  const installUntilDone = (): Promise<LaunchResult> =>
    new Promise((resolve) => {
      const attempt = () => {
        firstInstall().then(resolve, (error: unknown) => {
          if (disposed) {
            return;
          }
          console.warn("First install failed.", error);
          let retried = false;
          const failure: LaunchFailure = {
            reason: failureReason(error),
            retry: () => {
              if (!retried && !disposed) {
                retried = true;
                attempt();
              }
            },
          };
          try {
            options.onFailure(failure);
          } catch (callbackError) {
            console.error("Launch failure callback failed.", callbackError);
          }
        });
      };
      attempt();
    });

  const play = (version: string): LaunchResult => {
    documentVersion = version;
    writeSession(session, LAUNCH_RELOAD_KEY, undefined);
    void afterLaunch();
    return "play";
  };

  // K4 reclaim and legacy cleanup, then the launch update check.
  const afterLaunch = async () => {
    try {
      const pinned = await store.pinnedVersions();
      await store.reclaim(documentVersion === undefined ? pinned : [...pinned, documentVersion]);
    } catch (error) {
      console.warn("Could not reclaim unused builds.", error);
    }
    // CLEANUP (added 2026-11-18): remove once all three games deploy the router.
    await deleteLegacy(page.storage, policy).catch(() => undefined);
    check(false);
  };

  // Background updates: discovery, staging and the in-session offer.
  let lastCheck: number | undefined;
  let staging: Promise<void> | undefined;
  let updateState: UpdateState = { phase: "idle" };
  const offered = new Set<string>();
  const reportUpdate = (next: UpdateState) => {
    if (
      next.phase === updateState.phase &&
      (next as { version?: string }).version === (updateState as { version?: string }).version &&
      (next as { value?: number }).value === (updateState as { value?: number }).value
    ) {
      return;
    }
    updateState = next;
    try {
      options.onUpdateState(next);
    } catch (error) {
      console.error("Update state callback failed.", error);
    }
  };

  let switching: Promise<void> | undefined;
  const updateNow = (version: string, save: () => void | PromiseLike<void>): Promise<void> => {
    switching ??= (async () => {
      await save();
      const state = await store.readState();
      if (state.active !== version) {
        if (state.staged !== version) {
          const manifest = await store.readManifest(version);
          if (manifest === undefined || !(await store.complete(manifest))) {
            throw new Error(`Build ${version} is no longer staged`);
          }
        }
        await store.setActive(version);
        if (state.staged === version) {
          await store.setStaged(undefined);
        }
      }
      reload();
    })().catch((error: unknown) => {
      switching = undefined;
      throw error;
    });
    return switching;
  };

  const offer = (version: string) => {
    if (required || offered.has(version) || disposed || reloading) {
      return;
    }
    offered.add(version);
    try {
      options.onUpdateReady({
        dismiss: () => undefined,
        updateNow: (save) => updateNow(version, save),
        version,
      });
    } catch (error) {
      console.error("Update ready callback failed.", error);
    }
  };

  // Stages the build the pointer names; a redeploy mid-staging restarts on the new manifest.
  // Records in attempt the version it tries, so a failure can name it.
  const stageDeployed = async (restarts: number, attempt: { version?: string }): Promise<void> => {
    const pointer = await readPointer();
    const state = await store.readState();
    if (pointer.version === documentVersion || pointer.version === state.active) {
      // The deployed build is already running; a staged one would roll it back.
      if (state.staged !== undefined && state.staged !== pointer.version) {
        await store.setStaged(undefined);
      }
      reportUpdate({ phase: "idle" });
      return;
    }
    const { version } = pointer;
    attempt.version = version;
    const manifest = await readPinnedManifest(pointer);
    if (state.staged === version && (await store.complete(manifest))) {
      reportUpdate({ phase: "ready", version });
      offer(version);
      return;
    }
    await store.saveManifest(manifest);
    reportUpdate({ phase: "staging", value: 0, version });
    const result = await installBuild(
      { fetch: page.fetch, store },
      {
        ...(required ? FOREGROUND : BACKGROUND),
        manifest,
        onProgress: (receivedBytes, totalBytes) => {
          const value = totalBytes > 0 ? Math.min(1, receivedBytes / totalBytes) : 0;
          reportUpdate({ phase: "staging", value, version });
        },
        signal: aborts.signal,
        whenRunnable: whenVisible,
      },
    );
    if (disposed) {
      return;
    }
    if (result === "changed") {
      if (restarts + 1 >= MAX_RESTARTS) {
        throw new LaunchError("verification", "The deployed build kept changing during staging");
      }
      await stageDeployed(restarts + 1, attempt);
      return;
    }
    await store.setStaged(version);
    reportUpdate({ phase: "ready", version });
    offer(version);
  };

  const stage = async () => {
    const attempt: { version?: string } = {};
    try {
      await stageDeployed(0, attempt);
    } catch (error) {
      if (disposed) {
        return;
      }
      // K3: a failed update is retried at the next check and never shows Loading failed.
      console.warn("Background update failed.", error);
      if (attempt.version !== undefined) {
        reportUpdate({ phase: "failed", version: attempt.version });
      }
    }
  };

  // Starts an update check unless one is under way, the page is offline, or (without force) the
  // last check ran within UPDATE_CHECK_MS. Returns whether a check is under way.
  const check = (force: boolean): boolean => {
    if (disposed || reloading || documentVersion === undefined) {
      return false;
    }
    if (staging !== undefined) {
      return true;
    }
    const now = page.timers.now();
    if (
      !page.online() ||
      (!force && lastCheck !== undefined && now - lastCheck < UPDATE_CHECK_MS)
    ) {
      return false;
    }
    lastCheck = now;
    staging = stage().finally(() => {
      staging = undefined;
      advanceRequired(false);
    });
    return true;
  };

  // Required updates (requireNewer).
  let required = false;
  let requiredState: RequiredUpdateState | undefined;
  let requiredChain = Promise.resolve();
  const reportRequired = (next: RequiredUpdateState) => {
    if (requiredState === next) {
      return;
    }
    requiredState = next;
    try {
      options.onRequireNewer?.(next);
    } catch (error) {
      console.error("Required update callback failed.", error);
    }
  };
  const stepRequired = async (retry: boolean) => {
    if (!required || reloading || disposed) {
      return;
    }
    if (documentVersion === undefined) {
      reportRequired("unavailable");
      return;
    }
    try {
      const state = await store.readState();
      if (state.active !== undefined && state.active !== documentVersion) {
        // Another window already activated a newer build.
        reportRequired("updating");
        reload();
        return;
      }
      if (state.staged !== undefined && state.staged !== documentVersion) {
        const manifest = await store.readManifest(state.staged);
        if (manifest !== undefined && (await store.complete(manifest))) {
          reportRequired("updating");
          await store.setActive(state.staged);
          await store.setStaged(undefined);
          reload();
          return;
        }
      }
    } catch (error) {
      console.warn("Could not read build records for a required update.", error);
    }
    if (staging !== undefined || (retry && check(true))) {
      reportRequired("updating");
      return;
    }
    reportRequired("unavailable");
  };
  const advanceRequired = (retry: boolean) => {
    requiredChain = requiredChain.then(() => stepRequired(retry));
  };

  cleanups.push(
    watchVisibility(page.eventTarget, page.visibility, (nextVisible) => {
      visible = nextVisible;
      if (!visible) {
        return;
      }
      const waiters = visibleWaiters;
      visibleWaiters = [];
      for (const resume of waiters) {
        resume();
      }
      check(false);
      advanceRequired(true);
    }),
  );
  const online = () => advanceRequired(true);
  page.eventTarget.addEventListener("online", online);
  cleanups.push(() => page.eventTarget.removeEventListener("online", online));

  const launch = async (): Promise<LaunchResult> => {
    const state = await store.readState();
    if (state.active === undefined) {
      return installUntilDone();
    }
    // The router updates its own script; play does not wait for it.
    register().catch((error: unknown) =>
      console.warn("Service worker registration failed; offline play may be stale.", error),
    );
    const carry = readCarry(session);
    if (carry !== undefined && carry.version === state.active) {
      progress = {
        bootBytes: carry.bootBytes,
        received: carry.receivedBytes,
        recorded: true,
        total: carry.receivedBytes,
      };
    } else {
      progress = { ...progress, recorded: true };
      writeSession(session, LAUNCH_PROGRESS_KEY, undefined);
    }
    // The router promotes a complete staged build at navigation. A complete staged build at this
    // point means this document was not promoted, so it reloads once into the router.
    if (state.staged !== undefined && state.staged !== state.active && session !== undefined) {
      let target: string | null;
      try {
        target = session.getItem(LAUNCH_RELOAD_KEY);
      } catch {
        target = state.staged;
      }
      const manifest = target === state.staged ? undefined : await store.readManifest(state.staged);
      if (manifest !== undefined && (await store.complete(manifest))) {
        writeSession(session, LAUNCH_RELOAD_KEY, state.staged);
        reload();
        return "reloading";
      }
    }
    return play(state.active);
  };

  let running: Promise<LaunchResult> | undefined;
  return {
    bootProgress(done, total) {
      if (ready || disposed || !Number.isFinite(done) || !Number.isFinite(total)) {
        return;
      }
      if (total <= 0 || done >= total) {
        ready = true;
        writeSession(session, LAUNCH_PROGRESS_KEY, undefined);
        report("ready", 1);
        return;
      }
      report("booting", Math.max(0, done) / total);
    },
    dispose() {
      disposed = true;
      aborts.abort();
      for (const cleanup of cleanups.splice(0)) {
        cleanup();
      }
      for (const resume of visibleWaiters.splice(0)) {
        resume();
      }
    },
    requireNewer() {
      if (!required) {
        required = true;
        advanceRequired(true);
      }
    },
    run() {
      running ??= launch();
      return running;
    },
  };
}
