import { EventEmitter } from "node:events";

import { type Game, type Input, Scale } from "phaser";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FrameTurn } from "../../../view/pagePoint.ts";
import { FIT_CHECK_MS, followFrameTurn, PAGE_HEIGHT_PROPERTY } from "./followFrameTurn.ts";

vi.mock("phaser", async () => {
  const nodeModule = await import("node:module");
  const path = await import("node:path");
  const load = nodeModule.createRequire(import.meta.url);
  const root = path.dirname(load.resolve("phaser/package.json"));
  // The real constants, so tests compare against Phaser's values rather than copies.
  return { Scale: { ScaleModes: load(path.join(root, "src/scale/const/SCALE_MODE_CONST.js")) } };
});

function setup(
  initialTurn: FrameTurn = 0,
  options?: Parameters<typeof followFrameTurn>[4],
  devicePixelRatio = 1,
) {
  vi.useFakeTimers();
  const frames: (() => void)[] = [];
  const viewport = Object.assign(new EventTarget(), {
    height: 100,
    offsetLeft: 0,
    offsetTop: 0,
    width: 100,
  });
  // One media query list per matchMedia call, with its change listeners.
  const media: { change(): void; listeners: Set<() => void>; media: string }[] = [];
  const page = Object.assign(new EventTarget(), {
    devicePixelRatio,
    innerHeight: 100,
    innerWidth: 100,
    matchMedia: (query: string) => {
      const listeners = new Set<() => void>();
      media.push({
        change: () => listeners.forEach((listener) => listener()),
        listeners,
        media: query,
      });
      return {
        addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
        removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
      };
    },
    scrollX: 0,
    scrollY: 0,
    visualViewport: viewport,
  });
  const properties = new Map<string, string>();
  const document = Object.assign(new EventTarget(), {
    documentElement: {
      style: {
        getPropertyValue: (name: string) => properties.get(name) ?? "",
        setProperty: (name: string, value: string) => properties.set(name, value),
      },
    },
    visibilityState: "visible",
  });
  const disconnected = vi.fn();
  let resized: () => void = () => undefined;
  vi.stubGlobal("window", page);
  vi.stubGlobal("document", document);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(() => callback(0));
    return frames.length;
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resized = callback;
      }
      disconnect = disconnected;
      observe = vi.fn();
    },
  );
  const events = new EventEmitter();
  const original = { bounds: vi.fn(() => false), centre: vi.fn(), transform: vi.fn() };
  const refresh = vi.fn();
  const resize = vi.fn();
  const setZoom = vi.fn();
  const position = { x: 0, y: 0 };
  const pointer = {
    position: {
      set: (x: number, y: number) => Object.assign(position, { x, y }),
    },
    prevPosition: { copy: vi.fn() },
  } as unknown as Input.Pointer;
  const game = {
    canvas: {
      getBoundingClientRect: () => ({ height: 100, width: 200, x: 0, y: 0 }),
      style: {} as Record<string, string>,
    },
    events,
    input: { transformPointer: original.transform },
    scale: {
      getParentBounds: original.bounds,
      parentSize: { height: 100.4, setSize: vi.fn(), width: 150.2 },
      refresh,
      resize,
      scaleMode: Scale.ScaleModes.EXPAND,
      setZoom,
      updateCenter: original.centre,
    },
  } as unknown as Game;
  const listeners = new Set<(turn: FrameTurn) => void>();
  const recheck = vi.fn();
  const watch = {
    onChange: (listener: (turn: FrameTurn) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    recheck,
    turn: () => initialTurn,
  };
  const dispose = followFrameTurn(
    watch,
    { height: 50, width: 100 },
    { offsetHeight: 100, offsetWidth: 100 } as HTMLElement,
    game,
    options,
  );
  return {
    disconnected,
    dispose,
    document,
    events,
    frames,
    game,
    listeners,
    media,
    original,
    page,
    pointer,
    position,
    properties,
    recheck,
    refresh,
    resize,
    resizeObserved: () => resized(),
    setZoom,
    viewport,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("followFrameTurn", () => {
  it("publishes the visible area's height for the stylesheets", () => {
    const state = setup();
    expect(state.properties.get(PAGE_HEIGHT_PROPERTY)).toBe("100px");
  });

  it.each<["page" | "document" | "viewport", string]>([
    ["page", "resize"],
    ["page", "orientationchange"],
    ["page", "pageshow"],
    ["page", "focus"],
    ["document", "fullscreenchange"],
    ["document", "visibilitychange"],
    ["viewport", "resize"],
    ["viewport", "scroll"],
  ])("rechecks the turn and refits on the %s's %s", (target, type) => {
    const state = setup();
    state[target].dispatchEvent(new Event(type));
    expect([state.recheck.mock.calls.length, state.refresh.mock.calls.length]).toEqual([1, 1]);
  });

  it("rechecks the turn every FIT_CHECK_MS while visible", () => {
    const state = setup();
    vi.advanceTimersByTime(FIT_CHECK_MS * 3);
    expect(state.recheck).toHaveBeenCalledTimes(3);
  });

  // The canvas is 200 by 100 on the page and the game 100 by 50: turned, the game's width runs
  // along the canvas's 100-pixel height and its height along the 200-pixel width.
  it.each<[FrameTurn, { x: number; y: number }]>([
    [90, { x: 50, y: 40 }],
    [-90, { x: 50, y: 10 }],
  ])("maps pointers through a %i turn", (turn, point) => {
    const state = setup(turn);
    state.game.input.transformPointer(state.pointer, 40, 50, false);
    expect([{ ...state.position }, state.original.transform.mock.calls.length]).toEqual([point, 0]);
  });

  it("leaves unturned pointers to Phaser", () => {
    const state = setup(0);
    state.game.input.transformPointer(state.pointer, 40, 50, false);
    expect(state.original.transform).toHaveBeenCalledWith(state.pointer, 40, 50, false);
  });

  it("releases frame fitting on game destruction and ignores queued callbacks", () => {
    const state = setup();
    state.page.dispatchEvent(new Event("resize"));
    vi.advanceTimersByTime(FIT_CHECK_MS);
    expect(state.refresh).toHaveBeenCalled();
    state.events.emit("destroy");
    const calls = [state.refresh.mock.calls.length, state.recheck.mock.calls.length];
    state.page.dispatchEvent(new Event("resize"));
    state.viewport.dispatchEvent(new Event("scroll"));
    state.document.dispatchEvent(new Event("visibilitychange"));
    state.document.dispatchEvent(new Event("fullscreenchange"));
    state.resizeObserved();
    state.frames.forEach((frame) => frame());
    state.listeners.forEach((listener) => listener(0));
    vi.advanceTimersByTime(FIT_CHECK_MS * 3);
    expect([state.refresh.mock.calls.length, state.recheck.mock.calls.length]).toEqual(calls);
    expect(state.listeners.size).toBe(0);
    expect(state.disconnected).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(state.game.scale.getParentBounds).toBe(state.original.bounds);
    expect(state.game.scale.updateCenter).toBe(state.original.centre);
    expect(state.game.input.transformPointer).toBe(state.original.transform);
    state.dispose();
    expect(state.disconnected).toHaveBeenCalledOnce();
  });

  it("permits explicit idempotent disposal without replacing a later owner's method", () => {
    const state = setup();
    const replacement = vi.fn();
    state.game.scale.updateCenter = replacement;
    state.dispose();
    state.dispose();
    expect(state.events.listenerCount("destroy")).toBe(0);
    expect(state.game.scale.updateCenter).toBe(replacement);
    expect(state.disconnected).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves the scale mode, size and zoom to Phaser without deviceResolution", () => {
    const state = setup();
    state.page.dispatchEvent(new Event("resize"));
    expect([
      state.game.scale.scaleMode,
      state.resize.mock.calls.length,
      state.setZoom.mock.calls.length,
      state.media.length,
      state.game.canvas.style.imageRendering,
    ]).toEqual([Scale.ScaleModes.EXPAND, 0, 0, 0, undefined]);
  });

  // The parent measures 150.2 by 100.4 CSS pixels; at DPR 3 the backing caps at r 2.
  it.each([
    [1, 1, { height: 100, width: 150 }],
    [1.5, 1.5, { height: 151, width: 225 }],
    [3, 2, { height: 201, width: 300 }],
  ])(
    "at DPR %d sizes the backing at r %d in device pixels and zooms it to the CSS size",
    (devicePixelRatio, r, backing) => {
      const state = setup(0, { deviceResolution: { max: 2 } }, devicePixelRatio);
      state.page.dispatchEvent(new Event("resize"));
      expect(state.refresh).not.toHaveBeenCalled();
      expect(state.resize.mock.calls).toEqual([
        [backing.width, backing.height],
        [backing.width, backing.height],
      ]);
      expect(state.setZoom.mock.calls).toEqual([[1 / r], [1 / r]]);
      expect(state.resize.mock.invocationCallOrder[1]).toBeLessThan(
        state.setZoom.mock.invocationCallOrder[1]!,
      );
      expect(state.game.scale.scaleMode).toBe(Scale.ScaleModes.NONE);
      expect(state.game.canvas.style.imageRendering).toBe("pixelated");
    },
  );

  it("refits on a DPR change and re-arms its resolution query at the new DPR", () => {
    const state = setup(0, { deviceResolution: { max: 2 } }, 1);
    expect(state.media.map(({ media }) => media)).toEqual(["(resolution: 1dppx)"]);
    state.page.devicePixelRatio = 2;
    state.media[0]!.change();
    expect(state.media.map(({ listeners, media }) => [media, listeners.size])).toEqual([
      ["(resolution: 1dppx)", 0],
      ["(resolution: 2dppx)", 1],
    ]);
    expect(state.resize.mock.calls.at(-1)).toEqual([300, 201]);
    expect(state.setZoom.mock.calls.at(-1)).toEqual([0.5]);
  });

  it("removes its resolution listener on disposal", () => {
    const state = setup(0, { deviceResolution: { max: 2 } }, 1);
    expect(state.media[0]!.listeners.size).toBe(1);
    state.dispose();
    expect(state.media[0]!.listeners.size).toBe(0);
  });
});
