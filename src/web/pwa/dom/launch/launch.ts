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
} from "../../../progress/dom/index.ts";
import type { ForegroundInput } from "../../../ui/dom/foregroundInput.ts";
import {
  bootBytesOf,
  BUILD_POINTER_URL,
  type BuildArchiveReference,
  type BuildGroupReference,
  type BuildManifest,
  type BuildPointer,
  type BuildPolicy,
  type BuildState,
  canPublishStaged,
  failureReason,
  type InstalledManifest,
  installedManifest,
  installedPointer,
  isBuildVersion,
  LaunchError,
  type LaunchFailure,
  type LaunchProgress,
  launchProgress,
  type LaunchResult,
  type NetworkPlayNotice,
  nextUpdateRetryMs,
  ObsoleteUpdateOfferError,
  parseBuildManifest,
  parseBuildPointer,
  parseProgressCarry,
  progressCarryText,
  type ProgressCounts,
  requiredUpdateCandidate,
  sameUpdateState,
  updateCheckWait,
  type UpdateOffer,
  type UpdateState,
} from "../../index.ts";
import {
  BUILD_GROUP_REPAIR_ROUTER_PROBE,
  BUILD_GROUP_ROUTER_PROBE,
  supportsBuildArchive,
} from "../routing/buildArchiveRouter.ts";
import { type BuildArchiveStore, createBuildArchiveStore } from "../storage/buildArchiveStore.ts";
import { type BuildGroupStore, createBuildGroupStore } from "../storage/buildGroupStore.ts";
import { type BuildStore, createBuildStore, withBuildStateLock } from "../storage/buildStore.ts";
import { downloadBuildArchive, downloadBuildGroup } from "../transfer/buildArchiveDownload.ts";
import {
  BACKGROUND_INSTALL,
  FOREGROUND_INSTALL,
  installBuild,
} from "../transfer/buildInstaller.ts";
import { type VisibilitySource, watchVisibility } from "../visibility.ts";
import {
  type GroupedInstallContext,
  type GroupedStagingContext,
  installGrouped,
  type LaunchGroupsContext,
  recoverActiveGroups,
  stageGroups,
} from "./launchGroups.ts";

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

export type UpdateProgress =
  | { readonly phase: "idle" }
  | { readonly phase: "preparing"; readonly version: string }
  | { readonly phase: "verifying"; readonly version: string }
  | { readonly phase: "ready"; readonly version: string }
  | { readonly phase: "failed"; readonly version: string }
  | { readonly phase: "applied"; readonly version: string }
  | { readonly phase: "applyFailed"; readonly version: string }
  | {
      readonly phase: "transferring";
      readonly version: string;
      readonly receivedBytes: number;
      readonly totalBytes: number;
    }
  | {
      readonly phase: "applying";
      readonly version: string;
      readonly step: "save" | "verify" | "activate" | "reload";
    }
  | {
      readonly phase: "booting";
      readonly version: string;
      readonly counts?: { readonly done: number; readonly total: number };
    };

