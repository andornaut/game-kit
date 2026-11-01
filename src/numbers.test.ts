import { describe, expect, it } from "vitest";

import { clamp, clamp01, lerp } from "./numbers.ts";

describe("clamp01", () => {
  it.each([
    { held: 0, value: -0.5 },
    { held: 0.25, value: 0.25 },
    { held: 1, value: 3 },
  ])("holds $value at $held", ({ held, value }) => {
    expect(clamp01(value)).toBe(held);
  });
});

describe("clamp", () => {
  it.each([
    [-2, 4, -3, -2],
    [-2, 4, 1, 1],
    [-2, 4, 5, 4],
    [-2, 4, -Infinity, -2],
    [-2, 4, Infinity, 4],
    [-Infinity, Infinity, 3, 3],
    [4, -2, 1, -2],
  ])("uses the literal min/max order for %j,%j,%j", (minimum, maximum, value, expected) => {
    expect(clamp(minimum, maximum, value)).toBe(expected);
  });

  it("propagates NaN in any argument and preserves min/max signed-zero behaviour", () => {
    expect(clamp(NaN, 4, 1)).toBeNaN();
    expect(clamp(-2, NaN, 1)).toBeNaN();
    expect(clamp(-2, 4, NaN)).toBeNaN();
    expect(Object.is(clamp(0, 1, -0), 0)).toBe(true);
    expect(Object.is(clamp(-1, -0, 0), -0)).toBe(true);
  });
});

describe("lerp", () => {
  it.each([
    [2, 6, 0, 2],
    [2, 6, 0.5, 4],
    [2, 6, 1, 6],
    [2, 6, 2, 10],
    [2, 6, -1, -2],
  ])("interpolates without clamping %j,%j,%j", (from, to, fraction, expected) => {
    expect(lerp(from, to, fraction)).toBe(expected);
  });

  it("keeps IEEE non-finite arithmetic without endpoint shortcuts", () => {
    expect(lerp(2, 6, NaN)).toBeNaN();
    expect(lerp(Infinity, Infinity, 0)).toBeNaN();
    expect(lerp(2, Infinity, 0)).toBeNaN();
    expect(lerp(2, 6, Infinity)).toBe(Infinity);
  });
});
