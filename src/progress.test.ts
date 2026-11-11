import { describe, expect, it } from "vitest";

import {
  indeterminateSegment,
  progressBarLayout,
  type ProgressBarStyle,
  progressDisplayLayout,
} from "./progress.ts";

const style: ProgressBarStyle = {
  border: 1,
  fills: [0xffff00, 0xffaa00],
  frame: 0,
  track: 0x333333,
};
const frame = { height: 4, width: 102, x: 10, y: 20 };
const motion = { cycleMs: 1000, segment: 0.25 };

describe("progressBarLayout", () => {
  it.each([
    [-1, 0],
    [0.339, 33],
    [2, 100],
    [NaN, 0],
  ])("clamps measured %s and covers only complete pixels", (value, width) => {
    const layout = progressBarLayout(style, frame, value);
    expect(layout.track).toEqual({ height: 2, width: 100, x: 11, y: 21 });
    expect(layout.fills).toEqual([
      { height: 1, width, x: 11, y: 21 },
      { height: 1, width, x: 11, y: 22 },
    ]);
  });

  it("keeps a narrow bar's track within its frame", () => {
    const layout = progressBarLayout(style, { height: 1, width: 1, x: 0, y: 0 }, 1);
    expect(layout.track).toEqual({ height: 0, width: 0, x: 0.5, y: 0.5 });
    expect(layout.fills.every(({ height, width }) => width === 0 && height === 0)).toBe(true);
  });
});

describe("indeterminateSegment", () => {
  it.each([
    [0, { width: 0, x: 0 }],
    [100, { width: 12, x: 0 }],
    [400, { width: 25, x: 25 }],
    [900, { width: 13, x: 87 }],
    [990, { width: 2, x: 98 }],
    [1400, { width: 25, x: 25 }],
    [-600, { width: 25, x: 25 }],
  ])("travels left to right, entering and leaving clipped, at %s ms", (elapsedMs, span) => {
    expect(indeterminateSegment(motion, 100, elapsedMs)).toEqual(span);
  });

  it("keeps at least one pixel and at most the track", () => {
    expect(indeterminateSegment({ cycleMs: 10, segment: 0.001 }, 100, 5).width).toBe(1);
    expect(indeterminateSegment({ cycleMs: 10, segment: 1 }, 100, 5)).toEqual({ width: 100, x: 0 });
    expect(indeterminateSegment(motion, 0, 5)).toEqual({ width: 0, x: 0 });
  });

  it.each([
    { cycleMs: 0, segment: 0.25 },
    { cycleMs: Infinity, segment: 0.25 },
    { cycleMs: 1000, segment: 0 },
    { cycleMs: 1000, segment: 1.5 },
  ])("rejects motion %o", (bad) => {
    expect(() => indeterminateSegment(bad, 100, 0)).toThrow(RangeError);
  });
});

describe("progressDisplayLayout", () => {
  it("draws nothing while hidden", () => {
    expect(progressDisplayLayout(style, motion, frame, { kind: "hidden" })).toBeUndefined();
  });

  it("draws a measured share as progressBarLayout does", () => {
    expect(progressDisplayLayout(style, motion, frame, { kind: "measured", value: 0.5 })).toEqual(
      progressBarLayout(style, frame, 0.5),
    );
  });

  it("places every fill band on the travelling segment without a percentage", () => {
    const layout = progressDisplayLayout(style, motion, frame, {
      elapsedMs: 400,
      kind: "indeterminate",
    });
    expect(layout?.value).toBeUndefined();
    expect(layout?.fills).toEqual([
      { height: 1, width: 25, x: 36, y: 21 },
      { height: 1, width: 25, x: 36, y: 22 },
    ]);
  });
});