export interface LaunchOptions {
  readonly onFailure: (failure: LaunchFailure) => void;
  // A first install this device cannot complete: called once before run() resolves "play", and
  // the game plays from the network. The game shows its own notice.
  readonly onNetworkPlay: (notice: NetworkPlayNotice) => void;
  readonly onProgress: (progress: LaunchProgress) => void;
  // Reported only after requireNewer().
  readonly onRequireNewer?: (state: RequiredUpdateState) => void;
  // Alternative progress reporting for staging and explicit Apply. The offered build version
  // identifies Apply across documents. The new document renders its own progress view.
  readonly onUpdateProgress?: (progress: UpdateProgress) => void;
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

export { UPDATE_CHECK_MS, UPDATE_RETRY_MAX_MS, UPDATE_RETRY_MS } from "../../index.ts";

// How long a completed first install waits for the router to control the page before reloading.
export const CONTROL_WAIT_MS = 10_000;

// A redeploy restarts an install on the new manifest; this bounds repeated restarts.
const MAX_RESTARTS = 3;

// Session keys: the build a launch reload targeted, and first-install progress carried across the
// reload that boots the new build.
const LAUNCH_RELOAD_KEY = "game-kit:launch-reload";
const LAUNCH_PROGRESS_KEY = "game-kit:launch-progress";

function readSession(session: SessionLike | undefined, key: string): string | null | undefined {
  try {
    return session?.getItem(key);
  } catch {
    return undefined;
  }
}

function takeUpdateCarry(
  session: SessionLike | undefined,
  text: string | null | undefined,
): string | undefined {
  if (session === undefined || text == null) {
    return undefined;
  }
  try {
    const record: { updateVersion?: unknown } | null = JSON.parse(text);
    const version = record?.updateVersion;
    if (typeof version === "string" && isBuildVersion(version)) {
      // If the marker cannot be consumed, ordinary boot progress is safe on every reload.
      session.removeItem(LAUNCH_PROGRESS_KEY);
      return version;
    }
  } catch {
    // Session storage is optional.
  }
  return undefined;
}

// Calls a game callback, logging instead of propagating its failure.
function notify(label: string, callback: () => void): void {
  try {
    callback();
  } catch (error) {
    console.error(`${label} callback failed.`, error);
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

// The browser's page, store and installer for policy, once prepareBrowserLaunch has found the
// service worker container and Cache Storage.
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
    readonly foregroundInput?: ForegroundInput;
    readonly layout?: LoadingFailureLayout;
    readonly presentation?: BrowserFailurePresentation;
  };
}

export type PreparedBrowserLaunch<View extends LoadingFailureView = LoadingFailureView> =
  | { readonly kind: "supported"; readonly context: LaunchContext }
  | { readonly kind: "unsupported"; readonly failure: View };

// Resolve capability before starting the installer or game. A missing browser API cannot
// recover through the installer's Retry. Retain the unsupported view for page teardown.
// DecompressionStream is required on every launch, not only for grouped builds: grouped installs
// cannot decode their groups without it, the pointer that marks a build as grouped is read only
// later, and every browser in Vite's default build target provides it.
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
  let decompression: unknown;
  try {
    container = globalThis.navigator?.serviceWorker;
    cacheStorage = globalThis.caches;
    decompression = globalThis.DecompressionStream;
  } catch {
    // Browsers can expose API accessors that throw in restricted contexts.
  }
  if (
    container !== undefined &&
    cacheStorage !== undefined &&
    typeof decompression === "function"
  ) {
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
// plays after any optional codec repair, then checks build.json at launch and on resume and stages a newer
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

  // First-install progress (launchRules' launchProgress).
  let progress: ProgressCounts = { bootBytes: 0, received: 0, recorded: false, total: 0 };
  let lastValue = 0;
  let ready = false;
  let bootingUpdate: string | undefined;
  const reportUpdateProgress = (next: UpdateProgress) => {
    notify("Update progress", () => options.onUpdateProgress?.(next));
  };
  const report = (phase: LaunchProgress["phase"], bootFraction: number) => {
    const next = launchProgress(progress, lastValue, phase, bootFraction);
    lastValue = next.value;
    notify("Launch progress", () => options.onProgress(next));
  };
  // The active record is written: report it and keep the progress for the launch reload.
  const recordProgress = (version: string, carry: boolean) => {
    progress = { ...progress, received: progress.total, recorded: true };
    report("installing", 0);
    if (carry) {
      carryProgress(version);
    }
  };
  const carryProgress = (version: string) =>
    writeSession(
      session,
      LAUNCH_PROGRESS_KEY,
      progressCarryText({ bootBytes: progress.bootBytes, receivedBytes: progress.total, version }),
    );

  // A redeploy restarts an install or staging on the new manifest, at most MAX_RESTARTS times.
  const nextRestart = (restarts: number, during: "install" | "staging"): number => {
    if (restarts + 1 >= MAX_RESTARTS) {
      throw new LaunchError("verification", `The deployed build kept changing during ${during}`);
    }
    return restarts + 1;
  };

  const reload = () => {
    reloading = true;
    cancelDiscovery();
    cancelRetry();
    cancelEarlyPointer();
    aborts.abort();
    page.location.reload();
  };

  const fetchJson = async (
    url: string,
    init: RequestInit,
    onNotFound?: () => void,
  ): Promise<unknown> => {
    let response: Response;
    try {
      response = await page.fetch(url, init);
    } catch {
      throw new LaunchError("network", `Could not fetch ${url}`);
    }
    if (!response.ok) {
      if (response.status === 404) {
        onNotFound?.();
      }
      throw new LaunchError("network", `Could not fetch ${url}: ${response.status}`);
    }
    try {
      return await response.json();
    } catch {
      throw new LaunchError("verification", `Invalid JSON at ${url}`);
    }
  };

  // The deployed pointer, its groups reduced to the ones this device installs.
  const readPointer = async (signal?: AbortSignal): Promise<BuildPointer> => {
    const value = await fetchJson(BUILD_POINTER_URL, {
      cache: "no-store",
      ...(signal === undefined ? {} : { signal }),
    });
    try {
      return installedPointer(options.soundFormat, parseBuildPointer(value));
    } catch {
      throw new LaunchError("verification", "Invalid build pointer");
    }
  };

  // A manifest URL can serve a cacheable 404 before the build becomes visible. The next read
  // of that URL bypasses the HTTP cache and can still populate it with the immutable response.
  let missingManifest: string | undefined;
  const readDeployedManifest = async (
    pointer: BuildPointer,
    signal?: AbortSignal,
  ): Promise<BuildManifest> => {
    const value = await fetchJson(
      pointer.manifest,
      {
        cache: missingManifest === pointer.manifest ? "reload" : "default",
        ...(signal === undefined ? {} : { signal }),
      },
      () => {
        missingManifest = pointer.manifest;
      },
    );
    let manifest: BuildManifest | undefined;
    try {
      manifest = parseBuildManifest(value);
    } catch {
      manifest = undefined;
    }
    if (manifest?.version !== pointer.version || manifest.buildId !== pointer.buildId) {
      throw new LaunchError("verification", `Invalid build manifest for ${pointer.version}`);
    }
    if (missingManifest === pointer.manifest) {
      missingManifest = undefined;
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
      const result = await installGrouped(groupedInstall, pointer).catch((error: unknown) => {
        const reason = failureReason(error);
        if (reason === "quota" || reason === "unsupported") {
          throw new LaunchError("verification", "Could not install the grouped build", {
            cause: error,
          });
        }
        throw error;
      });
      return result === "changed" ? installDeployed(nextRestart(restarts, "install")) : result;
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
      return installDeployed(nextRestart(restarts, "install"));
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
    recordProgress(manifest.version, false);
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
    carryProgress(manifest.version);
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
            notify("Network play", () => options.onNetworkPlay({ reason }));
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
          notify("Launch failure", () => options.onFailure(failure));
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

  // Discovery can read ahead, but staging waits for K4 reclaim. Reclaim keeps the active and
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
    if (required) {
      advanceRequired(true);
    } else if (visible || !earlyPointerStarted) {
      check(false);
    }
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

  // Only the initial discovery attempt can consume this observation. No staged or active
  // metadata is touched by the read, and cancellation also invalidates a settled observation.
  let earlyPointerStarted = false;
  let earlyPointer:
    | {
        readonly startup: BuildState;
        readonly started: number;
        readonly result: Promise<BuildPointer>;
        readonly request: AbortController;
      }
    | undefined;
  const cancelEarlyPointer = () => {
    earlyPointer?.request.abort();
    earlyPointer = undefined;
  };
  const startEarlyPointer = (startup: BuildState) => {
    earlyPointerStarted = true;
    const request = new AbortController();
    const timer = page.timers.setTimeout(() => request.abort(), CONTROL_WAIT_MS);
    const result = new Promise<BuildPointer>((resolve, reject) => {
      const abort = () => reject(new LaunchError("network", "Installed update check interrupted"));
      request.signal.addEventListener("abort", abort, { once: true });
      void readPointer(request.signal).then(resolve, reject);
    }).finally(() => page.timers.clearTimeout(timer));
    // Discovery may not yet be waiting when the request fails.
    void result.catch(() => undefined);
    earlyPointer = { request, result, started: page.timers.now(), startup };
  };

  const reportTransfer = (version: string, receivedBytes: number, totalBytes: number) => {
    if (totalBytes > 0 && options.onUpdateProgress !== undefined) {
      reportUpdateProgress({ phase: "transferring", receivedBytes, totalBytes, version });
    }
  };
  const reportUpdate = (next: UpdateState) => {
    if (sameUpdateState(next, updateState)) {
      return;
    }
    updateState = next;
    notify("Update state", () => options.onUpdateState(next));
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
        probe,
        setTimeout: (callback, ms) => page.timers.setTimeout(callback, ms),
        signal: aborts.signal,
        timeoutMs: CONTROL_WAIT_MS,
      },
      { postMessage: (message, transfer) => controller.postMessage!(message, transfer) },
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
    const applying = (step: "save" | "verify" | "activate" | "reload") =>
      reportUpdateProgress({ phase: "applying", step, version });
    let carried = false;
    switching ??= (async () => {
      // Publish the shared switch promise before an opt-in progress callback can reenter.
      if (options.onUpdateProgress !== undefined) {
        await Promise.resolve();
      }
      applying("save");
      await save();
      applying("verify");
      const offeredIsStaged = (state: BuildState) =>
        state.active === activeAtOffer && state.staged === version;
      const state = await store.readState();
      const verified = offeredIsStaged(state) && (await completeBuild(version));
      applying("activate");
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
        applying("reload");
      }
      if (disposed || reloading || required) {
        reportUpdateProgress({ phase: "applyFailed", version });
        return;
      }
      if (options.onUpdateProgress !== undefined) {
        writeSession(session, LAUNCH_PROGRESS_KEY, JSON.stringify({ updateVersion: version }));
        carried = true;
      }
      reload();
    })().catch((error: unknown) => {
      if (carried) {
        writeSession(session, LAUNCH_PROGRESS_KEY, undefined);
      }
      reportUpdateProgress({ phase: "applyFailed", version });
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
    notify("Update ready", () =>
      options.onUpdateReady({
        dismiss: () => undefined,
        updateNow: (save) => updateNow(activeAtOffer, version, save),
        version,
      }),
    );
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
      if (disposed || reloading || !canPublishStaged(previous, current, version)) {
        return false;
      }
      if (current.staged !== version) {
        await store.setStaged(version);
      }
      return true;
    });
    if (published) {
      reportUpdate({ phase: "ready", version });
      if (!disposed && !reloading) {
        reportUpdateProgress({ phase: "ready", version });
      }
      offer(previous.active, version);
    } else {
      reportUpdate({ phase: "idle" });
      if (!disposed && !reloading) {
        reportUpdateProgress({ phase: "idle" });
      }
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

  const archiveDownload = (
    onBytes: (received: number, total: number) => void,
    foregroundFetch?: FetchLike,
  ) => ({
    ...(foregroundFetch === undefined ? { beforePart: waitForArchiveTransfer } : {}),
    clearTimeout: installContext.clearTimeout,
    fetch: foregroundFetch ?? installContext.fetch,
    inactivityMs: FOREGROUND_INSTALL.inactivityMs,
    now: installContext.now,
    onBytes,
    setTimeout: installContext.setTimeout,
    signal: aborts.signal,
  });
  const downloadArchive = (
    archive: BuildArchiveReference,
    onBytes: (received: number, total: number) => void,
  ) => downloadBuildArchive(archiveDownload(onBytes), archive);
  // Downloads a group's transport and returns its verified decoded archive.
  const downloadGroup = (
    group: BuildGroupReference,
    onBytes: (received: number, total: number) => void,
    foregroundFetch?: FetchLike,
  ) => downloadBuildGroup(archiveDownload(onBytes, foregroundFetch), group);

  const stageArchive = async (
    pointer: BuildPointer,
    state: BuildState,
    revalidatePointer: boolean,
  ): Promise<"complete" | "changed"> => {
    const archiveStore = context.archiveStore;
    const { archive, version } = pointer;
    if (archiveStore === undefined || archive === undefined || !(await archiveRouterReady())) {
      throw new LaunchError("verification", "The controlling worker cannot serve build archives");
    }
    const complete = await archiveStore.complete(version, pointer);
    let body: Blob | undefined;
    if (!complete) {
      reportUpdate({ phase: "staging", value: 0, version });
      body = await downloadArchive(archive, (received, total) => {
        reportUpdate({ phase: "staging", value: received / total, version });
        reportTransfer(version, received, total);
      });
    }
    reportUpdateProgress({ phase: "verifying", version });
    // A content-addressed transfer can finish even after a later release deploys.
    if (!complete || revalidatePointer) {
      const deployed = await readPointer();
      if (deployed.version !== version || deployed.archive?.sha256 !== archive.sha256) {
        return "changed";
      }
    }
    if (body !== undefined) {
      await archiveStore.put(pointer, body, aborts.signal);
    }
    await publishStaged(state, version, pointer);
    return "complete";
  };

  // Grouped builds (launchGroups).
  const groups: LaunchGroupsContext = {
    downloadGroup,
    fetch: installContext.fetch,
    groupRouterReady: () => archiveRouterReady(BUILD_GROUP_ROUTER_PROBE),
    groupStore: context.groupStore,
    policy,
    readDeployedManifest,
    readPointer,
    signal: aborts.signal,
    soundFormat: options.soundFormat,
    store,
  };
  const groupedInstall: GroupedInstallContext = {
    ...groups,
    disposed: () => disposed,
    onBootBytes: (bootBytes) => {
      progress = { ...progress, bootBytes, received: 0, total: 0 };
    },
    onBytes: (received, total) => {
      progress = { ...progress, received, total };
      report("installing", 0);
    },
    onRecorded: (version) => recordProgress(version, true),
    reload,
    waitForRouter,
  };
  const groupedStaging: GroupedStagingContext = {
    ...groups,
    onTransfer: reportTransfer,
    onVerify: (version) => reportUpdateProgress({ phase: "verifying", version }),
    publishStaged,
    reportUpdate,
  };

  // Stages the build the pointer names; a redeploy mid-staging restarts on the new manifest.
  // Records in attempt the version it tries, so a failure can name it.
  const stageDeployed = async (restarts: number, attempt: { version?: string }): Promise<void> => {
    const observation = restarts === 0 ? earlyPointer : undefined;
    // Keep the observation cancelable until the request and state read have both settled.
    const observed = await observation?.result.catch((error: unknown) => {
      if (earlyPointer === observation) {
        throw error;
      }
      return undefined;
    });
    const state = await store.readState();
    const usable =
      observation !== undefined &&
      earlyPointer === observation &&
      observation.startup.active === state.active &&
      observation.startup.staged === state.staged &&
      page.timers.now() - observation.started < CONTROL_WAIT_MS;
    cancelEarlyPointer();
    if (
      (observation !== undefined && !visible && !required) ||
      !page.online() ||
      disposed ||
      reloading
    ) {
      if (restarts === 0) {
        lastCheck = undefined;
      }
      return;
    }
    const isRunning = ({ version }: BuildPointer) =>
      version === documentVersion || version === state.active;
    // Confirm a running pointer at the origin before it can clear a newer stage.
    const prefetched =
      usable &&
      observed !== undefined &&
      !(isRunning(observed) && state.staged !== undefined && state.staged !== observed.version);
    const pointer = prefetched ? observed : await readPointer();
    if (disposed || reloading) {
      return;
    }
    if (isRunning(pointer)) {
      // The deployed build is already running; a staged one would roll it back.
      if (state.staged !== undefined && state.staged !== pointer.version) {
        await withBuildStateLock(policy, async () => {
          const current = await store.readState();
          if (
            !disposed &&
            !reloading &&
            current.active === state.active &&
            current.staged === state.staged
          ) {
            await store.setStaged(undefined);
          }
        });
      }
      reportUpdate({ phase: "idle" });
      return;
    }
    const { buildId, version } = pointer;
    attempt.version = version;
    reportUpdateProgress({ phase: "preparing", version });
    const restart = () => {
      const next = nextRestart(restarts, "staging");
      if (!disposed && !reloading) {
        reportUpdateProgress({ phase: "idle" });
      }
      delete attempt.version;
      return stageDeployed(next, attempt);
    };
    if (pointer.archive !== undefined || pointer.groups !== undefined) {
      const result =
        pointer.groups !== undefined
          ? await stageGroups(groupedStaging, state, pointer, prefetched)
          : await stageArchive(pointer, state, prefetched);
      if (result === "changed") {
        await restart();
      }
      return;
    }
    const manifest = await readPinnedManifest(pointer);
    const verify = async () => {
      reportUpdateProgress({ phase: "verifying", version });
      if (prefetched) {
        const current = await readPointer();
        if (current.version !== version || current.buildId !== buildId) {
          await restart();
          return;
        }
      }
      await publishStaged(state, version);
    };
    if (state.staged === version && (await store.complete(manifest))) {
      await verify();
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
        reportTransfer(version, receivedBytes, totalBytes);
      },
      // An update waits while the page is hidden, and resumes when it comes back into view.
      paused: () => !visible,
      signal: aborts.signal,
    });
    if (disposed) {
      return;
    }
    if (result === "changed") {
      await restart();
      return;
    }
    await verify();
  };

  const stage = async () => {
    const attempt: { version?: string } = {};
    try {
      await stageDeployed(0, attempt);
      retryMs = 0;
      cancelRetry();
    } catch (error) {
      const canceled = !visible || !page.online();
      cancelEarlyPointer();
      if (disposed || reloading || (canceled && attempt.version === undefined)) {
        return;
      }
      // K3: a failed update is retried while the page stays visible and at the next check, and
      // never shows Loading failed.
      console.warn("Background update failed.", error);
      if (attempt.version !== undefined) {
        reportUpdate({ phase: "failed", version: attempt.version });
        reportUpdateProgress({ phase: "failed", version: attempt.version });
      }
      retryMs = nextUpdateRetryMs(retryMs);
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
      // A pending timer implies a failed update, so retryMs is above 0 and doubles here.
      if (!check(true)) {
        retryMs = nextUpdateRetryMs(retryMs);
        armRetry();
      }
    }, retryMs);
  };

