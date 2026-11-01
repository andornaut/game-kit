import { describe, expect, it } from "vitest";

import type { Point } from "../rect";
import {
  isOutside,
  type OutsideArea,
  outsidePressDown,
  outsidePressMove,
  outsideTapped,
} from "./outsideTap";

// A 100x100 screen with a panel in its middle and a top bar button in its top-right corner.
const AREA: OutsideArea = {
  bounds: { height: 100, width: 100, x: 0, y: 0 },
  covered: [
    { height: 40, width: 40, x: 30, y: 30 },
    { height: 20, width: 20, x: 80, y: 0 },
  ],
};
const TAP_MAX = 10;

describe("isOutside", () => {
  it.each<[string, Point, boolean]>([
    ["the screen beside the panel", { x: 5, y: 50 }, true],
    ["the screen just left of the panel", { x: 29, y: 50 }, true],
    ["the top bar beside its button", { x: 5, y: 5 }, true],
    ["the panel", { x: 50, y: 50 }, false],
    ["the panel's left edge", { x: 30, y: 50 }, false],
    ["the button", { x: 90, y: 10 }, false],
    ["past the bounds", { x: 50, y: 100 }, false],
  ])("%s", (_, point, outside) => {
    expect(isOutside(AREA, point)).toBe(outside);
  });
});

describe("outsideTapped", () => {
  // Where the press lands, where it travels on the way, where it is released, and whether the
  // browser cancelled it.
  it.each<[string, Point, Point[], Point, boolean, boolean]>([
    ["taps on a release where it landed", { x: 5, y: 50 }, [], { x: 5, y: 50 }, false, true],
    [
      "taps after travelling within the tap distance",
      { x: 5, y: 50 },
      [{ x: 11, y: 58 }],
      { x: 5, y: 50 },
      false,
      true,
    ],
    [
      "is a drag once it travels past the tap distance, even back again",
      { x: 5, y: 50 },
      [{ x: 5, y: 61 }],
      { x: 5, y: 50 },
      false,
      false,
    ],
    [
      "taps nothing when it lands on the panel",
      { x: 50, y: 50 },
      [],
      { x: 50, y: 50 },
      false,
      false,
    ],
    [
      "taps nothing when it lands on the button",
      { x: 90, y: 10 },
      [],
      { x: 90, y: 10 },
      false,
      false,
    ],
    [
      "taps nothing when it is released on the panel",
      { x: 25, y: 50 },
      [],
      { x: 31, y: 50 },
      false,
      false,
    ],
    ["taps nothing when the browser cancels it", { x: 5, y: 50 }, [], { x: 5, y: 50 }, true, false],
  ])("%s", (_, down, moves, up, cancelled, tapped) => {
    const press = moves.reduce<ReturnType<typeof outsidePressDown>>(
      (current, point) =>
        current === undefined ? undefined : outsidePressMove(TAP_MAX, point, current),
      outsidePressDown(AREA, down),
    );
    expect(outsideTapped(AREA, TAP_MAX, cancelled, press, up)).toBe(tapped);
  });
});
