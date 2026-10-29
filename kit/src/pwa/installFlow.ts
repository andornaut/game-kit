// The install offer on a page: holds the browser's install prompt, follows the install state and
// installs on request. It imports only installState.ts, so a site's other pages can load it.
import {
  type InstallState,
  installState,
  type MenuInstallBrowser,
  menuInstallBrowser,
  runsAsApp,
} from "./installState";

// Chromium's beforeinstallprompt event, which no TypeScript lib types.
export interface InstallPromptEvent extends Event {
  prompt(): Promise<unknown>;
  readonly userChoice: Promise<{ readonly outcome: "accepted" | "dismissed" }>;
}

export interface MediaQueryLike {
  addEventListener?(type: "change", listener: () => void): void;
  readonly matches: boolean;
}

// The parts of window this reads, so tests can pass a fake.
export interface InstallHost extends EventTarget {
  matchMedia(query: string): MediaQueryLike;
  readonly navigator: {
    readonly maxTouchPoints: number;
    // iOS only: opened from the Home Screen.
    readonly standalone?: boolean;
    readonly userAgent: string;
  };
}

// accepted or dismissed: the browser's prompt showed and the player chose. menuSteps: the page
// shows the steps for menuBrowser's own menu. unavailable: nothing to install with.
export type InstallOutcome = "accepted" | "dismissed" | "menuSteps" | "unavailable";

export interface InstallFlow {
  install(): Promise<InstallOutcome>;
  // The browser that installs only from its own menu, whose steps menuSteps shows, or undefined
  // for any other. Fixed for the page's life.
  readonly menuBrowser: MenuInstallBrowser | undefined;
  // Calls listener on each change of state until the returned function is called.
  onChange(listener: (state: InstallState) => void): () => void;
  state(): InstallState;
}

// The display modes a web app manifest asks for to run as an app.
export const INSTALLED_DISPLAY_QUERY = "(display-mode: fullscreen), (display-mode: standalone)";

// Whether the page runs as the installed app now, read as watchInstall reads it.
export function pageRunsAsApp(host: Pick<InstallHost, "matchMedia" | "navigator">): boolean {
  return runsAsApp({
    displayModeInstalled: host.matchMedia(INSTALLED_DISPLAY_QUERY).matches,
    iosStandalone: host.navigator.standalone === true,
  });
}

// Shows the prompt and reads the player's choice. prompt is called before any await, while the
// tap that asked for it still counts as the player's gesture.
async function choose(event: InstallPromptEvent): Promise<InstallOutcome> {
  try {
    await event.prompt();
    return (await event.userChoice).outcome;
  } catch {
    return "unavailable";
  }
}

// Starts listening at once: beforeinstallprompt can fire before the page has drawn anything, so
// the page calls this as it loads. The held prompt shows once; after the player's choice the
// browser offers a new one on a later visit, so the offer hides until then.
export function watchInstall(host: InstallHost): InstallFlow {
  const menuBrowser = menuInstallBrowser(host.navigator.userAgent, host.navigator.maxTouchPoints);
  const display = host.matchMedia(INSTALLED_DISPLAY_QUERY);
  const listeners = new Set<(state: InstallState) => void>();
  let held: InstallPromptEvent | undefined;
  let appInstalled = false;

  const state = () =>
    installState({
      appInstalled,
      displayModeInstalled: display.matches,
      hasPrompt: held !== undefined,
      iosStandalone: host.navigator.standalone === true,
      menuBrowser,
    });
  let last = state();
  const update = () => {
    const now = state();
    if (now !== last) {
      last = now;
      listeners.forEach((listener) => listener(now));
    }
  };

  host.addEventListener("beforeinstallprompt", (event) => {
    // Keeps the browser's own mini-infobar away, so the game's offer is the only one.
    event.preventDefault();
    held = event as InstallPromptEvent;
    update();
  });
  host.addEventListener("appinstalled", () => {
    appInstalled = true;
    held = undefined;
    update();
  });
  display.addEventListener?.("change", update);

  return {
    async install() {
      const event = held;
      if (event === undefined) {
        return state() === "menuSteps" ? "menuSteps" : "unavailable";
      }
      // A prompt shows once, so a second tap while it shows has nothing to install with.
      held = undefined;
      const outcome = await choose(event);
      if (outcome === "accepted") {
        appInstalled = true;
      }
      update();
      return outcome;
    },
    menuBrowser,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    state,
  };
}
