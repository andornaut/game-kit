import { describe, expect, it } from "vitest";

import type { Timer } from "./clock/timer.ts";
import {
  createLayeredProgress,
  createProgressDisplay,
  createProgressState,
  type ProgressSnapshot,
} from "./progressState.ts";

describe("createProgressState", () => {
  it("ignores stale progress and completion after another operation starts", () => {
    const state = createProgressState();
    const seen: ProgressSnapshot[] = [];
    state.subscribe((snapshot) => seen.push(snapshot));
    const first = state.begin();
    first.progress(0.5);
    const next = state.begin();
    first.progress(1);
    first.finish();
    expect(seen.at(-1)).toEqual({ active: true, value: undefined });
    next.progress(2);
    expect(seen.at(-1)).toEqual({ active: true, value: 1 });
    next.finish();
    next.progress(0.5);
    expect(seen.at(-1)).toEqual({ active: false, value: undefined });
  });

  it("immediately subscribes to current work and stops reports after unsubscribe", () => {
    const state = createProgressState();
    const handle = state.begin();
    handle.progress(0.5);
    const seen: ProgressSnapshot[] = [];
    const unsubscribe = state.subscribe((snapshot) => seen.push(snapshot));
    expect(seen).toEqual([{ active: true, value: 0.5 }]);
    unsubscribe();
    handle.finish();
    expect(seen).toHaveLength(1);
  });
});

describe("createProgressDisplay", () => {
  it("shows nothing while idle and a measured share while it is reported", () => {
    const display = createProgressDisplay(100);
    expect(display.at(0)).toEqual({ kind: "hidden" });
    display.report({ active: true, value: 2 });
    expect(display.at(10)).toEqual({ kind: "measured", value: 1 });
    display.report({ active: true, value: 0.25 });
    expect(display.at(20)).toEqual({ kind: "measured", value: 0.25 });
  });

  it("holds a finished measured bar full from its first drawn frame, then hides it", () => {
    const display = createProgressDisplay(100);
    display.report({ active: true, value: 0.4 });
    display.report({ active: false, value: undefined });
    expect(display.at(500)).toEqual({ kind: "measured", value: 1 });
    expect(display.at(599)).toEqual({ kind: "measured", value: 1 });
    expect(display.at(600)).toEqual({ kind: "hidden" });
    expect(display.at(700)).toEqual({ kind: "hidden" });
  });

  it("shows full on one frame even with no hold", () => {
    const display = createProgressDisplay(0);
    display.report({ active: true, value: 0.9 });
    display.report({ active: false, value: undefined });
    expect(display.at(5)).toEqual({ kind: "measured", value: 1 });
    expect(display.at(5)).toEqual({ kind: "hidden" });
  });

  it("times unknown work from its first drawn frame and hides it at once on finish", () => {
    const display = createProgressDisplay(100);
    display.report({ active: true, value: undefined });
    expect(display.at(1000)).toEqual({ elapsedMs: 0, kind: "indeterminate" });
    display.report({ active: true, value: NaN });
    expect(display.at(1250)).toEqual({ elapsedMs: 250, kind: "indeterminate" });
    display.report({ active: false, value: undefined });
    expect(display.at(1260)).toEqual({ kind: "hidden" });
  });

  it("restarts the segment when measured work becomes unknown, and new work ends a hold", () => {
    const display = createProgressDisplay(100);
    display.report({ active: true, value: 1 });
    display.report({ active: true, value: undefined });
    expect(display.at(40)).toEqual({ elapsedMs: 0, kind: "indeterminate" });
    display.report({ active: true, value: 0.5 });
    display.report({ active: false, value: undefined });
    expect(display.at(50)).toEqual({ kind: "measured", value: 1 });
    display.report({ active: true, value: undefined });
    expect(display.at(60)).toEqual({ elapsedMs: 0, kind: "indeterminate" });
  });

  it("follows a progress state through subscribe", () => {
    const state = createProgressState();
    const display = createProgressDisplay(0);
    state.subscribe(display.report);
    const handle = state.begin();
    expect(display.at(0).kind).toBe("indeterminate");
    handle.finish();
    expect(display.at(1)).toEqual({ kind: "hidden" });
  });

  it.each([-1, NaN, Infinity])("rejects a full hold of %s", (fullMs) => {
    expect(() => createProgressDisplay(fullMs)).toThrow(RangeError);
  });

  it("fades a finished measured bar linearly after its full hold, then hides it", () => {
    const display = createProgressDisplay(250, 150);
    display.report({ active: true, value: 0.6 });
    display.report({ active: false, value: undefined });
    expect(display.at(1000)).toEqual({ kind: "measured", value: 1 });
    expect(display.at(1249)).toEqual({ kind: "measured", value: 1 });
    expect(display.at(1250)).toEqual({ kind: "measured", opacity: 1, value: 1 });
    expect(display.at(1325)).toEqual({ kind: "measured", opacity: 0.5, value: 1 });
    const last = display.at(1399);
    expect(last.kind === "measured" && last.opacity).toBeCloseTo(1 / 150);
    expect(display.at(1400)).toEqual({ kind: "hidden" });
    expect(display.at(1500)).toEqual({ kind: "hidden" });
  });

  it("starts the fade at once with no hold, after one full frame", () => {
    const display = createProgressDisplay(0, 100);
    display.report({ active: true, value: 0.9 });
    display.report({ active: false, value: undefined });
    expect(display.at(5)).toEqual({ kind: "measured", value: 1 });
    expect(display.at(55)).toEqual({ kind: "measured", opacity: 0.5, value: 1 });
    expect(display.at(105)).toEqual({ kind: "hidden" });
  });

  it("ends a fade when new work is reported", () => {
    const display = createProgressDisplay(100, 100);
    display.report({ active: true, value: 0.5 });
    display.report({ active: false, value: undefined });
    display.at(0);
    expect(display.at(150)).toEqual({ kind: "measured", opacity: 0.5, value: 1 });
    display.report({ active: true, value: 0.2 });
    expect(display.at(160)).toEqual({ kind: "measured", value: 0.2 });
  });

  it("hides unknown work at once on finish, with no fade", () => {
    const display = createProgressDisplay(100, 100);
    display.report({ active: true, value: undefined });
    display.at(0);
    display.report({ active: false, value: undefined });
    expect(display.at(10)).toEqual({ kind: "hidden" });
  });

  it.each([-1, NaN, Infinity])("rejects a fade of %s", (fadeMs) => {
    expect(() => createProgressDisplay(100, fadeMs)).toThrow(RangeError);
  });
});

