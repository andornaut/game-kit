import { describe, expect, it } from "vitest";

import { opaqueBounds, opaqueBoundsOfRgba } from "./opaqueBounds";

describe("opaqueBounds", () => {
  it("boxes the opaque pixels, right and bottom one past them, and is undefined for a clear image", () => {
    const opaque = new Set(["3,2", "6,5", "4,7"]);
    expect(opaqueBounds(10, 10, (x, y) => opaque.has(`${x},${y}`))).toEqual({
      bottom: 8,
      left: 3,
      right: 7,
      top: 2,
    });
    expect(opaqueBounds(4, 4, () => false)).toBeUndefined();
  });

  it("reads the alpha byte of each RGBA pixel, row by row", () => {
    // 3x2: only (2, 0) and (1, 1) have alpha; (0, 1) has colour but no alpha.
    const rgba = [
      [9, 9, 9, 0],
      [9, 9, 9, 0],
      [0, 0, 0, 255],
      [9, 9, 9, 0],
      [0, 0, 0, 1],
      [0, 0, 0, 0],
    ].flat();
    expect(opaqueBoundsOfRgba(3, 2, Uint8ClampedArray.from(rgba))).toEqual({
      bottom: 2,
      left: 1,
      right: 3,
      top: 0,
    });
    expect(opaqueBoundsOfRgba(2, 2, new Uint8ClampedArray(16).fill(200, 0, 3))).toBeUndefined();
  });
});
