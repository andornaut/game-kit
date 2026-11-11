import { describe, expect, it } from "vitest";

import {
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
});
