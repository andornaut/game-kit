import { describe, expect, it } from "vitest";

import { rampDown, remapRgb } from "./rgba";

const WHITE = 0xffffff;
const CREAM = 0xf0e0c0;
const GREY = 0x808080;
const INK = 0x101020;
// One ramp, lightest first: each colour maps to the next, and the darkest to none.
const ONE_STEP = new Map([
  [WHITE, CREAM],
  [CREAM, GREY],
  [GREY, INK],
]);

describe("rampDown", () => {
  it.each([
    ["a palette colour one step", WHITE, 1, CREAM],
    ["a palette colour two steps", WHITE, 2, GREY],
    ["a colour no steps, onto the palette", 0xfefefe, 0, WHITE],
    ["a colour off the palette from its nearest", 0xf1e1c1, 1, GREY],
    ["the darkest colour, which stays", INK, 1, INK],
    ["past a ramp's end, stopping there", CREAM, 5, INK],
  ])("moves %s", (_, colour, steps, expected) => {
    expect(rampDown(ONE_STEP, steps)(colour)).toBe(expected);
  });

  it("leaves a colour alone with no palette", () => {
    expect(rampDown(new Map(), 2)(CREAM)).toBe(CREAM);
  });
});

describe("remapRgb", () => {
  it("remaps each pixel's colour, keeps its alpha, and asks once per colour", () => {
    const asked: number[] = [];
    const pixels = new Uint8ClampedArray([0xff, 0xff, 0xff, 0x80, 0xff, 0xff, 0xff, 0xff]);
    remapRgb((colour) => {
      asked.push(colour);
      return CREAM;
    }, pixels);
    expect({ asked, pixels: [...pixels] }).toEqual({
      asked: [WHITE],
      pixels: [0xf0, 0xe0, 0xc0, 0x80, 0xf0, 0xe0, 0xc0, 0xff],
    });
  });
});
