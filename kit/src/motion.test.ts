import { describe, expect, it } from "vitest";

import { easeProgress, progressAt, type Segment, segmentAt } from "./motion";

describe("progressAt", () => {
  it.each([-Infinity, 1, 4, 6, 8, 20, Infinity])("clamps position %s", (position) => {
    expect(progressAt(4, 4, position)).toBe(Math.min(1, Math.max(0, (position - 4) / 4)));
  });

  it("changes instantly at a zero-duration segment's start", () => {
    expect([-Infinity, 3, 4, 5, Infinity].map((position) => progressAt(4, 0, position))).toEqual([
      0, 0, 1, 1, 1,
    ]);
  });

  it("preserves fractions when the progress unit is scaled or its origin shifted", () => {
    for (const position of [-2, 4, 5, 7, 8, 10]) {
      expect(progressAt(4, 4, position)).toBe(progressAt(24, 8, 16 + 2 * position));
    }
  });

  it("does not turn an invalid position into a valid endpoint", () => {
    expect(progressAt(4, 4, NaN)).toBeNaN();
    expect(progressAt(4, 0, NaN)).toBeNaN();
  });
});

describe("easeProgress", () => {
  it("has fixed endpoints and symmetric sine easing", () => {
    for (const easing of ["linear", "sineInOut"] as const) {
      expect(easeProgress(easing, -Infinity)).toBe(0);
      expect(easeProgress(easing, Infinity)).toBe(1);
      for (const progress of [0, 0.1, 0.25, 0.5, 0.9, 1]) {
        expect(easeProgress(easing, progress) + easeProgress(easing, 1 - progress)).toBeCloseTo(1);
      }
    }
    expect(easeProgress("sineInOut", 0.25)).toBeLessThan(0.25);
    expect(easeProgress("sineInOut", 0.75)).toBeGreaterThan(0.75);
  });
});

describe("segmentAt", () => {
  const segment: Segment = Object.freeze({
    duration: 4,
    easing: "linear",
    from: Object.freeze({ x: -2, y: 9 }),
    start: 3,
    to: Object.freeze({ x: 6, y: 1 }),
  });

  it("evaluates in any query order without mutating its geometry", () => {
    expect(
      [7, 3, 5, -Infinity, Infinity, 5].map((position) => segmentAt(segment, position)),
    ).toEqual([
      { x: 6, y: 1 },
      { x: -2, y: 9 },
      { x: 2, y: 5 },
      { x: -2, y: 9 },
      { x: 6, y: 1 },
      { x: 2, y: 5 },
    ]);
  });

  it("holds a constant segment and handles instant moves", () => {
    expect(segmentAt({ ...segment, to: segment.from }, 5)).toEqual(segment.from);
    expect(segmentAt({ ...segment, duration: 0 }, 3)).toEqual(segment.to);
  });

  it("reverses a curved segment without changing its geometric path", () => {
    const curved: Segment = { ...segment, easing: "sineInOut" };
    const reversed = { ...curved, from: curved.to, to: curved.from };
    for (const position of [3, 3.5, 4, 5, 6.5, 7]) {
      const forward = segmentAt(curved, position);
      const backward = segmentAt(reversed, 10 - position);
      expect(forward.x).toBeCloseTo(backward.x);
      expect(forward.y).toBeCloseTo(backward.y);
    }
  });
});
