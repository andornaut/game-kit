import { describe, expect, it, vi } from "vitest";

import {
  type InstallHost,
  type InstallOutcome,
  type InstallPromptEvent,
  type MediaQueryLike,
  watchInstall,
} from "./installFlow";
import type { InstallState, MenuInstallBrowser } from "./installState";

const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/140.0";
const FIREFOX_ANDROID = "Mozilla/5.0 (Android 15; Mobile; rv:144.0) Gecko/144.0 Firefox/144.0";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15";

class FakeMediaQuery extends EventTarget implements MediaQueryLike {
  matches = false;

  set(matches: boolean): void {
    this.matches = matches;
    this.dispatchEvent(new Event("change"));
  }
}

class FakeHost extends EventTarget implements InstallHost {
  readonly display = new FakeMediaQuery();
  readonly navigator: { maxTouchPoints: number; standalone?: boolean; userAgent: string };

  constructor(userAgent: string, standalone?: boolean) {
    super();
    this.navigator = {
      maxTouchPoints: 5,
      userAgent,
      ...(standalone === undefined ? {} : { standalone }),
    };
  }

  matchMedia(): MediaQueryLike {
    return this.display;
  }
}

// A beforeinstallprompt event whose prompt resolves the choice given, or rejects.
function promptEvent(choice: "accepted" | "dismissed" | "fails"): InstallPromptEvent {
  const event = new Event("beforeinstallprompt", { cancelable: true });
  const outcome: "accepted" | "dismissed" = choice === "accepted" ? "accepted" : "dismissed";
  return Object.assign(event, {
    prompt: vi.fn(() =>
      choice === "fails" ? Promise.reject(new Error("NotAllowedError")) : Promise.resolve(),
    ),
    userChoice: Promise.resolve({ outcome }),
  });
}

function watched(host: FakeHost) {
  const flow = watchInstall(host);
  const seen: InstallState[] = [];
  flow.onChange((state) => seen.push(state));
  return { flow, seen };
}

describe("watchInstall", () => {
  it.each<[string, FakeHost, InstallState]>([
    [
      "offers nothing on Android until the browser hands over its prompt",
      new FakeHost(ANDROID),
      "unsupported",
    ],
    ["offers the menu steps on iOS", new FakeHost(IPHONE), "menuSteps"],
    ["offers the menu steps in Firefox for Android", new FakeHost(FIREFOX_ANDROID), "menuSteps"],
    ["is installed when opened from the iOS Home Screen", new FakeHost(IPHONE, true), "installed"],
  ])("%s", (_, host, expected) => {
    expect(watchInstall(host).state()).toBe(expected);
  });

  it("holds the browser's prompt, keeping its own banner away, and offers it", () => {
    const host = new FakeHost(ANDROID);
    const { flow, seen } = watched(host);
    const event = promptEvent("accepted");
    host.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(flow.state()).toBe("prompt");
    expect(seen).toEqual(["prompt"]);
  });

  it.each<[string, "accepted" | "dismissed" | "fails", InstallOutcome, InstallState]>([
    ["is installed once the player accepts", "accepted", "accepted", "installed"],
    [
      "hides the offer once the player dismisses the prompt",
      "dismissed",
      "dismissed",
      "unsupported",
    ],
    ["hides the offer when the prompt fails", "fails", "unavailable", "unsupported"],
  ])("%s", async (_, choice, outcome, after) => {
    const host = new FakeHost(ANDROID);
    const { flow, seen } = watched(host);
    const event = promptEvent(choice);
    host.dispatchEvent(event);
    const installing = flow.install();
    // Asked for at once, while the tap still counts as the player's gesture.
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(await installing).toBe(outcome);
    expect(flow.state()).toBe(after);
    expect(seen).toEqual(["prompt", after]);
  });

  it.each<[string, string, InstallOutcome, MenuInstallBrowser | undefined]>([
    ["tells iOS to show its menu steps", IPHONE, "menuSteps", "ios"],
    [
      "tells Firefox for Android to show its menu steps",
      FIREFOX_ANDROID,
      "menuSteps",
      "firefoxAndroid",
    ],
    ["has nothing to install with and no prompt held", ANDROID, "unavailable", undefined],
  ])("%s", async (_, userAgent, outcome, browser) => {
    const flow = watchInstall(new FakeHost(userAgent));
    expect({ browser: flow.menuBrowser, outcome: await flow.install() }).toEqual({
      browser,
      outcome,
    });
  });

  it("is installed when Firefox for Android opens the installed page standalone", () => {
    const host = new FakeHost(FIREFOX_ANDROID);
    const { flow, seen } = watched(host);
    host.display.set(true);
    expect([flow.state(), seen]).toEqual(["installed", ["installed"]]);
  });

  it("switches to installed on appinstalled and on an installed display mode", () => {
    const host = new FakeHost(ANDROID);
    const { flow, seen } = watched(host);
    host.dispatchEvent(promptEvent("accepted"));
    host.dispatchEvent(new Event("appinstalled"));
    expect(flow.state()).toBe("installed");

    const opened = new FakeHost(IPHONE);
    const inApp = watched(opened);
    opened.display.set(true);
    expect(inApp.flow.state()).toBe("installed");
    expect([seen, inApp.seen]).toEqual([["prompt", "installed"], ["installed"]]);
  });

  it("stops calling a listener once it unsubscribes", () => {
    const host = new FakeHost(ANDROID);
    const flow = watchInstall(host);
    const listener = vi.fn();
    flow.onChange(listener)();
    host.dispatchEvent(promptEvent("accepted"));
    expect(listener).not.toHaveBeenCalled();
  });
});
