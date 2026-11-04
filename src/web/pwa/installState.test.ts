import { describe, expect, it } from "vitest";

import {
  type InstallFacts,
  installState,
  isFirefoxAndroid,
  isIosDevice,
  menuInstallBrowser,
  offersInstall,
} from "./installState.ts";

const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Mobile";
const ANDROID_FIREFOX = "Mozilla/5.0 (Android 14; Mobile; rv:149.0) Gecko/149.0 Firefox/149.0";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15";
const FIREFOX_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) FxiOS/140.0";

const NONE: InstallFacts = {
  appInstalled: false,
  displayModeInstalled: false,
  hasPrompt: false,
  iosStandalone: false,
  menuBrowser: undefined,
};

describe("installState", () => {
  it.each<[string, Partial<InstallFacts>, ReturnType<typeof installState>]>([
    ["nothing to install with", {}, "unsupported"],
    ["a held prompt", { hasPrompt: true }, "prompt"],
    ["a menu browser", { menuBrowser: "ios" }, "menuSteps"],
    ["a prompt in a menu browser", { hasPrompt: true, menuBrowser: "firefoxAndroid" }, "prompt"],
    ["an install this visit", { appInstalled: true, hasPrompt: true }, "installed"],
    ["the installed display mode", { displayModeInstalled: true, menuBrowser: "ios" }, "installed"],
    ["iOS's Home Screen app", { iosStandalone: true }, "installed"],
  ])("reads %s", (_, facts, state) => {
    expect(installState({ ...NONE, ...facts })).toBe(state);
  });
});

describe("offersInstall", () => {
  it.each<[ReturnType<typeof installState>, boolean]>([
    ["installed", false],
    ["menuSteps", true],
    ["prompt", true],
    ["unsupported", false],
  ])("offers install in state %s: %s", (state, offered) => {
    expect(offersInstall(state)).toBe(offered);
  });
});

describe("the browser", () => {
  it.each<[string, string, number, boolean, boolean, ReturnType<typeof menuInstallBrowser>]>([
    ["Android Chrome", ANDROID_CHROME, 5, false, false, undefined],
    ["Firefox for Android", ANDROID_FIREFOX, 5, false, true, "firefoxAndroid"],
    ["an iPhone", IPHONE, 5, true, false, "ios"],
    ["Firefox on iOS", FIREFOX_IOS, 5, true, false, "ios"],
    ["an iPad asking for the desktop site", MAC, 5, true, false, "ios"],
    ["a Mac", MAC, 0, false, false, undefined],
  ])("classifies %s", (_, userAgent, touchPoints, ios, firefoxAndroid, menu) => {
    expect([
      isIosDevice(userAgent, touchPoints),
      isFirefoxAndroid(userAgent),
      menuInstallBrowser(userAgent, touchPoints),
    ]).toEqual([ios, firefoxAndroid, menu]);
  });
});