// A timer whose pending handlers run only when the test fires them.
function fakeTimer() {
  const pending = new Map<number, { handler: () => void; ms: number }>();
  let next = 0;
  const timer: Timer = {
    clearTimeout: (handle) => pending.delete(handle as number),
    setTimeout: (handler, ms) => {
      next += 1;
      pending.set(next, { handler, ms });
      return next;
    },
  };
  return {
    fire() {
      const entries = [...pending.entries()];
      pending.clear();
      for (const [, { handler }] of entries) {
        handler();
      }
    },
    pending: () => [...pending.values()].map(({ ms }) => ms),
    timer,
  };
}

describe("createLayeredProgress", () => {
  const HOLD = { fadeMs: 400, fullMs: 600 };
  const IDLE = { active: false, value: undefined };

  function layered() {
    const clock = fakeTimer();
    const foreground = createProgressState();
    const background = createProgressState();
    const bar = createLayeredProgress(clock.timer, HOLD, { background, foreground });
    const seen: ProgressSnapshot[] = [];
    bar.subscribe((snapshot) => seen.push(snapshot));
    return { background, bar, clock, foreground, seen };
  }

  it("shows nothing while both layers are idle", () => {
    const { clock, seen } = layered();
    expect(seen).toEqual([IDLE]);
    expect(clock.pending()).toEqual([]);
  });

  it("fills a measured foreground load, then holds it full and fades before going idle", () => {
    const { clock, foreground, seen } = layered();
    const load = foreground.begin();
    load.progress(0.5);
    load.progress(1);
    load.finish();
    expect(seen).toEqual([
      IDLE,
      { active: true, value: undefined },
      { active: true, value: 0.5 },
      { active: true, value: 1 },
      IDLE,
    ]);
    expect(clock.pending()).toEqual([1000]);
    clock.fire();
    expect(seen.at(-1)).toEqual(IDLE);
  });

  it("shows work of unknown total while it runs and hands over at once when it ends", () => {
    const { background, clock, foreground, seen } = layered();
    const precache = background.begin();
    const load = foreground.begin();
    load.finish();
    expect(seen.slice(1)).toEqual([{ active: true, value: undefined }]);
    expect(clock.pending()).toEqual([]);
    precache.finish();
    expect(seen.at(-1)).toEqual(IDLE);
    expect(clock.pending()).toEqual([]);
  });

  it("shows the foreground over the background whenever the foreground is active", () => {
    const { background, foreground, seen } = layered();
    background.begin().progress(0.8);
    expect(seen.at(-1)).toEqual({ active: true, value: 0.8 });
    foreground.begin().progress(0.1);
    expect(seen.at(-1)).toEqual({ active: true, value: 0.1 });
  });

  it("plays out a finished foreground's hold and fade before the background shows again", () => {
    const { background, clock, foreground, seen } = layered();
    background.begin();
    const load = foreground.begin();
    load.progress(0.5);
    load.finish();
    expect(seen.at(-1)).toEqual(IDLE);
    expect(clock.pending()).toEqual([1000]);
    clock.fire();
    expect(seen.at(-1)).toEqual({ active: true, value: undefined });
  });

  it("holds while the background changes, and shows it once the hold ends", () => {
    const { background, clock, foreground, seen } = layered();
    const load = foreground.begin();
    load.progress(1);
    load.finish();
    const update = background.begin();
    update.progress(0.3);
    expect(seen.at(-1)).toEqual(IDLE);
    clock.fire();
    expect(seen.at(-1)).toEqual({ active: true, value: 0.3 });
  });

  it("holds a finished measured background too", () => {
    const { background, clock, seen } = layered();
    const update = background.begin();
    update.progress(0.9);
    update.finish();
    expect(seen.at(-1)).toEqual(IDLE);
    expect(clock.pending()).toEqual([1000]);
  });

  it("cuts a hold short for a new foreground load, on the same bar", () => {
    const { background, clock, foreground, seen } = layered();
    background.begin();
    const first = foreground.begin();
    first.progress(1);
    first.finish();
    const second = foreground.begin();
    expect(clock.pending()).toEqual([]);
    second.progress(0.2);
    expect(seen.slice(-3)).toEqual([
      IDLE,
      { active: true, value: undefined },
      { active: true, value: 0.2 },
    ]);
  });

  it("stops following the layers and cancels its hold on dispose", () => {
    const { bar, clock, foreground, seen } = layered();
    const load = foreground.begin();
    load.progress(1);
    load.finish();
    bar.dispose();
    expect(clock.pending()).toEqual([]);
    foreground.begin();
    expect(seen.at(-1)).toEqual(IDLE);
  });

  it("reports its current snapshot to a new subscriber", () => {
    const { bar, foreground } = layered();
    foreground.begin().progress(0.4);
    const seen: ProgressSnapshot[] = [];
    bar.subscribe((snapshot) => seen.push(snapshot));
    expect(seen).toEqual([{ active: true, value: 0.4 }]);
  });

  it("rejects a negative or nonfinite hold or fade", () => {
    const sources = { background: createProgressState(), foreground: createProgressState() };
    const { timer } = fakeTimer();
    expect(() => createLayeredProgress(timer, { fullMs: -1 }, sources)).toThrow(RangeError);
    expect(() => createLayeredProgress(timer, { fadeMs: Number.NaN, fullMs: 0 }, sources)).toThrow(
      RangeError,
    );
  });
});
