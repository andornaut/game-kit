import {
  type ContainerLike,
  createUpdateFlow,
  registerWhenDue,
  type RegistrationLike,
  type UpdateFlow,
} from "./updateReady";
import { watchVisibility } from "./visibility";
import type { VisibilitySource } from "./wakeLock";

// Input that counts as the player interacting, after which the page never reloads on its own.
export const INTERACTION_EVENTS = ["keydown", "pointerdown"] as const;

export interface OfflinePlayOptions {
  // How long a fresh load holds the first screen and the save for a newer version to be checked
  // for and installed, so it reloads into that version before the first screen draws.
  readonly bootWaitMs: number;
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
  // Call with whether the game's home screen is in front, on each change (registerWhenDue).
  readonly setOnHome: (onHome: boolean) => void;
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
// registers when due (registerWhenDue). A failed registration leaves the game running online.
export function startOfflinePlay(options: OfflinePlayOptions, page: OfflinePage): OfflinePlay {
  const { container, eventTarget } = page;
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
  watchVisibility((visible) => flow.setVisible(visible), eventTarget, page.visibilitySource);
  page.setTimeout(() => flow.endBootWait(), options.bootWaitMs);
  const setOnHome = registerWhenDue(container, flow, () =>
    container.register(options.serviceWorkerUrl, { scope: "/" }).catch((error: unknown) => {
      console.warn("Service worker registration failed; the game will not work offline.", error);
      throw error;
    }),
  );
  return { bootable: flow.bootable, flow, setOnHome };
}
