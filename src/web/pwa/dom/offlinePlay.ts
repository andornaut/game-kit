import {
  type ContainerLike,
  createUpdateFlow,
  type RegistrationLike,
  type ServiceWorkerLike,
  type UpdateFlow,
} from "./updateReady.ts";
import { type VisibilitySource, watchVisibility } from "./visibility.ts";

// Input that counts as the player interacting, after which each arrival home checks for a newer
// version.
export const INTERACTION_EVENTS = ["keydown", "pointerdown"] as const;

export type OfflineActivity = "idle" | "precaching" | "updating";

export interface OfflinePlayOptions {
  // What the service worker is doing, with no byte or percentage claim. "precaching" is the
  // first-visit precache: only on a page whose container had no controller at start, from the
  // registration request until the first installation ends (its worker leaves the "installing"
  // state), registration fails, or registration resolves with no worker installing, at most once
  // per page. A game shows its loading bar for exactly this value. "updating" is every other
  // worker installation, and shows no loading bar. "idle" is everything else and is reported at
  // start; a controlled page's registration request alone leaves it idle. Each change is reported
  // once. This never changes when registration, update checks or play are allowed.
  readonly onOfflineActivity?: (activity: OfflineActivity) => void;
  // Called with whether the game offers the update, on each change (createUpdateFlow's show): a
  // newer version fully installed and checked waits behind the one controlling the page, and the
  // home screen is in front. Never on a page no version controls.
  readonly onUpdateShown: (shown: boolean) => void;
  // The service worker's URL (serviceWorkerUrl's), registered with scope "/".
  readonly serviceWorkerUrl: string;
}

// The service worker container, as far as registering in it goes.
export interface RegisteringContainer extends ContainerLike {
  register(url: string, options: { scope: string }): Promise<RegistrationLike>;
}

// What offline play needs of the page, so tests can pass fakes. eventTarget is its window.
export interface OfflinePage {
  readonly container: RegisteringContainer;
  readonly eventTarget: EventTarget;
  now(): number;
  online(): boolean;
  reload(): void;
  readonly visibilitySource: VisibilitySource;
}

export interface OfflinePlay {
  // The update flow: accept() is the update offer's button, and noteInteraction() counts play
  // that started without input.
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
    visibilitySource: document,
  };
}

// Offline play and updates, on the kit's update flow. The game shows its first screen at once:
// nothing here waits or reloads on its own. A controlled page runs the version on disk and
// registers at once, so the update checks run in the background; the player's keys and presses
// count as interacting, and the page coming back into view checks for a newer version (an
// installed app resumed without relaunching). A first visit runs from the network and registers
// when ready, precaching in the background. A failed registration leaves the game running online.
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
  const flow = createUpdateFlow(
    container,
    () => page.now(),
    () => page.online(),
    () => page.reload(),
    options.onUpdateShown,
  );
  for (const type of INTERACTION_EVENTS) {
    eventTarget.addEventListener(type, () => flow.noteInteraction(), {
      capture: true,
      passive: true,
    });
  }
  watchVisibility(eventTarget, page.visibilitySource, (visible) => flow.setVisible(visible));
  let registered = false;
  const register = () => {
    registered = true;
    if (firstVisit) {
      precaching = true;
      reportActivity("precaching");
    }
    void container
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
      );
  };
  const registrationReady = () => {
    if (!registered) {
      register();
    }
  };
  if (container.controller !== null) {
    register();
  }
  return { flow, registrationReady };
}
