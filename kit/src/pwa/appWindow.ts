import { type CloseWatcherFactory, INSTALLED_APP_DISPLAY_QUERY } from "./backNavigation";
import { isFirefoxAndroid, isIosDevice } from "./installState";

// The parts of window these read, so tests can pass a fake.
export interface AppWindowHost {
  matchMedia(query: string): { readonly matches: boolean };
  readonly navigator: {
    readonly maxTouchPoints: number;
    // iOS only: opened from the Home Screen.
    readonly standalone?: boolean;
    readonly userAgent: string;
  };
}

// An app window's host, with the history whose length decides whether a script may close it.
export interface AppCloseHost extends AppWindowHost {
  readonly history: { readonly length: number };
}

// Whether the page runs in an installed app's own window rather than a browser tab: a display
// mode an installed app runs in (INSTALLED_APP_DISPLAY_QUERY), or iOS's navigator.standalone.
export function runsInAppWindow(host: AppWindowHost): boolean {
  return host.navigator.standalone === true || host.matchMedia(INSTALLED_APP_DISPLAY_QUERY).matches;
}

// The platform an installed app runs on, as far as closing its window goes. ios covers iPadOS,
// which names itself a Mac (isIosDevice). androidChromium is Chrome alone: Samsung Internet and
// Edge name Chrome in their user agents too. desktopChromium is Chrome and Edge.
export type AppPlatform =
  | "androidChromium"
  | "androidEdge"
  | "androidFirefox"
  | "androidSamsung"
  | "desktopChromium"
  | "ios"
  | "macSafari"
  | "other";

export function appPlatform(userAgent: string, maxTouchPoints: number): AppPlatform {
  if (isIosDevice(userAgent, maxTouchPoints)) {
    return "ios";
  }
  if (/Android/.test(userAgent)) {
    if (isFirefoxAndroid(userAgent)) {
      return "androidFirefox";
    }
    if (/SamsungBrowser\//.test(userAgent)) {
      return "androidSamsung";
    }
    if (/EdgA\//.test(userAgent)) {
      return "androidEdge";
    }
    return /Chrome\//.test(userAgent) && !/OPR\//.test(userAgent) ? "androidChromium" : "other";
  }
  if (/Chrome\//.test(userAgent)) {
    // Chrome, or Edge (Edg/); Opera (OPR/) and other Chromium browsers are not checked.
    return /OPR\//.test(userAgent) ? "other" : "desktopChromium";
  }
  return /Macintosh/.test(userAgent) && /Safari\//.test(userAgent) ? "macSafari" : "other";
}

// Whether a script's window.close() closes an installed app's window, by platform. The HTML
// spec lets a script close only a script-closable window, one whose session history holds a
// single entry (https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-window-close),
// and of installed apps only Chromium's honour it: Chrome's Android app (WebAPK or TWA), and
// Chrome's and Edge's app windows on desktop.
// - androidFirefox: never closes. WORKAROUND: https://bugzilla.mozilla.org/show_bug.cgi?id=2079243
//   Firefox for Android's installed app shows a blank page on back with no history and ignores
//   window.close(). Set it true once the bug is fixed.
// - ios: a Home Screen web app on iOS or iPadOS never closes; only the app switcher closes it.
// - androidEdge, androidSamsung, macSafari: not verified to close, so taken not to.
// - other: any browser not listed, taken not to close.
export const APP_WINDOW_CLOSES: Readonly<Record<AppPlatform, boolean>> = {
  androidChromium: true,
  androidEdge: false,
  androidFirefox: false,
  androidSamsung: false,
  desktopChromium: true,
  ios: false,
  macSafari: false,
  other: false,
};

// Whether the page runs as an installed app whose window a script cannot close: its platform's
// app never closes (APP_WINDOW_CLOSES), or its history will hold more than the game's entry, which
// the browser then refuses to close. That is a launch with pages before the game, or a back guard
// entry, which guardBackNavigation pushes where it has no close watcher; createCloseWatcher is the
// factory the game gives it (backCloseWatcher's). Read it as the page loads, before any entry is
// pushed. A browser tab is never such an app.
export function appCannotClose(
  createCloseWatcher: CloseWatcherFactory | undefined,
  host: AppCloseHost,
): boolean {
  if (!runsInAppWindow(host)) {
    return false;
  }
  const { maxTouchPoints, userAgent } = host.navigator;
  const guardEntry = createCloseWatcher === undefined || host.history.length > 1;
  return guardEntry || !APP_WINDOW_CLOSES[appPlatform(userAgent, maxTouchPoints)];
}
