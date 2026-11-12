import { describe, expect, it } from "vitest";

import {
  checkProgressBarStyle,
  indeterminateSegment,
  indeterminateTravel,
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

describe("checkProgressBarStyle", () => {
  it.each([{}, { frameAlpha: 0, trackAlpha: 1 }, { frameAlpha: 1, trackAlpha: 0.6 }])(
    "accepts alphas %o",
    (alphas) => {
      expect(() => checkProgressBarStyle({ ...style, ...alphas })).not.toThrow();
    },
  );

  it.each([
    { frameAlpha: -0.01 },
    { frameAlpha: 1.01 },
    { frameAlpha: NaN },
    { trackAlpha: -1 },
    { trackAlpha: 2 },
    { trackAlpha: Infinity },
  ])("rejects alphas %o", (alphas) => {
    expect(() => checkProgressBarStyle({ ...style, ...alphas })).toThrow(RangeError);
  });
});

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

describe("indeterminateTravel", () => {
  it.each([
    [100, 0.25, { length: 25, steps: 125 }],
    [358, 0.25, { length: 90, steps: 448 }],
    [100.9, 0.001, { length: 1, steps: 101 }],
    [100, 1, { length: 100, steps: 200 }],
    [0.5, 0.25, { length: 0, steps: 0 }],
    [NaN, 0.25, { length: 0, steps: 0 }],
  ])("rounds a %s px track's %s segment to whole pixels", (width, segment, travel) => {
    expect(indeterminateTravel({ cycleMs: 1000, segment }, width)).toEqual(travel);
  });

  it("gives indeterminateSegment one leading-edge pixel per step, each an equal share", () => {
    const { length, steps } = indeterminateTravel(motion, 100);
    const leads = Array.from({ length: steps }, (_, step) => {
      const { width, x } = indeterminateSegment(motion, 100, ((step + 0.5) * 1000) / steps);
      return { lead: x + width, start: x };
    });
    expect(leads.map(({ start }) => start)).toEqual(
      Array.from({ length: steps }, (_, step) => Math.max(0, step - length)),
    );
    expect(leads.map(({ lead }) => lead)).toEqual(
      Array.from({ length: steps }, (_, step) => Math.min(100, step)),
    );
  });

  it("rejects bad motion", () => {
    expect(() => indeterminateTravel({ cycleMs: 1000, segment: 0 }, 100)).toThrow(RangeError);
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

  it("carries a measured display's opacity on the measured layout", () => {
    expect(
      progressDisplayLayout(style, motion, frame, { kind: "measured", opacity: 0.4, value: 1 }),
    ).toEqual({ ...progressBarLayout(style, frame, 1), opacity: 0.4 });
  });

  it.each([
    [2, 1],
    [-1, 0],
    [NaN, 1],
  ])("clamps opacity %s to %s", (opacity, clamped) => {
    const layout = progressDisplayLayout(style, motion, frame, {
      kind: "measured",
      opacity,
      value: 1,
    });
    expect(layout?.opacity).toBe(clamped);
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
