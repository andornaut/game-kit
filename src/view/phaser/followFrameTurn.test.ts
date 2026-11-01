import { EventEmitter } from "node:events";

import type { Game } from "phaser";
import { afterEach, expect, it, vi } from "vitest";

import { FIT_CHECK_MS, followFrameTurn } from "./followFrameTurn";

function setup() {
  vi.useFakeTimers();
  const frames: (() => void)[] = [];
  const viewport = Object.assign(new EventTarget(), {
    height: 100,
    offsetLeft: 0,
    offsetTop: 0,
    width: 100,
  });
  const page = Object.assign(new EventTarget(), {
    innerHeight: 100,
    innerWidth: 100,
    scrollX: 0,
    scrollY: 0,
    visualViewport: viewport,
  });
  const document = Object.assign(new EventTarget(), {
    documentElement: {
      style: { getPropertyValue: () => "", setProperty: vi.fn() },
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
  const game = {
    canvas: {
      getBoundingClientRect: () => ({ height: 100, width: 100, x: 0, y: 0 }),
      style: {},
    },
    events,
    input: { transformPointer: original.transform },
    scale: {
      getParentBounds: original.bounds,
      parentSize: { height: 100, setSize: vi.fn(), width: 100 },
      refresh,
      updateCenter: original.centre,
    },
  } as unknown as Game;
  const listeners = new Set<(turn: -90 | 0 | 90) => void>();
  const recheck = vi.fn();
  const watch = {
    onChange: (listener: (turn: -90 | 0 | 90) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    recheck,
    turn: () => 0 as const,
  };
  const dispose = followFrameTurn(
    game,
    { offsetHeight: 100, offsetWidth: 100 } as HTMLElement,
    watch,
    { height: 100, width: 100 },
  );
  return {
    disconnected,
    dispose,
    document,
    events,
    frames,
    game,
    listeners,
    original,
    page,
    recheck,
    refresh,
    resize: () => resized(),
    viewport,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
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
  state.resize();
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
