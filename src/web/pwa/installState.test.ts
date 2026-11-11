import { describe, expect, it } from "vitest";

import {
  type InstallFacts,
  type InstallState,
  installState,
  type InstallStepsKind,
  installStepsKind,
  isFirefoxAndroid,
  isIosDevice,
  offersInstall,
} from "./installState.ts";

const ANDROID = "Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko)";
const ANDROID_CHROME = `${ANDROID} Chrome/142.0.0.0 Mobile Safari/537.36`;
const ANDROID_EDGE = `${ANDROID_CHROME} EdgA/142.0.0.0`;
const ANDROID_FIREFOX = "Mozilla/5.0 (Android 14; Mobile; rv:149.0) Gecko/149.0 Firefox/149.0";
const ANDROID_OPERA = `${ANDROID_CHROME} OPR/90.0.0.0`;
const ANDROID_WEBVIEW = `${ANDROID.replace("K)", "K; wv)")} Version/4.0 Chrome/142.0.0.0 Mobile Safari/537.36`;
const SAMSUNG = `${ANDROID} SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36`;
const DESKTOP_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
const DESKTOP_EDGE = `${DESKTOP_CHROME} Edg/142.0.0.0`;
const DESKTOP_OPERA = `${DESKTOP_CHROME} OPR/125.0.0.0`;
const DESKTOP_FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:149.0) Gecko/20100101 Firefox/149.0";
const MAC_FIREFOX =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.0; rv:149.0) Gecko/20100101 Firefox/149.0";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
const MAC_CHROME = `${MAC} AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36`;
const MAC_SAFARI = `${MAC} AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15`;
const LINUX_WEBKIT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1";
const FIREFOX_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) FxiOS/140.0";

const NONE: InstallFacts = {
  appInstalled: false,
  displayModeInstalled: false,
  hasPrompt: false,
  iosStandalone: false,
};

describe("installState", () => {
  it.each<[string, Partial<InstallFacts>, InstallState]>([
    ["no prompt", {}, "steps"],
    ["a held prompt", { hasPrompt: true }, "prompt"],
    ["an install this visit", { appInstalled: true, hasPrompt: true }, "installed"],
    ["the installed display mode", { displayModeInstalled: true }, "installed"],
    ["iOS's Home Screen app", { iosStandalone: true }, "installed"],
  ])("reads %s", (_, facts, state) => {
    expect(installState({ ...NONE, ...facts })).toBe(state);
  });
});

describe("offersInstall", () => {
  it.each<[InstallState, boolean]>([
    ["installed", false],
    ["prompt", true],
    ["steps", true],
  ])("offers install in state %s: %s", (state, offered) => {
    expect(offersInstall(state)).toBe(offered);
  });
});

describe("the browser", () => {
  it.each<[string, string, number, boolean, boolean, InstallStepsKind]>([
    ["Android Chrome", ANDROID_CHROME, 5, false, false, "chromiumAndroid"],
    ["Android Edge", ANDROID_EDGE, 5, false, false, "chromiumAndroid"],
    ["Firefox for Android", ANDROID_FIREFOX, 5, false, true, "firefoxAndroid"],
    ["Opera for Android", ANDROID_OPERA, 5, false, false, "other"],
    ["an Android WebView", ANDROID_WEBVIEW, 5, false, false, "other"],
    ["Samsung Internet", SAMSUNG, 5, false, false, "samsungInternet"],
    ["desktop Chrome", DESKTOP_CHROME, 0, false, false, "chromiumDesktop"],
    ["desktop Edge", DESKTOP_EDGE, 0, false, false, "chromiumDesktop"],
    ["desktop Opera", DESKTOP_OPERA, 0, false, false, "other"],
    ["desktop Firefox", DESKTOP_FIREFOX, 0, false, false, "firefoxDesktop"],
    ["Firefox on a Mac", MAC_FIREFOX, 0, false, false, "firefoxDesktop"],
    ["Chrome on a Mac", MAC_CHROME, 0, false, false, "chromiumDesktop"],
    ["Safari on a Mac", MAC_SAFARI, 0, false, false, "safariMac"],
    ["an unlisted browser", LINUX_WEBKIT, 0, false, false, "other"],
    ["an iPhone", IPHONE, 5, true, false, "ios"],
    ["Firefox on iOS", FIREFOX_IOS, 5, true, false, "ios"],
    ["an iPad asking for the desktop site", MAC_SAFARI, 5, true, false, "ios"],
  ])("classifies %s", (_, userAgent, touchPoints, ios, firefoxAndroid, kind) => {
    expect([
      isIosDevice(userAgent, touchPoints),
      isFirefoxAndroid(userAgent),
      installStepsKind(userAgent, touchPoints),
    ]).toEqual([ios, firefoxAndroid, kind]);
  });
});
