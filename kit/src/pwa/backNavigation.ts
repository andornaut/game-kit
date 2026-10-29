import { isFirefoxAndroid } from "./installState";

export interface HistoryLike {
  go(delta: number): void;
  // How many entries the window's session history holds, before and after the current one.
  readonly length: number;
  pushState(data: unknown, unused: string): void;
  readonly state: unknown;
}

// The part of a CloseWatcher the game uses: it fires close on a close request (the Android back
// gesture or button, or Escape on a keyboard) and is spent by it. TypeScript's DOM lib has no
// CloseWatcher type.
export interface CloseWatcherLike extends EventTarget {
  destroy(): void;
}

// Creates a CloseWatcher, where the browser has them.
export type CloseWatcherFactory = () => CloseWatcherLike;

// What leaving the game needs of the page besides its history.
export interface LeaveHost {
  // Closes the window, where the browser lets a script close it.
  close(): void;
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

// How long leaving waits for the page to go before it tries closing the window instead.
export const LEAVE_WAIT_MS = 500;

// The key that is a close request on a keyboard. The game's own keys handle it, so the close it
// causes is not a back press.
const ESCAPE_KEY = "Escape";

export interface BackGuard {
  // Leaves the game. With nothing before the game's entry (an installed app's launch, or a tab
  // opened on the game), it closes the window, which the browser allows while the history holds
  // only that entry. Otherwise it goes back over the guard entry, without pushing it again, and
  // past the game's own entry to the previous page, and closes the window if the page is still
  // there after LEAVE_WAIT_MS. Where the window stays, nothing catches the next back (an
  // installed app closes) unless the player's input first restores the guard or the watcher.
  leave(): void;
}

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
//   one entry and leave may close the window.
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
  host: LeaveHost,
  createCloseWatcher: CloseWatcherFactory | undefined,
  history: HistoryLike,
): BackGuard {
  // Whether leave has stepped back over the guard and goes on past the game's own entry once it
  // lands there.
  let leaving = false;
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
    if (leaving) {
      leaving = false;
      history.go(-1);
      return;
    }
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
  // A page restored from the back-forward cache after leaving catches back again.
  eventTarget.addEventListener("pageshow", watchClose);
  watchClose();
  return {
    leave() {
      watcher?.removeEventListener("close", onClose);
      watcher?.destroy();
      watcher = undefined;
      if (history.length <= 1) {
        host.close();
        return;
      }
      // A page kept for back-forward caching hides here: back on it later must not close it.
      let hidden = false;
      const onPageHide = () => {
        hidden = true;
      };
      eventTarget.addEventListener("pagehide", onPageHide, { once: true });
      leaving = isGuard();
      history.go(-1);
      host.setTimeout(() => {
        eventTarget.removeEventListener("pagehide", onPageHide);
        if (!hidden) {
          host.close();
        }
      }, LEAVE_WAIT_MS);
    },
  };
}
