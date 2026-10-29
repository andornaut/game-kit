import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";

import { decodePng } from "./png";

// A 2x1 PNG of the given RGBA bytes, written in a PNG colour type: 2 is RGB, 6 is RGBA.
function png(colorType: 2 | 6, rgba: number[]): Uint8Array {
  const image = new PNG({ height: 1, width: 2 });
  image.data.set(rgba);
  return PNG.sync.write(image, { colorType });
}

describe("decodePng", () => {
  it.each<[string, 2 | 6, number[], number[]]>([
    [
      "keeps an RGBA PNG's colour and alpha",
      6,
      [1, 2, 3, 0, 250, 251, 252, 128],
      [1, 2, 3, 0, 250, 251, 252, 128],
    ],
    [
      "reads an RGB PNG, which has no alpha, as opaque",
      2,
      [1, 2, 3, 255, 4, 5, 6, 255],
      [1, 2, 3, 255, 4, 5, 6, 255],
    ],
  ])("%s", (_, colorType, rgba, expected) => {
    expect(decodePng(png(colorType, rgba))).toEqual({
      data: new Uint8Array(expected),
      height: 1,
      width: 2,
    });
  });
});
