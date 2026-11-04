import { describe, expect, it } from "vitest";

import { rampDown, remapRgb } from "./rgba.ts";

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

// Flat RGBA bytes, each pixel's alpha its position plus one, so a test sees alpha kept.
function rgba(colours: readonly number[]): number[] {
  return colours.flatMap((colour, index) => [
    (colour >> 16) & 0xff,
    (colour >> 8) & 0xff,
    colour & 0xff,
    index + 1,
  ]);
}

// Each palette colour one step down its ramp; any other colour unchanged.
const darken = (colour: number) => ONE_STEP.get(colour) ?? colour;

describe("remapRgb", () => {
  it.each<[string, number[], number[], number[]]>([
    ["one colour", [WHITE, WHITE], [CREAM, CREAM], [WHITE]],
    ["a run of one colour", [GREY, GREY, GREY], [INK, INK, INK], [GREY]],
    ["alternation", [WHITE, CREAM, WHITE, CREAM], [CREAM, GREY, CREAM, GREY], [WHITE, CREAM]],
    ["a colour the remap keeps", [INK, WHITE, INK], [INK, CREAM, INK], [INK, WHITE]],
    ["no pixels", [], [], []],
  ])("remaps %s, keeping alpha and asking once per colour", (_, input, expected, asked) => {
    const seen: number[] = [];
    const pixels = new Uint8ClampedArray(rgba(input));
    remapRgb((colour) => {
      seen.push(colour);
      return darken(colour);
    }, pixels);
    expect({ asked: seen, pixels: [...pixels] }).toEqual({ asked, pixels: rgba(expected) });
  });
});
