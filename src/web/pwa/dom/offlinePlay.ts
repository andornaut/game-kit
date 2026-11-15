import type { DownloadProgress } from "../downloadProgress.ts";
import { watchDownloadProgress } from "./downloadProgress.ts";
import {
  activateWaitingWorker,
  type ContainerLike,
  createUpdateFlow,
  type RegistrationLike,
  type ServiceWorkerLike,
  type SessionLike,
  SWITCH_TIMEOUT_MS,
  type SwitchResult,
  type UpdateFlow,
  type UpdatePage,
  type UpdateReports,
} from "./updateReady.ts";
import { type VisibilitySource, watchVisibility } from "./visibility.ts";

// Deprecated: input no longer starts update checks, and nothing listens for these; arrival checks
// run on UpdateFlow's arriveHome.
// CLEANUP (added 2026-11-12): remove once every consuming game has dropped its imports.
export const INTERACTION_EVENTS = ["keydown", "pointerdown"] as const;

export type OfflineActivity = "idle" | "precaching" | "updating";

export interface InstallationIdentity {
  readonly attempt: number;
  readonly operationId: string | undefined;
  readonly version: string | undefined;
}

export type InstallationState = InstallationIdentity &
  (
    | { readonly kind: "idle"; readonly stage: "idle" | "not-ready" | "not-observed" }
    | { readonly kind: "loading"; readonly stage: "registering" | "checking" | "installing" }
    | { readonly kind: "ready"; readonly stage: "installed" }
    | {
        readonly kind: "failed";
        readonly stage: "registration" | "installation";
        readonly error: unknown;
      }
  );

export interface OfflinePlayOptions extends UpdateReports {
  // Independent of visibility and progress-port delivery. Unknown operation/version metadata
  // stays undefined; idle never establishes availability. Structurally a LoadingAttemptState.
  readonly onInstallationState?: (state: InstallationState) => void;
  // Optional relative bar progress for the installing worker. No byte or numeric labels.
  // Visibility and activity remain caller-owned; verification stays indeterminate until ready.
  readonly onDownloadProgress?: (snapshot: DownloadProgress) => void;
  // What the service worker is doing, with no byte or percentage claim. "precaching" is the
  // first-visit precache: only on a page whose container had no controller at start, from the
  // registration request until the first installation ends (its worker leaves the "installing"
  // state), registration fails, or registration resolves with no worker installing, at most once
  // per page. A game shows its loading bar for this value, and otherwise only for onRequireNewer's
  // "updating". "updating" is every other worker installation, and shows no loading bar. "idle" is
  // everything else and is reported at start; a controlled page's registration request alone
  // leaves it idle. Each change is reported once. This never changes when registration, update
  // checks or play are allowed.
  readonly onOfflineActivity?: (activity: OfflineActivity) => void;
  // The service worker's URL (serviceWorkerUrl's), registered with scope "/".
  readonly serviceWorkerUrl: string;
}

// The service worker container, as far as registering in it goes.
export interface RegisteringContainer extends ContainerLike {
  getRegistration(): Promise<RegistrationLike | undefined>;
  register(url: string, options: { scope: string }): Promise<RegistrationLike>;
}

// What offline play needs of the page, so tests can pass fakes. eventTarget is its window.
export interface OfflinePage extends UpdatePage {
  readonly container: RegisteringContainer;
  readonly eventTarget: EventTarget;
  readonly visibilitySource: VisibilitySource;
}

export type LaunchResult = "continue" | SwitchResult;

