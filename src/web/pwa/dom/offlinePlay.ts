import type { UpdateFlowOptions } from "../updateReady.ts";
import {
  type ContainerLike,
  createUpdateFlow,
  type RegistrationLike,
  type ServiceWorkerLike,
  type UpdateFlow,
} from "./updateReady.ts";
import { type VisibilitySource, watchVisibility } from "./visibility.ts";

// Input that counts as the player interacting, after which the page never reloads on its own.
export const INTERACTION_EVENTS = ["keydown", "pointerdown"] as const;

export type OfflineActivity = "idle" | "precaching" | "updating";

export interface OfflinePlayOptions extends UpdateFlowOptions {
  // How long a fresh load holds the first screen and the save for a newer version to be checked
  // for and installed, so it reloads into that version before the first screen draws.
  readonly bootWaitMs: number;
  // What the service worker is doing, with no byte or percentage claim. "precaching" is the
  // first-visit precache: only on a page whose container had no controller at start, from the
  // registration request until the first installation ends (its worker leaves the "installing"
  // state), registration fails, or registration resolves with no worker installing, at most once
  // per page. A game shows its loading bar for exactly this value. "updating" is every other
  // worker installation, and shows no loading bar. "idle" is everything else and is reported at
  // start; a controlled page's registration request alone leaves it idle. Each change is reported
  // once. This never changes when registration, update checks or play are allowed.
  readonly onOfflineActivity?: (activity: OfflineActivity) => void;
  // Called with whether the game offers the update, on each change (createUpdateFlow's show).
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
  setTimeout(handler: () => void, ms: number): unknown;
  readonly visibilitySource: VisibilitySource;
}

export interface OfflinePlay {
  // Resolves once the game may show its first screen and write a save: at once, or after a fresh
  // load has checked for a newer version, for at most bootWaitMs. It never resolves for a page
  // that reloads into one first.
  readonly bootable: Promise<void>;
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
    setTimeout: (handler, ms) => window.setTimeout(handler, ms),
    visibilitySource: document,
  };
}

// Offline play and updates, on the kit's update flow: the player's keys and presses count as
// interacting, the page coming back into view checks for a newer version (an installed app
// resumed without relaunching), the boot waits at most bootWaitMs, and the service worker
// registers when ready. A failed registration leaves the game running online.
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
    options,
  );
  for (const type of INTERACTION_EVENTS) {
    eventTarget.addEventListener(type, () => flow.noteInteraction(), {
      capture: true,
      passive: true,
    });
  }
  watchVisibility(eventTarget, page.visibilitySource, (visible) => flow.setVisible(visible));
  page.setTimeout(() => flow.endBootWait(), options.bootWaitMs);
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
      .catch((error: unknown) => {
        reportActivity("idle");
        console.warn("Service worker registration failed; the game will not work offline.", error);
        throw error;
      })
      .then(
        (registration) => flow.watch(registration),
        () => flow.noRegistration(),
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
  return { bootable: flow.bootable, flow, registrationReady };
}
