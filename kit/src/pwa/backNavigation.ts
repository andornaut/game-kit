import { isFirefoxAndroid } from "./installState";

export interface HistoryLike {
  // How many entries the window's session history holds, before and after the current one.
  readonly length: number;
  pushState(data: unknown, unused: string): void;
  readonly state: unknown;
}

// The part of a CloseWatcher the game uses: it fires close on a close request (the Android back
// gesture or button, or Escape on a keyboard) and is spent by it. TypeScript's DOM lib has no
// CloseWatcher type.
export type CloseWatcherLike = EventTarget;

// Creates a CloseWatcher, where the browser has them.
export type CloseWatcherFactory = () => CloseWatcherLike;

// The page's timer, which ends an Escape press's handling once its close has fired.
export interface TimerHost {
  setTimeout(handler: () => void, ms: number): unknown;
}

export interface BackGuardOptions {
  // Called on each back the guard keeps on the game, for the game to decide what back means.
  readonly onBack: () => void;
  // The key the guard entry's history state sets true, which tells the entry from any other
  // state, a page reloaded on it included. Unique to the game, as its history is shared with
  // other pages.
  readonly stateKey: string;
}

// The history state of the extra entry that back pops instead of leaving the game.
export function backGuardState(stateKey: string): Readonly<Record<string, true>> {
  return { [stateKey]: true };
}

// The player's input that pushes the guard entry, or creates the close watcher, when it is
// missing. The browser records each one, an Escape keydown aside, as user interaction on the
// current history entry before the page sees it, so the guard goes on top of an entry that back
// may return to. A touch's pointerdown is recorded on none: a guard pushed from it would take the
// interaction its pointerup brings, leaving the game's entry without one.
export const BACK_GUARD_GESTURES = ["keydown", "pointerup"] as const;

// The key that is a close request on a keyboard. The game's own keys handle it, so the close it
// causes is not a back press.
const ESCAPE_KEY = "Escape";

// The close watchers that catch back, or undefined where the guard entry must: where the browser
// has none, and in Firefox for Android, which hands back to a close watcher only when its history
// can go back, and otherwise leaves the page.
export function backCloseWatcher(
  userAgent: string,
  createCloseWatcher: CloseWatcherFactory | undefined,
): CloseWatcherFactory | undefined {
  return isFirefoxAndroid(userAgent) ? undefined : createCloseWatcher;
}

// The display modes an installed app runs in, any of which Firefox for Android may report.
export const INSTALLED_APP_DISPLAY_QUERY =
  "(display-mode: fullscreen), (display-mode: standalone), (display-mode: minimal-ui)";

// Whether the page runs as Firefox for Android's installed app, where the game leaves back to the
// browser: no close watcher and no guard entry, so the game never hears back.
// displayModeMatches answers a media query.
// WORKAROUND: https://bugzilla.mozilla.org/show_bug.cgi?id=2079243 Firefox for Android's
// installed app shows a blank page on back with no history and ignores window.close(), so the
// game leaves back to it. Remove this exception once the bug is fixed.
export function isFirefoxAndroidApp(
  userAgent: string,
  displayModeMatches: (query: string) => boolean,
): boolean {
  return isFirefoxAndroid(userAgent) && displayModeMatches(INSTALLED_APP_DISPLAY_QUERY);
}

function isBackGuardState(stateKey: string, state: unknown): boolean {
  return (state as Record<string, unknown> | null)?.[stateKey] === true;
}

// The browser's CloseWatcher, where it has one (Chrome 120 and later, Firefox 149 and later).
export function browserCloseWatcher(): CloseWatcherFactory | undefined {
  const CloseWatcher = (globalThis as { CloseWatcher?: new () => CloseWatcherLike }).CloseWatcher;
  return CloseWatcher === undefined ? undefined : () => new CloseWatcher();
}

function eventKey(event: Event): unknown {
  return (event as { key?: unknown }).key;
}

// Keeps back (Android gesture or button, or the browser's Back) on the game, in a browser tab or
// installed as an app; each back calls onBack.
// Two ways catch it:
// - A close watcher, where the browser has CloseWatcher, created at load and again after each
//   close it fires. It adds no history entry, so with nothing before the game the history holds
//   one entry, as an installed app's window needs for a script to close it.
// - A guard history entry for back to pop, pushed again on each pop, where there is no close
//   watcher (backCloseWatcher) or the history already holds more than one entry, so the window
//   could not close anyway. It also catches a desktop browser's Back button, which is not a close
//   request. The user's back skips an entry with no user interaction recorded on it (Firefox) or
//   one that added an entry without user activation (Chrome), and with no other entry before it
//   leaves the page. So the guard goes on top of the game's entry only from the player's first
//   input (BACK_GUARD_GESTURES), never at load, and again from any later input that finds it
//   missing; back before that input is the browser's own.
// This cannot stop the system closing the app or a browser showing its own leave prompt.
export function guardBackNavigation(
  { onBack, stateKey }: BackGuardOptions,
  eventTarget: EventTarget,
  host: TimerHost,
  createCloseWatcher: CloseWatcherFactory | undefined,
  history: HistoryLike,
): void {
  // Whether an Escape keydown is being handled: the close it causes is the keyboard's, not back.
  let escaping = false;
  let watcher: CloseWatcherLike | undefined;

  const usesGuard = () => createCloseWatcher === undefined || history.length > 1;
  const isGuard = () => isBackGuardState(stateKey, history.state);
  const pushGuard = () => {
    if (usesGuard() && !isGuard()) {
      history.pushState(backGuardState(stateKey), "");
    }
  };
  const onClose = () => {
    watcher = undefined;
    watchClose();
    if (!escaping) {
      onBack();
    }
  };
  const watchClose = () => {
    if (createCloseWatcher !== undefined && watcher === undefined) {
      watcher = createCloseWatcher();
      watcher.addEventListener("close", onClose, { once: true });
    }
  };
  const onGesture = (event: Event) => {
    // Escape is no user activation, so it pushes no guard.
    if (event.type === "keydown" && eventKey(event) === ESCAPE_KEY) {
      escaping = true;
      host.setTimeout(() => {
        escaping = false;
      }, 0);
    } else {
      pushGuard();
    }
    watchClose();
  };
  const onPopState = () => {
    // Forward onto the guard entry is not a back press.
    if (isGuard()) {
      return;
    }
    pushGuard();
    onBack();
  };
  for (const type of BACK_GUARD_GESTURES) {
    eventTarget.addEventListener(type, onGesture, { capture: true, passive: true });
  }
  eventTarget.addEventListener("popstate", onPopState);
  watchClose();
}
