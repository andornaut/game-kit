// The one loader: registers the router worker, installs the first build in the foreground under the
// loading screen, stages later builds in the background and offers Update now during a session
// (docs/install-and-update.md). The page drives every download; the router only serves the
// recorded active build or a window's pin.
import {
  BUILD_HASH_HEADER,
  BUILD_POINTER_URL,
  type BuildFile,
  type BuildManifest,
  type BuildPointer,
  type BuildPolicy,
  type BuildState,
  type InstalledManifest,
  type LaunchFailure,
  type LaunchProgress,
  type LaunchResult,
  type NetworkPlayNotice,
  type UpdateOffer,
  type UpdateState,
} from "../buildContract.ts";
import { installedManifest, parseBuildManifest, parseBuildPointer } from "../buildRecords.ts";
import { verifiedJsonAliasCachePrefix } from "../verifiedJsonBody.ts";
import { BACKGROUND_INSTALL, FOREGROUND_INSTALL, installBuild } from "./buildInstaller.ts";
import { type BuildStore, createBuildStore, withBuildStateLock } from "./buildStore.ts";
import { type VisibilitySource, watchVisibility } from "./visibility.ts";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

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
  // navigator.storage, which the installer asks for persistence and a quota estimate.
  readonly manager: Pick<StorageManager, "estimate" | "persist"> | undefined;
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
  readonly installBuild: typeof installBuild;
  readonly page: LaunchPage;
  // The game's cache policy, which scopes the store's caches and the legacy caches launch deletes.
  readonly policy: BuildPolicy;
  // createBuildStore over the page's caches, origin and policy.
  readonly store: BuildStore;
}

// A required update's state, for a save a newer version wrote. "updating": a newer build is being
// found, staged or activated, or the page is reloading into it; the game shows its travelling
// loading bar. "unavailable": none of that is under way; the game shows its one "connect to
// update" message, and launch retries when the device reconnects and the page comes into view.
export type RequiredUpdateState = "unavailable" | "updating";

export interface LaunchOptions {
  readonly onFailure: (failure: LaunchFailure) => void;
  // A first install this device cannot complete: called once before run() resolves "play", and
  // the game plays from the network. The game shows its own notice.
  readonly onNetworkPlay: (notice: NetworkPlayNotice) => void;
  readonly onProgress: (progress: LaunchProgress) => void;
  // Reported only after requireNewer().
  readonly onRequireNewer?: (state: RequiredUpdateState) => void;
  readonly onUpdateReady: (offer: UpdateOffer) => void;
  readonly onUpdateState: (state: UpdateState) => void;
  // The router worker's URL, registered with scope "/".
  readonly serviceWorkerUrl: string;
  // The sound format the page plays, which the game chooses, for example the first format an
  // audio element's canPlayType accepts. Each build installs only the sound alternatives whose
  // URL extension is this format, and none of a sound that has no such alternative; an
  // alternative left out is fetched from the network if requested. undefined installs every
  // alternative.
  readonly soundFormat: string | undefined;
}

export interface Launch {
  // Once at document boot, before game construction or save access. "reloading" means the
  // caller must not start the game. A first install that fails on the network or verification
  // stays pending until onFailure's retry succeeds; one that fails as unsupported or on quota
  // resolves "play" after onNetworkPlay.
  run(): Promise<LaunchResult>;
  // The boot loader's settled reads, in any unit, counted into the same progress value.
  bootProgress(done: number, total: number): void;
  // Request ordinary update discovery after a caller-owned transition. Shares the resume and
  // reconnect cooldown and eligibility. Activation during the current session remains explicit.
  requestUpdateCheck(): void;
  // A save a newer version wrote: activate a newer build and reload, never offering it, and
  // report each state through onRequireNewer. The caller keeps Start, save loading and writes
  // blocked in both states. Idempotent; it lasts for the page.
  requireNewer(): void;
  dispose(): void;
}

// The shortest time between update checks, so resuming the app asks the server at most once a
// minute.
export const UPDATE_CHECK_MS = 60_000;

