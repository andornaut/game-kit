import { describe, expect, it } from "vitest";

import {
  fontMetrics,
  inkRowsFromCapTop,
  inkRowsOfLines,
  inkWidth,
  laidGlyphs,
  leftBearing,
  parseBitmapFont,
} from "./bitmapFont";

// A font with a capital H on rows 2 to 7, a d's ascender from row 1 inking a column right of its
// pen, a g reaching row 9 inking a column left of its pen, a backtick from row 0, a space, and H
// then g kerned closer.
const FNT = `<?xml version="1.0"?>
<font>
  <common lineHeight="11" base="8" scaleW="64" scaleH="16" pages="1" packed="0"/>
  <chars count="5">
    <char id="32" x="0" y="0" width="0" height="0" xoffset="0" yoffset="0" xadvance="2" page="0"/>
    <char id="72" x="1" y="0" width="4" height="6" xoffset="0" yoffset="2" xadvance="5" page="0"/>
    <char id="103" x="6" y="0" width="3" height="6" xoffset="-1" yoffset="4" xadvance="4" page="0"/>
    <char id="100" x="10" y="0" width="3" height="7" xoffset="1" yoffset="1" xadvance="4" page="0"/>
    <char id="96" x="14" y="0" width="1" height="2" xoffset="0" yoffset="0" xadvance="2" page="0"/>
  </chars>
  <kernings count="1">
    <kerning first="72" second="103" amount="-1"/>
  </kernings>
</font>`;

const FONT = parseBitmapFont(FNT);

describe("parseBitmapFont", () => {
  it.each([
    [" ", { advance: 2, height: 0, width: 0, xOffset: 0, yOffset: 0 }],
    ["H", { advance: 5, height: 6, width: 4, xOffset: 0, yOffset: 2 }],
    ["g", { advance: 4, height: 6, width: 3, xOffset: -1, yOffset: 4 }],
  ])("reads %j's box and advance", (char, glyph) => {
    expect(FONT.glyphs.get(char)).toEqual(glyph);
  });

  it("reads the line height and the kerned pairs", () => {
    expect(FONT.lineHeight).toBe(11);
    expect([...FONT.kernings]).toEqual([["Hg", -1]]);
  });
});

describe("fontMetrics", () => {
  it("takes the capitals from H, the highest ink from letters and the lowest from any glyph", () => {
    const metrics = fontMetrics(FONT);
    expect(metrics).toEqual({
      capHeight: 6,
      capTop: 2,
      inkBottom: 10,
      letterTop: 1,
      lineHeight: 11,
    });
    expect(inkRowsFromCapTop(metrics)).toBe(8);
  });
});

describe("inkRowsOfLines", () => {
  const metrics = fontMetrics(FONT);
  it.each([
    [0, 8],
    [1, 8],
    [3, 2 * 11 + 8],
  ])("spans %i lines' capitals to their lowest ink in %i rows", (lines, rows) => {
    expect(inkRowsOfLines(metrics, lines)).toBe(rows);
  });
});

describe("leftBearing", () => {
  const glyph = (char: string) => FONT.glyphs.get(char);
  it.each([
    ["a glyph inking from its pen", "Hd", 0],
    ["a glyph inking right of its pen", "dH", 1],
    ["leading spaces skipped", "  d", 1],
    ["a glyph inking left of its pen, as 0", "g", 0],
    ["no glyph", " ", 0],
  ])("gives %s", (_case, text, bearing) => {
    expect(leftBearing(glyph, text)).toBe(bearing);
  });
});

describe("laidGlyphs", () => {
  it("moves the pen by each advance and kerned pair, at scale", () => {
    expect(laidGlyphs(FONT, 2, "H g")).toEqual([
      { char: "H", ink: { left: 0, right: 8 } },
      { char: " ", ink: null },
      // Pen at 5 + 2; g inks from a column left of it.
      { char: "g", ink: { left: 12, right: 18 } },
    ]);
  });

  it("kerns a pair only when its characters are adjacent glyphs", () => {
    expect(laidGlyphs(FONT, 1, "Hg").at(1)?.ink).toEqual({ left: 3, right: 6 });
  });

  it("skips characters the font lacks, as Phaser does", () => {
    expect(laidGlyphs(FONT, 1, "HxH")).toEqual(laidGlyphs(FONT, 1, "HH"));
  });
});

describe("inkWidth", () => {
  it.each([
    ["one glyph", 1, "H", 4],
    ["one glyph at 2x", 2, "H", 8],
    ["a kerned pair, the g's ink left of its pen", 1, "Hg", 6],
    ["leading and trailing spaces left out", 2, " H ", 8],
    ["a left bearing left out", 1, "dd", 7],
    ["nothing inked", 2, "  ", 0],
    ["no text", 2, "", 0],
  ])("measures %s", (_case, scale, line, width) => {
    expect(inkWidth(FONT, scale, line)).toBe(width);
  });
});
