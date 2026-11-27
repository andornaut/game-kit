import { describe, expect, it, vi } from "vitest";

import { browserLaunchLocation, takeBackReloadTail } from "./backReloadTail.ts";

const home = { id: "home-id", index: 0, key: "home-key" };
const play = { id: "play-id", index: 1, key: "play-key" };
const href = "http://localhost/play/";

function trusted(type: string, properties: object): Event {
  const event = new Event(type, { cancelable: true });
  return Object.assign(Object.defineProperty(event, "isTrusted", { value: true }), properties);
}

function documentFixture(
  storage: Map<string, string>,
  navigationType: "push" | "reload" | "traverse",
) {
  const navigation = Object.assign(new EventTarget(), {
    activation: { entry: play, from: navigationType === "reload" ? play : home, navigationType },
    currentEntry: play,
    entries: vi.fn(() => [home, play]),
  });
  const abort = new AbortController();
  const reloadEvent = trusted("navigate", {
    destination: { url: href },
    navigationType: "reload",
    signal: abort.signal,
  });
  const history = { length: 3 };
  const reload = vi.fn(() => {
    navigation.dispatchEvent(reloadEvent);
  });
  const page = Object.assign(new EventTarget(), {
    history,
    length: 0,
    location: { href, reload },
    navigation,
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => storage.delete(key),
      setItem: (key: string, value: string) => storage.set(key, value),
    },
    setTimeout: vi.fn(),
  }) as unknown as Window;
  Object.defineProperty(page, "top", { configurable: true, value: page });
  const hide = () => page.dispatchEvent(trusted("pagehide", { persisted: false }));
  return { abort, hide, history, navigation, page, reload, reloadEvent };
}

function record(storage: Map<string, string>) {
  const old = documentFixture(storage, "push");
  browserLaunchLocation(() => true, old.page).reload();
  old.hide();
  expect(storage.size).toBe(1);
}

describe("the first-install Back tail witness", () => {
  it("carries a proven tail through the matching reload and consumes it once", () => {
    const storage = new Map<string, string>();
    const old = documentFixture(storage, "push");
    const port = browserLaunchLocation(() => true, old.page);
    expect(port.href).toBe(href);
    port.reload();
    expect(old.reload).toHaveBeenCalledOnce();
    expect(storage.size).toBe(0);
    old.hide();

    const next = documentFixture(storage, "reload");
    browserLaunchLocation(() => false, next.page);
    expect(storage.size).toBe(0);
    expect(takeBackReloadTail(next.history, next.page)).toBe(1);
    expect(takeBackReloadTail(next.history, next.page)).toBeUndefined();
  });

  it.each([
    "foreign Forward",
    "update",
    "canceled reload",
    "intervening navigation",
    "embedded document",
  ] as const)("does not carry a witness for %s", (scenario) => {
    const storage = new Map<string, string>();
    const old = documentFixture(storage, scenario === "foreign Forward" ? "traverse" : "push");
    if (scenario === "embedded document") {
      Object.defineProperty(old.page, "top", { value: null });
    }
    browserLaunchLocation(() => scenario !== "update", old.page).reload();
    if (scenario === "canceled reload") {
      old.reloadEvent.preventDefault();
      old.abort.abort();
    }
    if (scenario === "intervening navigation") {
      old.navigation.dispatchEvent(trusted("navigate", { navigationType: "traverse" }));
    }
    old.hide();
    const next = documentFixture(storage, "reload");
    browserLaunchLocation(() => false, next.page);
    expect(old.reload).toHaveBeenCalledOnce();
    expect(takeBackReloadTail(next.history, next.page)).toBeUndefined();
  });

  it.each(["different reload source", "changed neighbor", "changed length"] as const)(
    "rejects a carried witness with a %s",
    (scenario) => {
      const storage = new Map<string, string>();
      record(storage);
      const next = documentFixture(storage, "reload");
      if (scenario === "different reload source") {
        next.navigation.activation.from = home;
      } else if (scenario === "changed neighbor") {
        next.navigation.entries.mockReturnValue([{ ...home, key: "different" }, play]);
      }
      browserLaunchLocation(() => false, next.page);
      if (scenario === "changed length") {
        next.history.length += 1;
      }
      expect(storage.size).toBe(0);
      expect(takeBackReloadTail(next.history, next.page)).toBeUndefined();
    },
  );
});