export interface OfflinePlay {
  // Once at document boot, before game construction or save access. A blocked switch may
  // continue the old build safely. Never call this on title arrival or visibility resume.
  // A reloading result means the caller must not start the game.
  launchReady(): Promise<LaunchResult>;
  // The update flow: arriveHome() marks each arrival home, accept() is the update offer's button,
  // and requireNewer() updates by itself for a save a newer version wrote.
  readonly flow: UpdateFlow;
  // Registers the service worker on a first install, once the client has prepared its first
  // playable frame. A controlled page registers after launchReady, and this call does nothing.
  registrationReady(): void;
  // Joins an active attempt after the prepared-frame/launch boundary. Failed and idle results
  // also resolve: only ready establishes that this tracked worker installed. Never activates,
  // claims, reloads or changes saves. An existing ready attempt needs no retry.
  retryInstallation(): Promise<InstallationState>;
}

// The browser's page, or undefined where it has no service workers.
export function browserOfflinePage(): OfflinePage | undefined {
  if (!("serviceWorker" in navigator)) {
    return undefined;
  }
  return {
    container: navigator.serviceWorker,
    eventTarget: window,
    now: () => Date.now(),
    online: () => navigator.onLine,
    reload: () => window.location.reload(),
    session: browserSession(),
    visibilitySource: document,
  };
}

// The tab's sessionStorage, or undefined where reading it throws.
function browserSession(): SessionLike | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

