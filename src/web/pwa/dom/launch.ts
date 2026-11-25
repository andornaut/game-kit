// The one loader: registers the router worker, installs the first build in the foreground under the
// loading screen, stages later builds in the background and offers Update now during a session
// (docs/install-and-update.md). The page drives every download; the router only serves the
// recorded active build or a window's pin.
import {
  type LoadingFailureLayout,
  type LoadingFailurePresentation,
  type LoadingFailurePresentationView,
  type LoadingFailureView,
  mountLoadingFailure,
} from "../../progress/dom/loadingFailure.ts";
import {
  BUILD_POINTER_URL,
  type BuildArchiveReference,
  type BuildManifest,
  type BuildPointer,
  type BuildPolicy,
  type BuildState,
  type InstalledManifest,
  type LaunchFailure,
  type LaunchProgress,
  type LaunchResult,
  type NetworkPlayNotice,
  ObsoleteUpdateOfferError,
  type UpdateOffer,
  type UpdateState,
} from "../buildContract.ts";
import {
  installedManifest,
  installedPointer,
  parseBuildManifest,
  parseBuildPointer,
} from "../buildRecords.ts";
import { downloadBuildArchive } from "./buildArchiveDownload.ts";
import { BUILD_GROUP_ROUTER_PROBE, supportsBuildArchive } from "./buildArchiveRouter.ts";
import { type BuildArchiveStore, createBuildArchiveStore } from "./buildArchiveStore.ts";
import { type BuildGroupStore, createBuildGroupStore } from "./buildGroupStore.ts";
import { BACKGROUND_INSTALL, FOREGROUND_INSTALL, installBuild } from "./buildInstaller.ts";
import { type BuildStore, createBuildStore, withBuildStateLock } from "./buildStore.ts";
import { type VisibilitySource, watchVisibility } from "./visibility.ts";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

// The service worker container, as far as launch uses it.
export interface LaunchContainer extends EventTarget {
  readonly controller: {
    readonly scriptURL: string;
    postMessage?(message: string, transfer: MessagePort[]): void;
  } | null;
  register(url: string, options: { scope: string; updateViaCache: "none" }): Promise<unknown>;
}

