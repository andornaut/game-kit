// The install offer on a page: holds the browser's install prompt, follows the install state and
// installs on request. It imports only installState, so a site's other pages can load it.
import {
  type InstallState,
  installState,
  type InstallStepsKind,
  installStepsKind,
  runsAsApp,
} from "../installState.ts";

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

// accepted or dismissed: the browser's prompt showed and the player chose. steps: no prompt to
// show, or it failed to show, so the page shows the steps for stepsKind.
export type InstallOutcome = "accepted" | "dismissed" | "steps";

export interface InstallFlow {
  // Shows the held prompt, or returns steps when none is held.
  install(): Promise<InstallOutcome>;
  // The browser whose install steps the page shows on steps. Fixed for the page's life.
  readonly stepsKind: InstallStepsKind;
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
    return "steps";
  }
}

// Starts listening at once: beforeinstallprompt can fire before the page has drawn anything, so
// the page calls this as it loads. The held prompt shows once; after the player's choice the
// browser offers a new one on a later visit, so until then the offer shows the steps.
export function watchInstall(host: InstallHost): InstallFlow {
  const stepsKind = installStepsKind(host.navigator.userAgent, host.navigator.maxTouchPoints);
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
        return "steps";
      }
      // A prompt shows once, so a second tap while it shows gets the steps.
      held = undefined;
      const outcome = await choose(event);
      if (outcome === "accepted") {
        appInstalled = true;
      }
      update();
      return outcome;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    state,
    stepsKind,
  };
}
