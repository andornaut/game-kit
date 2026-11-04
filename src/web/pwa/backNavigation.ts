// What back means for a game page: the guard entry's history state, the inputs that push it, and
// where a close watcher can catch back. dom/backNavigation binds these to the page.
import { isFirefoxAndroid } from "./installState.ts";

// The history state of the extra entry that back pops instead of leaving the game.
export function backGuardState(stateKey: string): Readonly<Record<string, true>> {
  return { [stateKey]: true };
}

// Whether a history state is the guard entry's, a page reloaded on it included.
export function isBackGuardState(stateKey: string, state: unknown): boolean {
  return (state as Record<string, unknown> | null)?.[stateKey] === true;
}

// The player's input that pushes the guard entry, or creates the close watcher, when it is
// missing. The browser records each one, an Escape keydown aside, as user interaction on the
// current history entry before the page sees it, so the guard goes on top of an entry that back
// may return to. A touch's pointerdown is recorded on none: a guard pushed from it would take the
// interaction its pointerup brings, leaving the game's entry without one.
export const BACK_GUARD_GESTURES = ["keydown", "pointerup"] as const;

// The key that is a close request on a keyboard. The game's own keys handle it, so the close it
// causes is not a back press.
export const ESCAPE_KEY = "Escape";

// The close watchers that catch back, or undefined where the guard entry must: where the browser
// has none, and in Firefox for Android, which hands back to a close watcher only when its history
// can go back, and otherwise leaves the page.
export function backCloseWatcher<Factory>(
  userAgent: string,
  createCloseWatcher: Factory | undefined,
): Factory | undefined {
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
