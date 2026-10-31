import { describe, expect, it } from "vitest";

import { appCannotClose, type AppCloseHost, appPlatform, runsInAppWindow } from "./appWindow";
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

describe("app window detection", () => {
  it.each([
    ["display mode", true, false, true],
    ["iOS standalone", false, true, true],
    ["a browser tab", false, false, false],
  ] as const)("detects %s", (_, appDisplay, standalone, expected) => {
    const page = host(`${ANDROID} ${CHROME}`, 5, appDisplay, standalone);
    expect(runsInAppWindow(page)).toBe(expected);
  });
});

describe("appCannotClose", () => {
  it.each([
    ["Android Chrome's app", `${ANDROID} ${CHROME}`, 5, true, false],
    ["desktop Chrome's app", `${DESKTOP} ${CHROME}`, 0, true, false],
    ["iOS's app", `iPhone ${SAFARI}`, 5, true, true],
    ["an unsupported app", "Unknown", 0, true, true],
    ["a browser tab on an unsupported platform", "Unknown", 0, false, false],
  ] as const)("checks %s", (_, userAgent, touchPoints, appDisplay, expected) => {
    expect(appCannotClose(WATCHER, host(userAgent, touchPoints, appDisplay, false))).toBe(expected);
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