// A failed background update is retried while the page stays visible: first after
// UPDATE_RETRY_MS, then after twice the previous wait, up to UPDATE_RETRY_MAX_MS.
export const UPDATE_RETRY_MS = 60_000;
export const UPDATE_RETRY_MAX_MS = 15 * 60_000;

// How long a completed first install waits for the router to control the page before reloading.
export const CONTROL_WAIT_MS = 10_000;

// A redeploy restarts an install on the new manifest; this bounds repeated restarts.
const MAX_RESTARTS = 3;

// The progress share held back until the active record is written.
const RECORD_SHARE = 0.01;

// Session keys: the build a launch reload targeted, and first-install progress carried across the
// reload that boots the new build.
export const LAUNCH_RELOAD_KEY = "game-kit:launch-reload";
export const LAUNCH_PROGRESS_KEY = "game-kit:launch-progress";

type FirstInstallFailure = LaunchFailure["reason"] | NetworkPlayNotice["reason"];

class LaunchError extends Error {
  readonly reason: FirstInstallFailure;

  constructor(reason: FirstInstallFailure, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LaunchError";
    this.reason = reason;
  }
}

function failureReason(error: unknown): FirstInstallFailure {
  const reason = (error as { reason?: unknown } | null)?.reason;
  return reason === "network" ||
    reason === "quota" ||
    reason === "verification" ||
    reason === "unsupported"
    ? reason
    : "network";
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
// the new build's cache under its logical URL with its digest header, hashing each copy once.
async function copyLegacyEntries(
  storage: LaunchStorage,
  context: { readonly policy: BuildPolicy; readonly store: BuildStore },
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
    await context.store.putFile(
      manifest.version,
      file.url,
      new Response(bytes, { headers, status: 200 }),
    );
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

// The router's registration options. updateViaCache "none" fetches each router update past the
// HTTP cache.
const ROUTER_REGISTRATION = { scope: "/", updateViaCache: "none" } as const;

// What registerRouter needs of navigator.serviceWorker.
export type RouterContainer = Pick<LaunchContainer, "register">;

// Registers the router from a site page, such as "/", that does not run the game launch, so an app
// installed from that page is served by the router, offline too once a launch has installed a
// build. Pass navigator.serviceWorker, which is undefined where the browser has no service
// workers. Resolves whether the router registered; a failure is logged, never thrown.
export async function registerRouter(
  container: RouterContainer | undefined,
  serviceWorkerUrl: string,
): Promise<boolean> {
  if (container === undefined) {
    return false;
  }
  try {
    await container.register(serviceWorkerUrl, ROUTER_REGISTRATION);
    return true;
  } catch (error) {
    console.warn("Service worker registration failed; the app may not open offline.", error);
    return false;
  }
}

// The browser's page, store and installer for policy, or undefined where the browser has no
// service workers or Cache Storage; the game then plays from the network.
export function browserLaunchContext(policy: BuildPolicy): LaunchContext | undefined {
  if (!("serviceWorker" in navigator) || typeof caches === "undefined") {
    return undefined;
  }
  let session: SessionLike | undefined;
  try {
    session = window.sessionStorage;
  } catch {
    session = undefined;
  }
  const page: LaunchPage = {
    container: navigator.serviceWorker,
    eventTarget: window,
    fetch: (input, init) => fetch(input, init),
    location: window.location,
    online: () => navigator.onLine,
    storage: {
      caches,
      indexedDB: typeof indexedDB === "undefined" ? undefined : indexedDB,
      manager: navigator.storage,
      session,
    },
    timers: {
      clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
      now: () => Date.now(),
      setTimeout: (callback, ms) => setTimeout(callback, ms),
    },
    visibility: document,
  };
  const store = createBuildStore({ caches, origin: window.location.origin }, policy);
  return { installBuild, page, policy, store };
}

// Call run() once at document boot. With no active build it installs the deployed build in the
// foreground and reports onProgress, or onFailure with a resuming retry, or onNetworkPlay where
// the device cannot install; each later launch tries the install again. With an active build it
// resolves "play" at once, then checks build.json at launch and on resume and stages a newer
// build in the background, retrying a failed staging while the page stays visible. Staging never
// activates: a staged build becomes active through Update now, requireNewer, or the router's
// promotion at the next launch navigation.
export function createLaunch(context: LaunchContext, options: LaunchOptions): Launch {
  const { page, policy, store } = context;
  const install = context.installBuild;
  const { session } = page.storage;
  const routerUrl = new URL(options.serviceWorkerUrl, page.location.href).href;
  const aborts = new AbortController();
  let disposed = false;
  let reloading = false;
  // The build this document runs, once run() resolves "play".
  let documentVersion: string | undefined;
  // The build this document booted from during a first install: the first pointer it reads. The
  // network served the document, so the page cannot name its build otherwise; the two come from
  // one deploy unless a deploy lands between the document's request and that read.
  let bootVersion: string | undefined;
  // The build the latest first-install attempt pinned.
  let installingVersion: string | undefined;
  let visible = page.visibility.visibilityState !== "hidden";
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
    cancelDiscovery();
    cancelRetry();
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
    const value = await fetchJson(BUILD_POINTER_URL, { cache: "no-store" });
    try {
      return parseBuildPointer(value);
    } catch {
      throw new LaunchError("verification", "Invalid build pointer");
    }
  };

  // The pinned manifest the pointer names, reduced to the files this device installs: from the
  // store when an earlier attempt saved it for the same sound format.
  const readPinnedManifest = async (pointer: BuildPointer): Promise<InstalledManifest> => {
    const saved = await store.readManifest(pointer.version);
    if (
      saved !== undefined &&
      saved.buildId === pointer.buildId &&
      saved.soundFormat === options.soundFormat
    ) {
      return saved;
    }
    const value = await fetchJson(pointer.manifest, {});
    let manifest: BuildManifest | undefined;
    try {
      manifest = parseBuildManifest(value);
    } catch {
      manifest = undefined;
    }
    if (manifest?.version !== pointer.version || manifest.buildId !== pointer.buildId) {
      throw new LaunchError("verification", `Invalid build manifest for ${pointer.version}`);
    }
    return installedManifest(options.soundFormat, manifest);
  };

  const register = () => page.container.register(options.serviceWorkerUrl, ROUTER_REGISTRATION);

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
  const installContext = {
    clearTimeout: (handle: unknown) => page.timers.clearTimeout(handle),
    fetch: page.fetch,
    now: () => page.timers.now(),
    origin: new URL(page.location.href).origin,
    policy,
    setTimeout: (handler: () => void, ms: number) => page.timers.setTimeout(handler, ms),
    storage: page.storage.manager,
    store,
  };

  // Records a launch reload into version and returns true, or returns false when the document
  // before this one already reloaded into it, so a launch reloads at most once per build. Without
  // session storage it always reloads: the reloaded document boots from that build, so it reloads
  // again only after another deploy.
  const claimReload = (version: string): boolean => {
    let target: string | null | undefined;
    try {
      target = session?.getItem(LAUNCH_RELOAD_KEY);
    } catch {
      target = undefined;
    }
    if (target === version) {
      return false;
    }
    writeSession(session, LAUNCH_RELOAD_KEY, version);
    return true;
  };

  const installDeployed = async (restarts: number): Promise<LaunchResult> => {
    const pointer = await readPointer();
    bootVersion ??= pointer.version;
    installingVersion = pointer.version;
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
    const result = await install(installContext, {
      ...FOREGROUND_INSTALL,
      manifest,
      onBytes: (receivedBytes, totalBytes) => {
        progress = {
          ...progress,
          received: copied + receivedBytes,
          total: copied + totalBytes,
        };
        report("installing", 0);
      },
      signal: aborts.signal,
    });
    if (result === "changed") {
      if (restarts + 1 >= MAX_RESTARTS) {
        throw new LaunchError("verification", "The deployed build kept changing during install");
      }
      return installDeployed(restarts + 1);
    }
    await store.saveManifest(manifest);
    const active = await withBuildStateLock(policy, async () => {
      const state = await store.readState();
      if (state.active === undefined) {
        await store.setActive(manifest.version);
      }
      return state.active ?? manifest.version;
    });
    if (active !== manifest.version) {
      // Another context installed or activated a build while this document was downloading.
      reload();
      return "reloading";
    }
    progress = { ...progress, received: progress.total, recorded: true };
    report("installing", 0);
    // CLEANUP (added 2026-11-18): remove once all three games deploy the router.
    await deleteLegacy(page.storage, policy).catch((error: unknown) =>
      console.warn("Could not delete legacy offline caches.", error),
    );
    // A controlled document plays the installed build only when it booted from it. A redeploy
    // mid-install activated a newer build, whose files this document does not reference, so it
    // reloads once into the router's active build.
    if (controlledByRouter()) {
      if (manifest.version === bootVersion || !claimReload(manifest.version)) {
        return play(manifest.version);
      }
    } else {
      await waitForRouter();
      if (disposed) {
        return "reloading";
      }
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

  // Retry startup from its storage read. Unsupported or quota errors from a first install
  // still fall back to network play.
  const launchUntilDone = (): Promise<LaunchResult> =>
    new Promise((resolve) => {
      const attempt = () => {
        launch().then(resolve, (error: unknown) => {
          if (disposed) {
            return;
          }
          const reason = failureReason(error);
          if (reason === "unsupported" || reason === "quota") {
            // The network now serves a newer build than this document's, so the document
            // reloads once to play that build.
            if (
              installingVersion !== undefined &&
              installingVersion !== bootVersion &&
              claimReload(installingVersion)
            ) {
              reload();
              resolve("reloading");
              return;
            }
            writeSession(session, LAUNCH_RELOAD_KEY, undefined);
            console.warn("First install failed; playing from the network.", error);
            try {
              options.onNetworkPlay({ reason });
            } catch (callbackError) {
              console.error("Network play callback failed.", callbackError);
            }
            resolve("play");
            return;
          }
          console.warn("Launch failed.", error);
          let retried = false;
          const failure: LaunchFailure = {
            reason,
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

  // K4 reclaim and legacy cleanup, then the launch update check. Reclaim keeps the active and
  // staged builds, each build a live window's pin names and this document's build.
  const afterLaunch = async () => {
    try {
      await withBuildStateLock(policy, () =>
        store.reclaim(documentVersion === undefined ? [] : [documentVersion]),
      );
    } catch (error) {
      console.warn("Could not reclaim unused builds.", error);
    }
    // CLEANUP (added 2026-11-18): remove once all three games deploy the router.
    await deleteLegacy(page.storage, policy).catch(() => undefined);
    discoveryReady = true;
    check(false);
  };

  // Background updates: discovery, staging and the in-session offer.
  let lastCheck: number | undefined;
  let discoveryReady = false;
  let discoveryTimer: unknown;
  // The wait before the next retry of a failed update; 0 while no failure is pending.
  let retryMs = 0;
  let retryTimer: unknown;
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

  const completeBuild = async (version: string): Promise<boolean> => {
    const manifest = await store.readManifest(version);
    return manifest !== undefined && (await store.complete(manifest));
  };

  // The caller holds the build-state lock and has just revalidated the staged version.
  const activate = async (version: string): Promise<void> => {
    await store.setActive(version);
    try {
      if ((await store.readState()).staged === version) {
        await store.setStaged(undefined);
      }
    } catch (error) {
      // The active write succeeded. The router can clear a matching staged entry on navigation.
      console.warn("Could not clear the activated staged build.", error);
    }
  };

  const updateNow = (
    activeAtOffer: string | undefined,
    version: string,
    save: () => void | PromiseLike<void>,
  ): Promise<void> => {
    switching ??= (async () => {
      await save();
      const offeredIsStaged = (state: BuildState) =>
        state.active === activeAtOffer && state.staged === version;
      const state = await store.readState();
      const verified = offeredIsStaged(state) && (await completeBuild(version));
      const accepted = await withBuildStateLock(policy, async () => {
        const current = await store.readState();
        if (disposed || reloading || required) {
          return false;
        }
        if (current.active === version) {
          return true;
        }
        if (!verified || !offeredIsStaged(current)) {
          return false;
        }
        await activate(version);
        return true;
      });
      if (!accepted) {
        throw new Error(`Build ${version} is no longer available for this update offer`);
      }
      if (!disposed && !reloading) {
        reload();
      }
    })().catch((error: unknown) => {
      switching = undefined;
      throw error;
    });
    return switching;
  };

  const offer = (activeAtOffer: string | undefined, version: string) => {
    if (required || offered.has(version) || disposed || reloading) {
      return;
    }
    offered.add(version);
    try {
      options.onUpdateReady({
        dismiss: () => undefined,
        updateNow: (save) => updateNow(activeAtOffer, version, save),
        version,
      });
    } catch (error) {
      console.error("Update ready callback failed.", error);
    }
  };

  // A download can finish after another context stages or activates a different build.
  const publishStaged = async (previous: BuildState, version: string): Promise<void> => {
    const published = await withBuildStateLock(policy, async () => {
      const current = await store.readState();
      if (
        disposed ||
        reloading ||
        current.active === version ||
        current.active !== previous.active ||
        (current.staged !== previous.staged && current.staged !== version)
      ) {
        return false;
      }
      if (current.staged !== version) {
        await store.setStaged(version);
      }
      return true;
    });
    if (published) {
      reportUpdate({ phase: "ready", version });
      offer(previous.active, version);
    } else {
      reportUpdate({ phase: "idle" });
    }
  };

  // Stages the build the pointer names; a redeploy mid-staging restarts on the new manifest.
  // Records in attempt the version it tries, so a failure can name it.
  const stageDeployed = async (restarts: number, attempt: { version?: string }): Promise<void> => {
    const state = await store.readState();
    const pointer = await readPointer();
    if (pointer.version === documentVersion || pointer.version === state.active) {
      // The deployed build is already running; a staged one would roll it back.
      if (state.staged !== undefined && state.staged !== pointer.version) {
        await withBuildStateLock(policy, async () => {
          const current = await store.readState();
          if (current.active === state.active && current.staged === state.staged) {
            await store.setStaged(undefined);
          }
        });
      }
      reportUpdate({ phase: "idle" });
      return;
    }
    const { version } = pointer;
    attempt.version = version;
    const manifest = await readPinnedManifest(pointer);
    if (state.staged === version && (await store.complete(manifest))) {
      await publishStaged(state, version);
      return;
    }
    await store.saveManifest(manifest);
    reportUpdate({ phase: "staging", value: 0, version });
    const result = await install(installContext, {
      ...(required ? FOREGROUND_INSTALL : BACKGROUND_INSTALL),
      manifest,
      onBytes: (receivedBytes, totalBytes) => {
        const value = totalBytes > 0 ? Math.min(1, receivedBytes / totalBytes) : 0;
        reportUpdate({ phase: "staging", value, version });
      },
      // An update waits while the page is hidden, and resumes when it comes back into view.
      paused: () => !visible,
      signal: aborts.signal,
    });
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
    await publishStaged(state, version);
  };

  const stage = async () => {
    const attempt: { version?: string } = {};
    try {
      await stageDeployed(0, attempt);
      retryMs = 0;
      cancelRetry();
    } catch (error) {
      if (disposed) {
        return;
      }
      // K3: a failed update is retried while the page stays visible and at the next check, and
      // never shows Loading failed.
      console.warn("Background update failed.", error);
      if (attempt.version !== undefined) {
        reportUpdate({ phase: "failed", version: attempt.version });
      }
      retryMs = retryMs === 0 ? UPDATE_RETRY_MS : Math.min(retryMs * 2, UPDATE_RETRY_MAX_MS);
      armRetry();
    }
  };

  const cancelRetry = () => {
    if (retryTimer !== undefined) {
      page.timers.clearTimeout(retryTimer);
      retryTimer = undefined;
    }
  };

  const cancelDiscovery = () => {
    if (discoveryTimer !== undefined) {
      page.timers.clearTimeout(discoveryTimer);
      discoveryTimer = undefined;
    }
  };

  // Schedules the pending retry while the page is visible. A retry that cannot start, as when
  // the device is offline, waits twice as long for the next one.
  const armRetry = () => {
    cancelRetry();
    if (retryMs === 0 || !visible || disposed || reloading) {
      return;
    }
    retryTimer = page.timers.setTimeout(() => {
      retryTimer = undefined;
      if (!check(true)) {
        retryMs = Math.min(retryMs * 2, UPDATE_RETRY_MAX_MS);
        armRetry();
      }
    }, retryMs);
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
    cancelDiscovery();
    lastCheck = now;
    staging = stage().finally(() => {
      staging = undefined;
      advanceRequired(false);
    });
    return true;
  };

  // Resume, reconnect and caller requests share one ordinary wake. Failed attempts keep their own backoff.
  const canDiscover = () =>
    discoveryReady &&
    visible &&
    page.online() &&
    !required &&
    !disposed &&
    !reloading &&
    retryMs === 0 &&
    staging === undefined;

  const discoverOnWake = () => {
    if (!canDiscover()) {
      return;
    }
    const remaining =
      lastCheck === undefined ? 0 : UPDATE_CHECK_MS - (page.timers.now() - lastCheck);
    if (remaining <= 0) {
      check(false);
    } else if (discoveryTimer === undefined) {
      discoveryTimer = page.timers.setTimeout(() => {
        discoveryTimer = undefined;
        if (canDiscover()) {
          check(false);
        }
      }, remaining);
    }
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
      const { staged } = state;
      const verified =
        (state.active === undefined || state.active === documentVersion) &&
        staged !== undefined &&
        staged !== documentVersion &&
        (await completeBuild(staged));
      const activated = await withBuildStateLock(policy, async () => {
        const current = await store.readState();
        if (disposed || reloading) {
          return false;
        }
        if (current.active !== undefined && current.active !== documentVersion) {
          // Another context already activated a newer build.
          return true;
        }
        if (!verified || current.active !== state.active || current.staged !== staged) {
          return false;
        }
        await activate(staged);
        return true;
      });
      if (activated && !disposed && !reloading) {
        reportRequired("updating");
        reload();
        return;
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
        cancelDiscovery();
        cancelRetry();
        return;
      }
      if (required || retryMs !== 0) {
        if (!check(false)) {
          armRetry();
        }
      } else {
        discoverOnWake();
      }
      advanceRequired(true);
    }),
  );
  const online = () => {
    if (required) {
      advanceRequired(true);
    } else {
      discoverOnWake();
    }
  };
  page.eventTarget.addEventListener("online", online);
  page.eventTarget.addEventListener("offline", cancelDiscovery);
  cleanups.push(() => page.eventTarget.removeEventListener("online", online));
  cleanups.push(() => page.eventTarget.removeEventListener("offline", cancelDiscovery));

  const readStartup = async () => {
    const state = await store.readState();
    const { active, staged } = state;
    // A verified staged build may still need one reload into the router.
    if (
      active !== undefined &&
      staged !== undefined &&
      staged !== active &&
      session !== undefined
    ) {
      let target: string | null;
      try {
        target = session.getItem(LAUNCH_RELOAD_KEY);
      } catch {
        target = staged;
      }
      const manifest = target === staged ? undefined : await store.readManifest(staged);
      if (manifest !== undefined && (await store.complete(manifest))) {
        return { reloadVersion: staged, state };
      }
    }
    return { state };
  };

  const launch = async (): Promise<LaunchResult> => {
    const { reloadVersion, state } = await readStartup().catch((error: unknown) => {
      throw new LaunchError("verification", "Could not read stored build state", { cause: error });
    });
    if (state.active === undefined) {
      return firstInstall();
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
      // The bar keeps its value between the reload and the boot loader's first read.
      report("booting", 0);
    } else {
      progress = { ...progress, recorded: true };
      writeSession(session, LAUNCH_PROGRESS_KEY, undefined);
    }
    if (reloadVersion !== undefined) {
      writeSession(session, LAUNCH_RELOAD_KEY, reloadVersion);
      reload();
      return "reloading";
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
      cancelDiscovery();
      cancelRetry();
      aborts.abort();
      for (const cleanup of cleanups.splice(0)) {
        cleanup();
      }
    },
    requestUpdateCheck: discoverOnWake,
    requireNewer() {
      if (!required) {
        required = true;
        cancelDiscovery();
        advanceRequired(true);
      }
    },
    run() {
      running ??= launchUntilDone();
      return running;
    },
  };
}
