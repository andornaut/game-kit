import {
  type ContainerLike,
  createUpdateFlow,
  type RegistrationLike,
  type ServiceWorkerLike,
  type SessionLike,
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
  register(url: string, options: { scope: string }): Promise<RegistrationLike>;
}

// What offline play needs of the page, so tests can pass fakes. eventTarget is its window.
export interface OfflinePage extends UpdatePage {
  readonly container: RegisteringContainer;
  readonly eventTarget: EventTarget;
  readonly visibilitySource: VisibilitySource;
}

export interface OfflinePlay {
  // The update flow: arriveHome() marks each arrival home, accept() is the update offer's button,
  // and requireNewer() updates by itself for a save a newer version wrote.
  readonly flow: UpdateFlow;
  // Registers the service worker on a first install, once the client has prepared its first
  // playable frame. A controlled page registers at start, and later calls do nothing.
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

// Offline play and updates, on the kit's update flow. The game shows its first screen at once:
// nothing here waits or reloads on its own. A controlled page runs the version on disk and
// registers at once, so the update checks run in the background on each arrival home and when the
// page comes back into view on it (an installed app resumed without relaunching). A first visit
// runs from the network and registers when ready, precaching in the background. A failed
// registration leaves the game running online. The window's online event retries a required
// update.
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
  watchVisibility(eventTarget, page.visibilitySource, (visible) => flow.setVisible(visible));
  const registrationReady = () => {
    if (!registered) {
      void register();
    }
  };
  if (container.controller !== null) {
    void register();
  }
  return { flow, registrationReady };
}
