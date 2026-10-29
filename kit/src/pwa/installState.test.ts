import { describe, expect, it } from "vitest";

import {
  type InstallFacts,
  type InstallState,
  installState,
  type MenuInstallBrowser,
  menuInstallBrowser,
  offersInstall,
  runsAsApp,
} from "./installState";

const NONE: InstallFacts = {
  appInstalled: false,
  displayModeInstalled: false,
  hasPrompt: false,
  iosStandalone: false,
  menuBrowser: undefined,
};

describe("installState", () => {
  it.each<[string, Partial<InstallFacts>, InstallState]>([
    [
      "is installed in a fullscreen or standalone window",
      { displayModeInstalled: true, hasPrompt: true },
      "installed",
    ],
    [
      "is installed in Firefox for Android's standalone window",
      { displayModeInstalled: true, menuBrowser: "firefoxAndroid" },
      "installed",
    ],
    [
      "is installed when opened from the iOS Home Screen",
      { iosStandalone: true, menuBrowser: "ios" },
      "installed",
    ],
    [
      "is installed once installed during the visit",
      { appInstalled: true, hasPrompt: true },
      "installed",
    ],
    ["offers the browser's prompt while one is held", { hasPrompt: true }, "prompt"],
    ["offers the menu steps on iOS", { menuBrowser: "ios" }, "menuSteps"],
    [
      "offers the menu steps in Firefox for Android",
      { menuBrowser: "firefoxAndroid" },
      "menuSteps",
    ],
    ["offers nothing elsewhere", {}, "unsupported"],
  ])("%s", (_, facts, expected) => {
    expect(installState({ ...NONE, ...facts })).toBe(expected);
  });
});

describe("runsAsApp", () => {
  it.each<[string, Partial<InstallFacts>, boolean]>([
    ["runs as the app in a fullscreen or standalone window", { displayModeInstalled: true }, true],
    ["runs as the app when opened from the iOS Home Screen", { iosStandalone: true }, true],
    ["runs in a browser tab", {}, false],
    ["runs in a browser tab after installing during the visit", { appInstalled: true }, false],
  ])("%s", (_, facts, expected) => {
    expect(runsAsApp({ ...NONE, ...facts })).toBe(expected);
  });
});

describe("offersInstall", () => {
  it.each<[InstallState, boolean]>([
    ["installed", false],
    ["menuSteps", true],
    ["prompt", true],
    ["unsupported", false],
  ])("for %s is %s", (state, expected) => {
    expect(offersInstall(state)).toBe(expected);
  });
});

describe("menuInstallBrowser", () => {
  // The engine tokens real user agents carry: Blink's and WebKit's.
  const BLINK = "AppleWebKit/537.36 (KHTML, like Gecko)";
  const WEBKIT = "AppleWebKit/605.1.15 (KHTML, like Gecko)";
  const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X)";
  const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";

  it.each<[string, string, number, MenuInstallBrowser | undefined]>([
    [
      "Chrome for Android",
      `Mozilla/5.0 (Linux; Android 15; Pixel 9) ${BLINK} Chrome/140.0.0.0 Mobile Safari/537.36`,
      5,
      undefined,
    ],
    [
      "Firefox for Android",
      "Mozilla/5.0 (Android 15; Mobile; rv:144.0) Gecko/144.0 Firefox/144.0",
      5,
      "firefoxAndroid",
    ],
    [
      "Firefox for Android on a tablet",
      "Mozilla/5.0 (Android 14; Tablet; rv:144.0) Gecko/144.0 Firefox/144.0",
      5,
      "firefoxAndroid",
    ],
    [
      "Firefox on Linux",
      "Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0",
      0,
      undefined,
    ],
    [
      "Firefox on Windows",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0",
      0,
      undefined,
    ],
    ["Firefox on iOS", `${IPHONE} ${WEBKIT} FxiOS/144.0 Mobile/15E148 Safari/605.1.15`, 5, "ios"],
    [
      "Safari on an iPad asking for the desktop site",
      `${MAC} ${WEBKIT} Version/18.6 Safari/605.1.15`,
      5,
      "ios",
    ],
    [
      "Safari on an iPhone",
      `${IPHONE} ${WEBKIT} Version/18.6 Mobile/15E148 Safari/604.1`,
      5,
      "ios",
    ],
    ["Safari on a Mac", `${MAC} ${WEBKIT} Version/18.6 Safari/605.1.15`, 0, undefined],
    [
      "Samsung Internet",
      `Mozilla/5.0 (Linux; Android 14; SM-S928B) ${BLINK} SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36`,
      5,
      undefined,
    ],
  ])("finds %s", (_, userAgent, touchPoints, expected) => {
    expect(menuInstallBrowser(userAgent, touchPoints)).toBe(expected);
  });
});