  // Starts an update check unless one is under way, the page is offline, or (without force) the
  // last check ran within UPDATE_CHECK_MS. Returns whether a check is under way.
  const check = (force: boolean): boolean => {
    if (!discoveryReady || disposed || reloading || documentVersion === undefined) {
      return false;
    }
    if (staging !== undefined) {
      return true;
    }
    const now = page.timers.now();
    if (!page.online() || (!force && updateCheckWait(now, lastCheck) > 0)) {
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
    const remaining = updateCheckWait(page.timers.now(), lastCheck);
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
    notify("Required update", () => options.onRequireNewer?.(next));
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
      const staged = requiredUpdateCandidate(documentVersion, state);
      const verified = staged !== undefined && (await completeBuild(staged));
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
        cancelEarlyPointer();
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
  const offline = () => {
    cancelDiscovery();
    cancelEarlyPointer();
  };
  page.eventTarget.addEventListener("offline", offline);
  page.eventTarget.addEventListener("focus", discoverOnWake);
  cleanups.push(() => page.eventTarget.removeEventListener("online", online));
  cleanups.push(() => page.eventTarget.removeEventListener("offline", offline));
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
    const progressRecord = readSession(session, LAUNCH_PROGRESS_KEY);
    const updateVersion = takeUpdateCarry(session, progressRecord);
    if (state.active === undefined) {
      return firstInstall();
    }
    // The router updates its own script; play does not wait for it.
    register().catch((error: unknown) =>
      console.warn("Service worker registration failed; offline play may be stale.", error),
    );
    const carry = parseProgressCarry(progressRecord);
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
    if (visible && page.online() && !disposed && !reloading) {
      startEarlyPointer(state);
    }
    if (page.online()) {
      // Optional metadata reads must not leave an installed game waiting on an unreachable origin.
      const readMetadata = async <T>(read: (signal: AbortSignal) => Promise<T>): Promise<T> => {
        aborts.signal.throwIfAborted();
        const request = new AbortController();
        const abort = () => request.abort();
        aborts.signal.addEventListener("abort", abort, { once: true });
        const timer = page.timers.setTimeout(abort, CONTROL_WAIT_MS);
        try {
          return await read(request.signal);
        } finally {
          aborts.signal.removeEventListener("abort", abort);
          page.timers.clearTimeout(timer);
        }
      };
      await recoverActiveGroups(
        {
          ...groups,
          downloadGroup: (group, onBytes) => downloadGroup(group, onBytes, page.fetch),
          groupRouterReady: () => archiveRouterReady(BUILD_GROUP_REPAIR_ROUTER_PROBE),
          readDeployedManifest: (pointer) =>
            readMetadata((signal) => readDeployedManifest(pointer, signal)),
          // Repair retains its own bounded read and revalidation. It never awaits the
          // speculative discovery observation and can only repair the active version.
          readPointer: () => readMetadata(readPointer),
        },
        state,
      ).catch(() => undefined);
    }
    if (updateVersion !== undefined) {
      if (updateVersion === state.active && !disposed) {
        bootingUpdate = updateVersion;
        reportUpdateProgress({ phase: "booting", version: updateVersion });
      } else if (!disposed) {
        reportUpdateProgress({ phase: "applyFailed", version: updateVersion });
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
        if (bootingUpdate !== undefined) {
          reportUpdateProgress({ phase: "applied", version: bootingUpdate });
        }
        return;
      }
      const settled = Math.max(0, done);
      report("booting", settled / total);
      if (bootingUpdate !== undefined) {
        reportUpdateProgress({
          counts: { done: settled, total },
          phase: "booting",
          version: bootingUpdate,
        });
      }
    },
    dispose() {
      disposed = true;
      cancelDiscovery();
      cancelRetry();
      cancelEarlyPointer();
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