export interface LaunchTimers {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

export type SessionLike = Pick<Storage, "getItem" | "removeItem" | "setItem">;

export interface LaunchStorage {
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
  readonly archiveStore?: BuildArchiveStore;
  readonly groupStore?: BuildGroupStore;
  readonly installBuild: typeof installBuild;
  readonly page: LaunchPage;
  // The game's cache policy, which scopes the store's caches.
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
const LAUNCH_RELOAD_KEY = "game-kit:launch-reload";
const LAUNCH_PROGRESS_KEY = "game-kit:launch-progress";

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
/** @deprecated Use prepareBrowserLaunch for production startup. */
export function browserLaunchContext(policy: BuildPolicy): LaunchContext | undefined {
  if (!("serviceWorker" in navigator) || typeof caches === "undefined") {
    return undefined;
  }
  return contextForBrowser(navigator.serviceWorker, caches, policy);
}

function contextForBrowser(
  container: ServiceWorkerContainer,
  caches: CacheStorage,
  policy: BuildPolicy,
): LaunchContext {
  let session: SessionLike | undefined;
  try {
    session = window.sessionStorage;
  } catch {
    session = undefined;
  }
  const page: LaunchPage = {
    container,
    eventTarget: window,
    fetch: (input, init) => fetch(input, init),
    location: window.location,
    online: () => navigator.onLine,
    storage: {
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
  const origin = window.location.origin;
  const store = createBuildStore({ caches, origin }, policy);
  const archiveStore = createBuildArchiveStore({ caches, origin, policy });
  const groupStore = createBuildGroupStore({ caches, origin, policy });
  return { archiveStore, groupStore, installBuild, page, policy, store };
}

type BrowserFailurePresentation = LoadingFailurePresentation<number | "content">;

export interface BrowserLaunchPreparation {
  readonly parent: HTMLElement;
  readonly onUnsupported: () => void;
  readonly failure?: {
    readonly layout?: LoadingFailureLayout;
    readonly presentation?: BrowserFailurePresentation;
  };
}

export type PreparedBrowserLaunch<View extends LoadingFailureView = LoadingFailureView> =
  | { readonly kind: "supported"; readonly context: LaunchContext }
  | { readonly kind: "unsupported"; readonly failure: View };

// Resolve capability before starting the installer or game. A missing browser API cannot
// recover through the installer's Retry. Retain the unsupported view for page teardown.
export function prepareBrowserLaunch(
  preparation: BrowserLaunchPreparation & {
    readonly failure: { readonly presentation: BrowserFailurePresentation };
  },
  policy: BuildPolicy,
): PreparedBrowserLaunch<LoadingFailurePresentationView>;
export function prepareBrowserLaunch(
  preparation: BrowserLaunchPreparation,
  policy: BuildPolicy,
): PreparedBrowserLaunch;
export function prepareBrowserLaunch(
  { failure, onUnsupported, parent }: BrowserLaunchPreparation,
  policy: BuildPolicy,
): PreparedBrowserLaunch {
  let container: ServiceWorkerContainer | undefined;
  let cacheStorage: CacheStorage | undefined;
  try {
    container = globalThis.navigator?.serviceWorker;
    cacheStorage = globalThis.caches;
  } catch {
    // Browsers can expose API accessors that throw in restricted contexts.
  }
  if (container !== undefined && cacheStorage !== undefined) {
    return { context: contextForBrowser(container, cacheStorage, policy), kind: "supported" };
  }
  try {
    onUnsupported();
  } catch (error) {
    console.error("Unsupported launch callback failed.", error);
  }
  const view = mountLoadingFailure(
    { ...failure, body: "This browser does not support the features needed to load the game." },
    parent,
  );
  view.update({ attempt: 0, error: undefined, kind: "failed" });
  return { failure: view, kind: "unsupported" };
}

// Call run() once at document boot. With no active build it installs the deployed build in the
// foreground and reports onProgress, or onFailure with a resuming retry, or onNetworkPlay where
// the device cannot install; each later launch tries the install again. With an active build it
// resolves "play" at once, then checks build.json at launch and on resume and stages a newer
// build in the background, retrying a failed staging while the page stays visible. Staging never
// activates: a staged build becomes active through Update now, requireNewer, or the router's
// promotion at the next launch navigation.
export function createLaunch(
  context: LaunchContext,
  options: LaunchOptions,
): Launch & {
  // Share ordinary discovery eligibility and cooldown with resume and reconnect.
  requestUpdateCheck(): void;
} {
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

  // The deployed pointer, its groups reduced to the ones this device installs.
  const readPointer = async (): Promise<BuildPointer> => {
    const value = await fetchJson(BUILD_POINTER_URL, { cache: "no-store" });
    try {
      return installedPointer(options.soundFormat, parseBuildPointer(value));
    } catch {
      throw new LaunchError("verification", "Invalid build pointer");
    }
  };

  const readDeployedManifest = async (pointer: BuildPointer): Promise<BuildManifest> => {
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
    return manifest;
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
    return installedManifest(options.soundFormat, await readDeployedManifest(pointer));
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
      const pointer = await readPointer().catch(() => undefined);
      throw new LaunchError(
        pointer?.groupedFirstInstall === true ? "verification" : "unsupported",
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
    if (pointer.groupedFirstInstall === true) {
      const result = await installGrouped(pointer).catch((error: unknown) => {
        const reason = failureReason(error);
        if (reason === "quota" || reason === "unsupported") {
          throw new LaunchError("verification", "Could not install the grouped build", {
            cause: error,
          });
        }
        throw error;
      });
      if (result !== "changed") {
        return result;
      }
      if (restarts + 1 >= MAX_RESTARTS) {
        throw new LaunchError("verification", "The deployed build kept changing during install");
      }
      return installDeployed(restarts + 1);
    }
    const manifest = await readPinnedManifest(pointer);
    progress = { ...progress, bootBytes: bootBytesOf(manifest), received: 0, total: 0 };
    const missingBytes = (await store.missing(manifest)).reduce(
      (sum, file) => sum + file.byteSize,
      0,
    );
    progress = { ...progress, total: missingBytes };
    report("installing", 0);
    const result = await install(installContext, {
      ...FOREGROUND_INSTALL,
      manifest,
      onBytes: (receivedBytes, totalBytes) => {
        progress = {
          ...progress,
          received: receivedBytes,
          total: totalBytes,
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

  // K4 reclaim, then the launch update check. Reclaim keeps the active and
  // staged builds, each build a live window's pin names and this document's build.
  const afterLaunch = async () => {
    try {
      await withBuildStateLock(policy, () =>
        store.reclaim(documentVersion === undefined ? [] : [documentVersion]),
      );
    } catch (error) {
      console.warn("Could not reclaim unused builds.", error);
    }
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

  const archiveRouterReady = async (probe?: string) => {
    const controller = page.container.controller;
    if (
      controller?.scriptURL !== routerUrl ||
      controller.postMessage === undefined ||
      typeof MessageChannel === "undefined"
    ) {
      return false;
    }
    const ready = await supportsBuildArchive(
      {
        clearTimeout: (handle) => page.timers.clearTimeout(handle),
        setTimeout: (callback, ms) => page.timers.setTimeout(callback, ms),
        signal: aborts.signal,
      },
      CONTROL_WAIT_MS,
      { postMessage: (message, transfer) => controller.postMessage!(message, transfer) },
      probe,
    );
    return ready && page.container.controller === controller;
  };

  const completeBuild = async (version: string): Promise<boolean> => {
    const grouped = await context.groupStore?.read(version);
    if (grouped !== undefined && grouped.kind !== "unknown") {
      return grouped.kind === "ready" && (await archiveRouterReady(BUILD_GROUP_ROUTER_PROBE));
    }
    if ((await context.archiveStore?.complete(version)) === true && (await archiveRouterReady())) {
      return true;
    }
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
        if (!offeredIsStaged(current)) {
          throw new ObsoleteUpdateOfferError(version);
        }
        if (!verified) {
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
  const publishStaged = async (
    previous: BuildState,
    version: string,
    pointer?: BuildPointer,
  ): Promise<void> => {
    const published = await withBuildStateLock(policy, async () => {
      if (
        (pointer?.archive !== undefined &&
          !(await context.archiveStore?.complete(version, pointer))) ||
        (pointer?.groups !== undefined && !(await context.groupStore?.complete(version, pointer)))
      ) {
        return false;
      }
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

  let resumeArchiveTransfer: (() => void) | undefined;
  const waitForArchiveTransfer = (signal: AbortSignal): Promise<void> => {
    if (visible || signal.aborted) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const resume = () => {
        signal.removeEventListener("abort", resume);
        resumeArchiveTransfer = undefined;
        resolve();
      };
      resumeArchiveTransfer = resume;
      signal.addEventListener("abort", resume, { once: true });
    });
  };

  const downloadArchive = (
    archive: BuildArchiveReference,
    onBytes: (received: number, total: number) => void,
    foregroundFetch?: FetchLike,
  ) =>
    downloadBuildArchive(
      {
        ...(foregroundFetch === undefined ? { beforePart: waitForArchiveTransfer } : {}),
        clearTimeout: installContext.clearTimeout,
        fetch: foregroundFetch ?? installContext.fetch,
        inactivityMs: FOREGROUND_INSTALL.inactivityMs,
        now: installContext.now,
        onBytes,
        setTimeout: installContext.setTimeout,
        signal: aborts.signal,
      },
      archive,
    );

  const stageArchive = async (
    pointer: BuildPointer,
    state: BuildState,
  ): Promise<"complete" | "changed"> => {
    const archiveStore = context.archiveStore;
    const { archive, version } = pointer;
    if (archiveStore === undefined || archive === undefined || !(await archiveRouterReady())) {
      throw new LaunchError("verification", "The controlling worker cannot serve build archives");
    }
    if (!(await archiveStore.complete(version, pointer))) {
      reportUpdate({ phase: "staging", value: 0, version });
      const body = await downloadArchive(archive, (received, total) =>
        reportUpdate({ phase: "staging", value: received / total, version }),
      );
      // A content-addressed transfer can finish even after a later release deploys.
      const deployed = await readPointer();
      if (deployed.version !== version || deployed.archive?.sha256 !== archive.sha256) {
        return "changed";
      }
      await archiveStore.put(pointer, body, aborts.signal);
    }
    await publishStaged(state, version, pointer);
    return "complete";
  };

  const requireGroupRouter = async () => {
    if (!(await archiveRouterReady(BUILD_GROUP_ROUTER_PROBE))) {
      throw new LaunchError("verification", "The controlling worker cannot serve grouped builds");
    }
  };

  const prepareGroups = async (
    pointer: BuildPointer,
    onBytes: (received: number, total: number) => void,
    foreground = false,
  ): Promise<"complete" | "changed"> => {
    const { groupStore } = context;
    const { groups, version } = pointer;
    if (groupStore === undefined || groups === undefined) {
      throw new LaunchError("verification", "Grouped build storage unavailable");
    }
    const stillDeployed = (deployed: BuildPointer) =>
      deployed.version === version &&
      deployed.buildId === pointer.buildId &&
      deployed.groupedFirstInstall === pointer.groupedFirstInstall &&
      deployed.groups?.length === groups.length &&
      groups.every(
        ({ byteSize, sha256 }, index) =>
          deployed.groups?.[index]?.byteSize === byteSize &&
          deployed.groups?.[index]?.sha256 === sha256,
      );
    const alreadySealed = await groupStore.complete(version, pointer);
    if (!alreadySealed) {
      const missing: BuildArchiveReference[] = [];
      for (const group of groups) {
        aborts.signal.throwIfAborted();
        // Limit storage work and downloads to one bounded group at a time.
        // eslint-disable-next-line no-await-in-loop
        if (!(await groupStore.reuse(pointer, group))) {
          missing.push(group);
        }
      }
      const total = missing.reduce((bytes, group) => bytes + group.byteSize, 0);
      let received = 0;
      if (total > 0 || foreground) {
        onBytes(0, total);
      }
      for (const group of missing) {
        let fetchFailed = false;
        const foregroundFetch: FetchLike | undefined = foreground
          ? async (url, init) => {
              const response = await installContext.fetch(url, init).catch((error: unknown) => {
                fetchFailed = true;
                throw error;
              });
              fetchFailed = response.status !== 200;
              return response;
            }
          : undefined;
        try {
          // eslint-disable-next-line no-await-in-loop
          const body = await downloadArchive(
            group,
            (bytes) => onBytes(received + bytes, total),
            foregroundFetch,
          );
          // eslint-disable-next-line no-await-in-loop
          await groupStore.put(pointer, group, body, aborts.signal);
        } catch (error) {
          if (fetchFailed && !aborts.signal.aborted) {
            // The old part may have disappeared during a current-only deployment.
            // eslint-disable-next-line no-await-in-loop
            const deployed = await readPointer().catch(() => undefined);
            if (deployed !== undefined && !stillDeployed(deployed) && !aborts.signal.aborted) {
              return "changed";
            }
          }
          throw error;
        }
        received += group.byteSize;
      }
    }
    if ((!alreadySealed || foreground) && !stillDeployed(await readPointer())) {
      return "changed";
    }
    if (!alreadySealed) {
      await groupStore.seal(pointer, aborts.signal);
    }
    return "complete";
  };

  // Every stored member is a deployed file of its size, and every file this device installs is
  // stored. Groups without a sound format, such as an earlier kit's, may also hold left-out
  // alternatives.
  const verifyGroupedManifest = async (deployed: BuildManifest) => {
    const grouped = await context.groupStore?.read(deployed.version);
    if (grouped?.kind !== "ready") {
      throw new LaunchError("verification", "Grouped build members do not match the manifest");
    }
    const sizes = new Map(deployed.files.map(({ byteSize, url }) => [url, byteSize]));
    for (const [url, { byteSize }] of grouped.files) {
      if (sizes.get(url) !== byteSize) {
        throw new LaunchError("verification", `Grouped build member does not match ${url}`);
      }
    }
    for (const { url } of installedManifest(options.soundFormat, deployed).files) {
      if (!grouped.files.has(url)) {
        throw new LaunchError("verification", `Grouped build member is missing for ${url}`);
      }
    }
  };

  const installGrouped = async (pointer: BuildPointer): Promise<"reloading" | "changed"> => {
    const { version } = pointer;
    await waitForRouter();
    aborts.signal.throwIfAborted();
    await requireGroupRouter();
    const manifest = await readDeployedManifest(pointer);
    progress = {
      ...progress,
      bootBytes: bootBytesOf(installedManifest(options.soundFormat, manifest)),
      received: 0,
      total: 0,
    };
    const result = await prepareGroups(
      pointer,
      (received, total) => {
        progress = { ...progress, received, total };
        report("installing", 0);
      },
      true,
    );
    if (result === "changed") {
      return result;
    }
    await verifyGroupedManifest(manifest);
    const active = await withBuildStateLock(policy, async () => {
      const state = await store.readState();
      if (state.active !== undefined) {
        return state.active;
      }
      if (
        !(await context.groupStore?.complete(version, pointer)) ||
        !(await archiveRouterReady(BUILD_GROUP_ROUTER_PROBE))
      ) {
        throw new LaunchError("verification", "Could not activate the sealed grouped build");
      }
      aborts.signal.throwIfAborted();
      await store.setActive(version);
      return version;
    });
    if (disposed) {
      return "reloading";
    }
    if (active === version) {
      progress = { ...progress, received: progress.total, recorded: true };
      report("installing", 0);
      writeSession(
        session,
        LAUNCH_PROGRESS_KEY,
        JSON.stringify({
          bootBytes: progress.bootBytes,
          receivedBytes: progress.total,
          version,
        } satisfies ProgressCarry),
      );
    }
    // Bootstrap has no pin yet. The new navigation obtains the active build and its pin together.
    reload();
    return "reloading";
  };

  const stageGroups = async (pointer: BuildPointer, state: BuildState) => {
    await requireGroupRouter();
    const manifest = await readDeployedManifest(pointer);
    const result = await prepareGroups(pointer, (received, total) =>
      reportUpdate({ phase: "staging", value: received / total, version: pointer.version }),
    );
    if (result === "complete") {
      await verifyGroupedManifest(manifest);
      await publishStaged(state, pointer.version, pointer);
    }
    return result;
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
    if (pointer.archive !== undefined || pointer.groups !== undefined) {
      const result =
        pointer.groups !== undefined
          ? await stageGroups(pointer, state)
          : await stageArchive(pointer, state);
      if (result === "changed") {
        if (restarts + 1 >= MAX_RESTARTS) {
          throw new LaunchError("verification", "The deployed build kept changing during staging");
        }
        await stageDeployed(restarts + 1, attempt);
      }
      return;
    }
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

  // Resume, focus, reconnect and caller requests share one ordinary wake.
  // Failed attempts keep their own backoff.
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
      resumeArchiveTransfer?.();
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
  page.eventTarget.addEventListener("focus", discoverOnWake);
  cleanups.push(() => page.eventTarget.removeEventListener("online", online));
  cleanups.push(() => page.eventTarget.removeEventListener("offline", cancelDiscovery));
  cleanups.push(() => page.eventTarget.removeEventListener("focus", discoverOnWake));

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
      if (target !== staged && (await completeBuild(staged))) {
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
