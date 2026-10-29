import { describe, expect, it } from "vitest";

import {
  APP_WINDOW_CLOSES,
  appCannotClose,
  type AppCloseHost,
  appPlatform,
  runsInAppWindow,
} from "./appWindow";
import { type CloseWatcherFactory, INSTALLED_APP_DISPLAY_QUERY } from "./backNavigation";

const CHROME = "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0";
const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 9)";
const DESKTOP = "Mozilla/5.0 (X11; Linux x86_64)";
const SAFARI = "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0";

// Each platform's browser by user agent and touch points. iPadOS asks for desktop sites by
// default, so its Safari names itself a Mac, told from one by its touch screen.
const PLATFORMS = [
  ["Chrome for Android", `${ANDROID} ${CHROME} Mobile Safari/537.36`, 5, "androidChromium"],
  [
    "Edge for Android",
    `${ANDROID} ${CHROME} Mobile Safari/537.36 EdgA/140.0.0.0`,
    5,
    "androidEdge",
  ],
  [
    "Firefox for Android",
    "Mozilla/5.0 (Android 15; Mobile; rv:150.0) Gecko/150.0 Firefox/150.0",
    5,
    "androidFirefox",
  ],
  [
    "Samsung Internet",
    `${ANDROID} AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36`,
    5,
    "androidSamsung",
  ],
  ["desktop Chrome", `${DESKTOP} ${CHROME} Safari/537.36`, 0, "desktopChromium"],
  ["desktop Edge", `${DESKTOP} ${CHROME} Safari/537.36 Edg/140.0.0.0`, 0, "desktopChromium"],
  ["desktop Opera", `${DESKTOP} ${CHROME} Safari/537.36 OPR/120.0.0.0`, 0, "other"],
  [
    "an iPhone's Safari",
    `Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) ${SAFARI} Mobile/15E148 Safari/604.1`,
    5,
    "ios",
  ],
  [
    "an iPad's Safari, named a Mac",
    `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ${SAFARI} Safari/605.1.15`,
    5,
    "ios",
  ],
  [
    "a Mac's Safari",
    `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ${SAFARI} Safari/605.1.15`,
    0,
    "macSafari",
  ],
  [
    "desktop Firefox",
    "Mozilla/5.0 (X11; Linux x86_64; rv:150.0) Gecko/20100101 Firefox/150.0",
    0,
    "other",
  ],
] as const;

// How the page runs: an installed app's window, by display mode or by iOS's navigator.standalone,
// or a browser tab.
const INSTALL_TYPES = [
  ["an app window (display mode)", true, false],
  ["an app window (navigator.standalone)", false, true],
  ["a browser tab", false, false],
] as const;

// A page on userAgent, run as appDisplay and standalone say, with historyLength entries.
function host(
  userAgent: string,
  maxTouchPoints: number,
  appDisplay: boolean,
  standalone: boolean,
  historyLength = 1,
): AppCloseHost {
  return {
    history: { length: historyLength },
    matchMedia: (query) => ({ matches: query === INSTALLED_APP_DISPLAY_QUERY && appDisplay }),
    navigator: { maxTouchPoints, standalone, userAgent },
  };
}

const WATCHER: CloseWatcherFactory = () => new EventTarget() as ReturnType<CloseWatcherFactory>;

describe("appPlatform", () => {
  it.each(PLATFORMS)("names %s's platform", (_, userAgent, touchPoints, platform) => {
    expect(appPlatform(userAgent, touchPoints)).toBe(platform);
  });
});

// Only Chrome's Android app and Chrome's and Edge's desktop app windows close.
describe("APP_WINDOW_CLOSES", () => {
  it("closes only on androidChromium and desktopChromium", () => {
    const closing = Object.entries(APP_WINDOW_CLOSES).filter(([, closes]) => closes);
    expect(closing.map(([platform]) => platform).sort()).toEqual([
      "androidChromium",
      "desktopChromium",
    ]);
  });
});

// Each platform run each way, with a close watcher and only the game's history entry: a tab is
// never an app, and an app window cannot close unless its platform's app closes.
describe.each(PLATFORMS)("on %s", (_, userAgent, touchPoints, platform) => {
  it.each(INSTALL_TYPES)("in %s", (__, appDisplay, standalone) => {
    const page = host(userAgent, touchPoints, appDisplay, standalone);
    const app = appDisplay || standalone;
    expect({ app: runsInAppWindow(page), cannotClose: appCannotClose(WATCHER, page) }).toEqual({
      app,
      cannotClose: app && !APP_WINDOW_CLOSES[platform],
    });
  });
});

// An app that closes cannot once its history will hold more than the game's entry: a launch with
// pages before the game, or a guard entry where it has no close watcher.
describe("appCannotClose in Chrome for Android's app", () => {
  const [, userAgent, touchPoints] = PLATFORMS[0];
  it.each([
    ["a close watcher and one entry", WATCHER, 1, false],
    ["no close watcher", undefined, 1, true],
    ["a page before the game", WATCHER, 2, true],
  ] as const)("with %s: %s", (_, watcher, historyLength, cannotClose) => {
    const page = host(userAgent, touchPoints, true, false, historyLength);
    expect(appCannotClose(watcher, page)).toBe(cannotClose);
  });
});
