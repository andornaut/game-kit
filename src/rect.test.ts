import { describe, expect, it } from "vitest";

import { containsPoint, insetRect, rectAboveIn, rectsOverlap } from "./rect";

describe("containsPoint", () => {
  const rect = { height: 20, width: 10, x: 5, y: 40 };

  it("holds a point inside, on the edge or outside", () => {
    for (const [, x, y, expected] of [
      ["the top-left corner", 5, 40, true],
      ["the last pixel inside", 14, 59, true],
      ["the right edge", 15, 50, false],
      ["the bottom edge", 10, 60, false],
      ["outside", 4, 50, false],
    ] as const) {
      expect(containsPoint(rect, x, y)).toBe(expected);
    }
  });
});

describe("rectsOverlap", () => {
  const rect = { height: 20, width: 10, x: 5, y: 40 };

  it("overlaps only rects that share area", () => {
    for (const [, other, expected] of [
      ["the same rect", rect, true],
      ["a rect sharing its last pixel", { height: 5, width: 5, x: 14, y: 59 }, true],
      ["a rect touching its right edge", { height: 20, width: 10, x: 15, y: 40 }, false],
      ["a rect touching its bottom edge", { height: 5, width: 10, x: 5, y: 60 }, false],
      ["a rect inside it", { height: 2, width: 2, x: 8, y: 50 }, true],
    ] as const) {
      expect(rectsOverlap(rect, other)).toBe(expected);
      expect(rectsOverlap(other, rect)).toBe(expected);
    }
  });
});

describe("insetRect", () => {
  it("shrinks the rect by the amount on every side", () => {
    expect(insetRect(1, { height: 192, width: 72, x: 4, y: 44 })).toEqual({
      height: 190,
      width: 70,
      x: 5,
      y: 45,
    });
  });
});

describe("rectAboveIn", () => {
  const bounds = { height: 100, width: 60, x: 10, y: 20 };
  const size = { height: 10, width: 20 };

  it.each([
    ["centred over the point", { bottom: 60, x: 40 }, { x: 30, y: 50 }],
    ["moved in from the left edge", { bottom: 60, x: 12 }, { x: 10, y: 50 }],
    ["moved in from the right edge", { bottom: 60, x: 68 }, { x: 50, y: 50 }],
    ["moved down from the top edge", { bottom: 25, x: 40 }, { x: 30, y: 20 }],
    ["moved up from the bottom edge", { bottom: 130, x: 40 }, { x: 30, y: 110 }],
  ])("lies %s", (_, at, place) => {
    expect(rectAboveIn(bounds, at, size)).toEqual({ ...size, ...place });
  });

  it("keeps its top-left inside bounds smaller than it", () => {
    expect(rectAboveIn(bounds, { bottom: 60, x: 40 }, { height: 200, width: 100 })).toEqual({
      height: 200,
      width: 100,
      x: 10,
      y: 20,
    });
  });
});
