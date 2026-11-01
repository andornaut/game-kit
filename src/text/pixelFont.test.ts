import { describe, expect, it } from "vitest";

import { glyphAdvance, pixelFontAtlas } from "./pixelFont.ts";

const context = {
  glyphs: [
    { bits: "1001", char: "a", width: 2 },
    { bits: "101", char: "♥", width: 3 },
  ],
  height: 2,
  spaceWidth: 4,
  spacing: 2,
};

describe("supplied pixel glyphs", () => {
  it("lays out varying widths and lit pixels with trailing spacing", () => {
    expect(pixelFontAtlas(context)).toEqual({
      glyphs: [
        {
          advance: 4,
          char: "a",
          pixels: [
            [0, 0],
            [1, 1],
          ],
          width: 2,
          x: 0,
        },
        {
          advance: 5,
          char: "♥",
          pixels: [
            [0, 0],
            [2, 0],
          ],
          width: 3,
          x: 4,
        },
      ],
      height: 2,
      width: 9,
    });
  });

  it("uses supplied fallback widths without normalizing text", () => {
    expect(glyphAdvance(context, "a")).toBe(4);
    expect(glyphAdvance(context, "A")).toBe(6);
    expect(glyphAdvance(context, " ")).toBe(6);
  });

  it("supports an empty atlas", () => {
    expect(pixelFontAtlas({ ...context, glyphs: [] })).toEqual({ glyphs: [], height: 2, width: 0 });
  });
});
