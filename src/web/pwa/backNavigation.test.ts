import { describe, expect, it } from "vitest";

import {
  backCloseWatcher,
  backGuardState,
  INSTALLED_APP_DISPLAY_QUERY,
  isBackGuardState,
  isFirefoxAndroidApp,
} from "./backNavigation.ts";

const ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 14) Chrome/142.0 Mobile Safari/537.36";
const ANDROID_FIREFOX = "Mozilla/5.0 (Android 14; Mobile; rv:149.0) Gecko/149.0 Firefox/149.0";
const DESKTOP_FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:149.0) Gecko/20100101 Firefox/149.0";

describe("isBackGuardState", () => {
  it.each<[string, unknown, boolean]>([
    ["the guard entry's state", backGuardState("gameGuard"), true],
    ["another game's guard state", backGuardState("otherGuard"), false],
    ["a state setting the key to another value", { gameGuard: 1 }, false],
    ["no state", null, false],
    ["a primitive state", "gameGuard", false],
  ])("tells %s: %s", (_, state, guard) => {
    expect(isBackGuardState("gameGuard", state)).toBe(guard);
  });
});

describe("backCloseWatcher", () => {
  const factory = () => "watcher";

  it.each<[string, string, typeof factory | undefined, typeof factory | undefined]>([
    ["Android Chrome", ANDROID_CHROME, factory, factory],
    ["desktop Firefox", DESKTOP_FIREFOX, factory, factory],
    ["Firefox for Android", ANDROID_FIREFOX, factory, undefined],
    ["a browser without close watchers", ANDROID_CHROME, undefined, undefined],
  ])("uses %s's close watchers or none", (_, userAgent, given, used) => {
    expect(backCloseWatcher(userAgent, given)).toBe(used);
  });
});

describe("isFirefoxAndroidApp", () => {
  it.each<[string, string, boolean, boolean]>([
    ["Firefox for Android's app", ANDROID_FIREFOX, true, true],
    ["a Firefox for Android tab", ANDROID_FIREFOX, false, false],
    ["Chrome's app", ANDROID_CHROME, true, false],
  ])("finds %s: %s", (_, userAgent, installed, found) => {
    const asked: string[] = [];
    const matches = (query: string) => {
      asked.push(query);
      return installed;
    };
    expect(isFirefoxAndroidApp(userAgent, matches)).toBe(found);
    expect(asked.every((query) => query === INSTALLED_APP_DISPLAY_QUERY)).toBe(true);
  });
});
