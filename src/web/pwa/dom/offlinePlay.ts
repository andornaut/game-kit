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

export interface OfflinePlayOptions extends UpdateReports {
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
  const watchInstallation = (registration: RegistrationLike) => {
    const watched = new WeakSet<ServiceWorkerLike>();
    const read = () => {
      const worker = registration.installing;
      if (worker !== null && !watched.has(worker)) {
        watched.add(worker);
        worker.addEventListener("statechange", read);
      }
      const installing = worker !== null && worker.state === "installing";
      // A registration installs one worker at a time, so the precache ends when none is installing.
      precaching &&= installing;
      if (installing) {
        reportActivity(precaching ? "precaching" : "updating");
      } else {
        reportActivity("idle");
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
  const register = (): Promise<void> => {
    if (pending !== undefined) {
      return pending;
    }
    if (!registered && firstVisit) {
      precaching = true;
      reportActivity("precaching");
    }
    registered = true;
    pending = container
      .register(options.serviceWorkerUrl, { scope: "/" })
      .then(watchInstallation)
      .then(
        (registration) => flow.watch(registration),
        (error: unknown) => {
          reportActivity("idle");
          console.warn(
            "Service worker registration failed; the game will not work offline.",
            error,
          );
        },
      )
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };
  const flow = createUpdateFlow(page, register, options);
  eventTarget.addEventListener("online", () => flow.noteOnline());
  watchVisibility(eventTarget, page.visibilitySource, (visible) => {
    if (visible) {
      readInstallation?.();
    }
    flow.setVisible(visible);
  });
  const registrationReady = () => {
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
        void register();
      }
      return result;
    })();
    return launch;
  };
  return { flow, launchReady, registrationReady };
}