// Call launchReady once before game construction or save access. Controlled launches inspect an
// already-waiting version before registration can find another update, then register when play
// may continue. First visits return immediately and register only after registrationReady marks
// the prepared frame. Arrival and visibility checks stage updates without activating them.
export function startOfflinePlay(options: OfflinePlayOptions, page: OfflinePage): OfflinePlay {
  const { container, eventTarget } = page;
  const firstVisit = container.controller === null;
  interface Attempt {
    readonly id: number;
    operationId: string | undefined;
    version: string | undefined;
    worker: ServiceWorkerLike | undefined;
    done: boolean;
    state: InstallationState;
    readonly promise: Promise<InstallationState>;
    readonly resolve: (state: InstallationState) => void;
  }
  let sequence = 0;
  let current: Attempt | undefined;
  let retryReady = false;
  const identity = (attempt?: Attempt): InstallationIdentity => ({
    attempt: attempt?.id ?? 0,
    operationId: attempt?.operationId,
    version: attempt?.version,
  });
  const notify = (state: InstallationState) => {
    try {
      options.onInstallationState?.(state);
    } catch (error) {
      console.error("Installation state callback failed.", error);
    }
  };
  const makeAttempt = () => {
    let resolve!: (state: InstallationState) => void;
    const promise = new Promise<InstallationState>((finish) => {
      resolve = finish;
    });
    sequence += 1;
    const attempt: Attempt = {
      done: false,
      id: sequence,
      operationId: undefined,
      promise,
      resolve,
      state: {
        attempt: sequence,
        kind: "idle",
        operationId: undefined,
        stage: "idle",
        version: undefined,
      },
      version: undefined,
      worker: undefined,
    };
    current = attempt;
    return attempt;
  };
  const publish = (attempt: Attempt, terminal: boolean, state: InstallationState) => {
    if (current !== attempt || attempt.done) {
      return;
    }
    const previous = attempt.state;
    attempt.state = state;
    if (terminal) {
      attempt.done = true;
      attempt.resolve(state);
    }
    if (
      previous.kind !== state.kind ||
      previous.stage !== state.stage ||
      previous.operationId !== state.operationId ||
      previous.version !== state.version ||
      terminal
    ) {
      notify(state);
    }
  };
  const loading = (attempt: Attempt, stage: "registering" | "checking" | "installing") => {
    publish(attempt, false, { ...identity(attempt), kind: "loading", stage });
  };
  const fail = (attempt: Attempt, stage: "registration" | "installation", error: unknown) => {
    publish(attempt, true, { ...identity(attempt), error, kind: "failed", stage });
  };
  const unobserved = (attempt: Attempt) => {
    publish(attempt, true, { ...identity(attempt), kind: "idle", stage: "not-observed" });
  };
  notify({ ...identity(), kind: "idle", stage: "idle" });
  // True from a first visit's registration request until its precache ends.
  let precaching = false;
  let activity: OfflineActivity | undefined;
  const reportActivity = (next: OfflineActivity) => {
    if (activity === next) {
      return;
    }
    activity = next;
    try {
      options.onOfflineActivity?.(next);
    } catch (error) {
      console.error("Offline activity callback failed.", error);
    }
  };
  reportActivity("idle");
  let readInstallation: (() => void) | undefined;
  let progressWorker: ServiceWorkerLike | undefined;
  let stopProgress: (() => void) | undefined;
  let visible = page.visibilitySource.visibilityState !== "hidden";
  let observed: RegistrationLike | undefined;
  let unwatch: (() => void) | undefined;
  const inspect = (attempt: Attempt) => {
    if (current !== attempt || attempt.done || attempt.worker === undefined) {
      return;
    }
    const { state } = attempt.worker;
    if (state === "redundant") {
      fail(attempt, "installation", new Error("Service worker installation failed"));
    } else if (state === "installed" || state === "activating" || state === "activated") {
      publish(attempt, true, { ...identity(attempt), kind: "ready", stage: "installed" });
    } else if (state === "installing") {
      loading(attempt, "installing");
    }
  };
  const watchInstallation = (registration: RegistrationLike) => {
    if (observed === registration) {
      readInstallation?.();
      return registration;
    }
    unwatch?.();
    observed = registration;
    const watched = new Map<ServiceWorkerLike, () => void>();
    const read = () => {
      if (observed !== registration) {
        return;
      }
      const worker = registration.installing;
      if (worker !== null && !watched.has(worker)) {
        for (const [previous, changed] of watched) {
          previous.removeEventListener("statechange", changed);
        }
        watched.clear();
        if (
          current !== undefined &&
          !current.done &&
          current.worker !== undefined &&
          current.worker !== worker
        ) {
          fail(current, "installation", new Error("Service worker installation was superseded"));
        }
        const attempt = current === undefined || current.done ? makeAttempt() : current;
        attempt.worker = worker;
        const changed = () => {
          inspect(attempt);
          read();
        };
        watched.set(worker, changed);
        worker.addEventListener("statechange", changed);
      }
      if (current !== undefined) {
        inspect(current);
      }
      if (observed !== registration) {
        return;
      }
      const installing = worker !== null && worker.state === "installing";
      const reporting =
        visible &&
        installing &&
        (options.onDownloadProgress !== undefined || options.onInstallationState !== undefined)
          ? worker
          : undefined;
      if (progressWorker !== reporting) {
        stopProgress?.();
        progressWorker = reporting;
        const attempt = current;
        stopProgress =
          reporting === undefined
            ? undefined
            : watchDownloadProgress((snapshot) => {
                if (
                  observed !== registration ||
                  current !== attempt ||
                  attempt === undefined ||
                  attempt.done ||
                  attempt.worker !== reporting
                ) {
                  return;
                }
                attempt.operationId = snapshot.operationId;
                attempt.version = snapshot.version;
                loading(attempt, "installing");
                if (current === attempt && !attempt.done && attempt.worker === reporting) {
                  options.onDownloadProgress?.(snapshot);
                }
              }, reporting);
      }
      precaching &&= installing;
      reportActivity(installing ? (precaching ? "precaching" : "updating") : "idle");
    };
    unwatch = () => {
      registration.removeEventListener("updatefound", read);
      for (const [worker, changed] of watched) {
        worker.removeEventListener("statechange", changed);
      }
    };
    readInstallation = read;
    registration.addEventListener("updatefound", read);
    read();
    return registration;
  };
  // The registration request in flight, which a repeated request joins.
  let pending: Promise<void> | undefined;
  let registered = false;
  // The short native request and longer installation flight are reserved before callbacks.
  const request = (
    stage: "registering" | "checking",
    run: () => Promise<RegistrationLike>,
  ): Promise<void> => {
    if (pending !== undefined) {
      return pending;
    }
    const attempt = current === undefined || current.done ? makeAttempt() : current;
    let finish!: () => void;
    const flight = new Promise<void>((resolve) => {
      finish = resolve;
    });
    pending = flight;
    const firstRegistration = !registered && firstVisit;
    registered = true;
    loading(attempt, stage);
    if (firstRegistration) {
      precaching = true;
      reportActivity("precaching");
    }
    const failed = (error: unknown) => {
      if (current !== attempt || attempt.done) {
        return;
      }
      if (pending === flight) {
        pending = undefined;
      }
      precaching = false;
      reportActivity("idle");
      fail(attempt, "registration", error);
      console.warn("Service worker registration failed; the game will not work offline.", error);
    };
    let native: Promise<RegistrationLike>;
    try {
      native = run();
    } catch (error) {
      native = Promise.reject(error);
    }
    void native
      .then((registration) => {
        if (pending === flight) {
          pending = undefined;
        }
        watchInstallation(registration);
        if (stage === "registering") {
          flow.watch(registration);
        }
        if (current === attempt && attempt.worker === undefined) {
          unobserved(attempt);
        }
      })
      .catch(failed)
      .finally(() => {
        if (pending === flight) {
          pending = undefined;
        }
        finish();
      });
    return flight;
  };
  const register = () =>
    request("registering", () => container.register(options.serviceWorkerUrl, { scope: "/" }));
  const retryInstallation = (): Promise<InstallationState> => {
    if (!retryReady && !registered) {
      return Promise.resolve({ ...identity(), kind: "idle", stage: "not-ready" });
    }
    if (current !== undefined && !current.done) {
      return current.promise;
    }
    if (current?.state.kind === "ready") {
      return current.promise;
    }
    const registration = observed;
    if (registration?.installing !== null && registration?.installing !== undefined) {
      readInstallation?.();
      if (current !== undefined && !current.done) {
        return current.promise;
      }
    }
    if (registration?.active !== null && registration?.active !== undefined) {
      void request("checking", async () => {
        await registration.update();
        return registration;
      });
    } else {
      void register();
    }
    return current!.promise;
  };
  const flow = createUpdateFlow(page, register, options);
  eventTarget.addEventListener("online", () => flow.noteOnline());
  watchVisibility(eventTarget, page.visibilitySource, (nextVisible) => {
    visible = nextVisible;
    if (!visible) {
      stopProgress?.();
      stopProgress = undefined;
      progressWorker = undefined;
    }
    if (visible) {
      readInstallation?.();
    }
    flow.setVisible(visible);
  });
  const registrationReady = () => {
    if (firstVisit) {
      retryReady = true;
    }
    if (firstVisit && !registered) {
      void register();
    }
  };
  let launch: Promise<LaunchResult> | undefined;
  const launchReady = (): Promise<LaunchResult> => {
    if (launch !== undefined) {
      return launch;
    }
    // First visits keep registration behind the prepared-frame boundary.
    if (firstVisit) {
      launch = Promise.resolve("continue");
      return launch;
    }
    launch = (async (): Promise<LaunchResult> => {
      let result: LaunchResult = "continue";
      try {
        // Snapshot before register(), which can itself discover and install a later worker.
        let timer: ReturnType<typeof setTimeout> | undefined;
        const registration = await Promise.race([
          container.getRegistration(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Launch lookup timed out")),
              SWITCH_TIMEOUT_MS,
            );
          }),
        ]).finally(() => clearTimeout(timer));
        const candidate = registration?.waiting;
        if (candidate !== null && candidate !== undefined) {
          result = await activateWaitingWorker(container, () => page.reload(), candidate);
        }
      } catch {
        result = "blocked";
      }
      if (result !== "reloading") {
        retryReady = true;
        void register();
      }
      return result;
    })();
    return launch;
  };
  return { flow, launchReady, registrationReady, retryInstallation };
}
