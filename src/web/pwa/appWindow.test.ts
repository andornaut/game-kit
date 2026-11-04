import { describe, expect, it } from "vitest";

import { appCannotClose, type AppPlatform, appPlatform, runsInAppWindow } from "./appWindow.ts";
import { INSTALLED_APP_DISPLAY_QUERY } from "./backNavigation.ts";

const AGENTS = {
  androidChrome: "Mozilla/5.0 (Linux; Android 14) Chrome/142.0 Mobile Safari/537.36",
  androidEdge: "Mozilla/5.0 (Linux; Android 14) Chrome/142.0 Mobile Safari/537.36 EdgA/142.0",
  androidFirefox: "Mozilla/5.0 (Android 14; Mobile; rv:149.0) Gecko/149.0 Firefox/149.0",
  androidOpera: "Mozilla/5.0 (Linux; Android 14) Chrome/142.0 Mobile Safari/537.36 OPR/90.0",
  androidSamsung: "Mozilla/5.0 (Linux; Android 14) SamsungBrowser/28.0 Chrome/130.0 Mobile",
  desktopChrome: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/142.0 Safari/537.36",
  desktopEdge: "Mozilla/5.0 (Windows NT 10.0) Chrome/142.0 Safari/537.36 Edg/142.0",
  desktopFirefox: "Mozilla/5.0 (X11; Linux x86_64; rv:149.0) Gecko/20100101 Firefox/149.0",
  desktopOpera: "Mozilla/5.0 (Windows NT 10.0) Chrome/142.0 Safari/537.36 OPR/120.0",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148 Safari/604.1",
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15",
};

describe("appPlatform", () => {
  it.each<[string, number, AppPlatform]>([
    [AGENTS.androidChrome, 5, "androidChromium"],
    [AGENTS.androidEdge, 5, "androidEdge"],
    [AGENTS.androidFirefox, 5, "androidFirefox"],
    [AGENTS.androidOpera, 5, "other"],
    [AGENTS.androidSamsung, 5, "androidSamsung"],
    [AGENTS.desktopChrome, 0, "desktopChromium"],
    [AGENTS.desktopEdge, 0, "desktopChromium"],
    [AGENTS.desktopFirefox, 0, "other"],
    [AGENTS.desktopOpera, 0, "other"],
    [AGENTS.iphone, 5, "ios"],
    [AGENTS.mac, 5, "ios"],
    [AGENTS.mac, 0, "macSafari"],
  ])("names %s with %i touch points %s", (userAgent, touchPoints, platform) => {
    expect(appPlatform(userAgent, touchPoints)).toBe(platform);
  });
});

// A host whose display mode is installed or a tab, with standalone and history length set.
function host(userAgent: string, installed: boolean, historyLength = 1, standalone?: boolean) {
  return {
    history: { length: historyLength },
    matchMedia: (query: string) => ({
      matches: installed && query === INSTALLED_APP_DISPLAY_QUERY,
    }),
    navigator: {
      maxTouchPoints: 0,
      userAgent,
      ...(standalone === undefined ? {} : { standalone }),
    },
  };
}

describe("runsInAppWindow", () => {
  it.each<[string, boolean, boolean | undefined, boolean]>([
    ["a browser tab", false, undefined, false],
    ["an installed display mode", true, undefined, true],
    ["iOS's Home Screen app", false, true, true],
    ["iOS's Safari tab", false, false, false],
  ])("finds %s in an app window: %s", (_, installed, standalone, inApp) => {
    expect(runsInAppWindow(host(AGENTS.desktopChrome, installed, 1, standalone))).toBe(inApp);
  });
});

describe("appCannotClose", () => {
  const watcher = () => ({});

  it.each<[string, string, boolean, (() => unknown) | undefined, number, boolean]>([
    ["a browser tab", AGENTS.desktopChrome, false, undefined, 3, false],
    ["Chrome's app with a close watcher", AGENTS.androidChrome, true, watcher, 1, false],
    ["Edge's desktop app window", AGENTS.desktopEdge, true, watcher, 1, false],
    ["Chrome's app with pages before the game", AGENTS.androidChrome, true, watcher, 2, true],
    ["Chrome's app needing a guard entry", AGENTS.androidChrome, true, undefined, 1, true],
    ["Firefox for Android's app", AGENTS.androidFirefox, true, watcher, 1, true],
    ["Samsung Internet's app", AGENTS.androidSamsung, true, watcher, 1, true],
    ["macOS Safari's Dock app", AGENTS.mac, true, watcher, 1, true],
  ])("finds %s cannot close: %s", (_, userAgent, installed, factory, length, cannot) => {
    expect(appCannotClose(factory, host(userAgent, installed, length))).toBe(cannot);
  });
});
