// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import { prepareBrowserLaunch } from "./launch.ts";

const POLICY = { cacheNamePrefix: "game-", hashedAssetPrefix: "/assets/" };

type UnavailableApi = "caches" | "DecompressionStream" | "serviceWorker";
type CapabilityFailure = "absent" | "undefined" | "inaccessible";

function browserFixture(api?: UnavailableApi, failure?: CapabilityFailure) {
  const register = vi.fn();
  const container = { register };
  const cacheOpen = vi.fn();
  const fetch = vi.fn();
  const writeStorage = vi.spyOn(Storage.prototype, "setItem");
  const removeStorage = vi.spyOn(Storage.prototype, "removeItem");
  const browser = { onLine: true, serviceWorker: container };
  vi.stubGlobal("navigator", browser);
  vi.stubGlobal("caches", { open: cacheOpen });
  vi.stubGlobal("DecompressionStream", class {});
  vi.stubGlobal("fetch", fetch);
  if (api !== undefined) {
    const host = api === "serviceWorker" ? browser : globalThis;
    if (failure === "absent") {
      Reflect.deleteProperty(host, api);
    } else if (failure === "undefined") {
      Reflect.set(host, api, undefined);
    } else {
      Object.defineProperty(host, api, {
        configurable: true,
        get() {
          throw new DOMException("Storage access denied", "SecurityError");
        },
      });
    }
  }

  return {
    container,
    expectNoWork() {
      expect(register).not.toHaveBeenCalled();
      expect(cacheOpen).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      expect(writeStorage).not.toHaveBeenCalled();
      expect(removeStorage).not.toHaveBeenCalled();
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("prepareBrowserLaunch", () => {
  it("returns the browser launch context without mounting a notice or stopping the bar", () => {
    const { container, expectNoWork } = browserFixture();
    const parent = document.createElement("div");
    const bar = document.createElement("progress");
    parent.append(bar);
    const onUnsupported = vi.fn();

    const result = prepareBrowserLaunch({ onUnsupported, parent }, POLICY);

    if (result.kind !== "supported") {
      result.failure.dispose();
      throw new Error("Expected supported browser capabilities");
    }
    expect(result.context.page.container).toBe(container);
    expect(result.context.policy).toBe(POLICY);
    expect(result.context.groupStore).toBeDefined();
    expect(onUnsupported).not.toHaveBeenCalled();
    expect([...parent.children]).toEqual([bar]);
    expectNoWork();
  });

  it.each([
    ["serviceWorker", "absent"],
    ["serviceWorker", "undefined"],
    ["serviceWorker", "inaccessible"],
    ["caches", "absent"],
    ["caches", "undefined"],
    ["caches", "inaccessible"],
    ["DecompressionStream", "absent"],
    ["DecompressionStream", "undefined"],
    ["DecompressionStream", "inaccessible"],
  ] as const)("stops the bar and mounts a disposable notice when %s is %s", (api, mode) => {
    const { expectNoWork } = browserFixture(api, mode);
    const parent = document.createElement("div");
    const bar = document.createElement("progress");
    parent.append(bar);
    const onUnsupported = vi.fn(() => {
      expect([...parent.children]).toEqual([bar]);
      bar.remove();
    });
    const layout = {
      actionAlign: "center",
      gapPx: 10,
      minActionSizePx: 30,
      paddingPx: 19,
    } as const;
    const result = prepareBrowserLaunch(
      { ...(mode === "inaccessible" ? { failure: { layout } } : {}), onUnsupported, parent },
      POLICY,
    );

    if (result.kind !== "unsupported") {
      throw new Error("Expected a browser capability notice");
    }
    try {
      const { element } = result.failure;
      expect(onUnsupported).toHaveBeenCalledOnce();
      expect([...parent.children]).toEqual([element]);
      expect(element.getAttribute("role")).toBe("alert");
      expect(element.hidden).toBe(false);
      expect(element.textContent).toContain(
        "This browser does not support the features needed to load the game.",
      );
      expect(element.querySelector("button:not([hidden]), [role=button]:not([hidden])")).toBeNull();
      expect(element.textContent).not.toContain("Retry");
      if (mode === "inaccessible") {
        expect(element.style.padding).toBe("19px");
      }
      expectNoWork();
    } finally {
      result.failure.dispose();
    }
    expect(parent.children).toHaveLength(0);
    expectNoWork();
  });
});
