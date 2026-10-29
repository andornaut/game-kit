import { describe, expect, it } from "vitest";

import type { Rect } from "../rect";
import { blankImage, blitExtruded, type RgbaImage } from "./rgbaImage";

// A grey image whose pixel at (x, y) is the single byte value 10 * y + x, opaque.
function numbered(width: number, height: number): RgbaImage {
  const image = blankImage(width, height);
  for (let i = 0; i < width * height; i++) {
    const value = 10 * Math.floor(i / width) + (i % width);
    image.data.set([value, value, value, 255], i * 4);
  }
  return image;
}

// Each pixel's grey value, or "-" where it is clear, row by row.
const rows = (image: RgbaImage) =>
  Array.from({ length: image.height }, (_, y) =>
    Array.from({ length: image.width }, (_, x) => {
      const at = (y * image.width + x) * 4;
      return image.data[at + 3] === 0 ? "-" : image.data[at];
    }),
  );

describe("blankImage", () => {
  it("is clear", () => {
    expect(rows(blankImage(2, 1))).toEqual([["-", "-"]]);
  });
});

describe("blitExtruded", () => {
  // The 2x2 rect at (1, 1) of a 4x4 image, extruded 1, onto a 5x5 or 4x4 page.
  const FROM = { height: 2, width: 2, x: 1, y: 1 };

  it.each<[string, Rect | undefined, number, number[][] | (number | string)[][]]>([
    [
      "repeats the rect's own edges when bounds is the rect",
      undefined,
      5,
      [
        ["-", "-", "-", "-", "-"],
        ["-", 11, 11, 12, 12],
        ["-", 11, 11, 12, 12],
        ["-", 21, 21, 22, 22],
        ["-", 21, 21, 22, 22],
      ],
    ],
    [
      "reads the border inside bounds",
      { height: 4, width: 4, x: 0, y: 0 },
      4,
      [
        [0, 1, 2, 3],
        [10, 11, 12, 13],
        [20, 21, 22, 23],
        [30, 31, 32, 33],
      ],
    ],
    [
      "repeats bounds' edge pixels past it",
      { height: 3, width: 3, x: 1, y: 1 },
      4,
      [
        [11, 11, 12, 13],
        [11, 11, 12, 13],
        [21, 21, 22, 23],
        [31, 31, 32, 33],
      ],
    ],
  ])("%s", (_, bounds, size, expected) => {
    const target = blankImage(size, size);
    const at = { x: size - 3, y: size - 3 };
    blitExtruded(numbered(4, 4), FROM, 1, target, at, bounds);
    expect(rows(target)).toEqual(expected);
  });
});
