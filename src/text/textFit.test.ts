import { describe, expect, it } from "vitest";

import { parseBitmapFont } from "./bitmapFont";
import {
  bitmapMeasure,
  fitsRoom,
  fittingText,
  type TextFitStyle,
  type TextMeasure,
  widestLine,
} from "./textFit";

// Every character 4 font pixels wide, at the style's scale.
const measure: TextMeasure = (style, line) => line.length * 4 * style.scale;

describe("fittingText", () => {
  it.each<[string, TextFitStyle, number, string, string[], boolean]>([
    ["one line that fits", { scale: 2 }, 80, "ab cd", ["ab cd"], true],
    ["one line too wide, at its size", { scale: 2 }, 30, "ab cd", ["ab cd"], false],
    ["two lines wrapped at spaces", { lines: 2, scale: 2 }, 30, "abc def", ["abc", "def"], true],
    [
      "more lines than the style holds",
      { lines: 2, scale: 2 },
      20,
      "ab cd ef",
      ["ab", "cd", "ef"],
      false,
    ],
    ["a word too wide on its own line", { lines: 2, scale: 2 }, 24, "abcdef", ["abcdef"], false],
    ["a paragraph a line", { lines: 2, scale: 2 }, 30, "ab\ncd", ["ab", "cd"], true],
    ["a paragraph a line, on one line", { scale: 2 }, 30, "ab\ncd", ["ab", "cd"], false],
  ])("sets %s", (_case, style, room, text, lines, fits) => {
    const fitted = fittingText(style, measure, room, text);
    expect(fitted).toEqual({ lines, style });
    expect(fitsRoom(measure, room, fitted)).toBe(fits);
  });
});

describe("widestLine", () => {
  it.each<[string, string[], number]>([
    ["the widest of several lines", ["ab", "abcd", "a"], 32],
    ["0 for no lines", [], 0],
  ])("gives %s", (_case, lines, widest) => {
    expect(widestLine(measure, { lines, style: { scale: 2 } })).toBe(widest);
  });
});

describe("bitmapMeasure", () => {
  // Two glyphs: an inked 3-column box advancing 4, and a space advancing 2.
  const font = parseBitmapFont(`<font><common lineHeight="8"/>
    <char id="32" width="0" height="0" xoffset="0" yoffset="0" xadvance="2"/>
    <char id="111" width="3" height="4" xoffset="0" yoffset="2" xadvance="4"/>
  </font>`);

  it.each<[string, TextFitStyle, string, number]>([
    ["one glyph at 1x", { scale: 1 }, "o", 3],
    ["one glyph at the style's scale", { scale: 2 }, "o", 6],
    ["a word's ink, its last glyph's right bearing left out", { scale: 2 }, "oo o", 26],
  ])("measures %s", (_case, style, line, width) => {
    expect(bitmapMeasure(font)(style, line)).toBe(width);
  });

  it("wraps text by the font's ink", () => {
    const style = { lines: 2, scale: 2 };
    expect(fittingText(style, bitmapMeasure(font), 14, "oo oo")).toEqual({
      lines: ["oo", "oo"],
      style,
    });
  });
});
