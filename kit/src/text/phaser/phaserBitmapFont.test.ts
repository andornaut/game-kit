import { describe, expect, it } from "vitest";

import { parseBitmapFont } from "../bitmapFont";
import { phaserBitmapFont, type PhaserFontData } from "./phaserBitmapFont";

// A space, an H, and a g kerned a column closer after an H.
const FNT = `<font><common lineHeight="11"/>
  <char id="32" width="0" height="0" xoffset="0" yoffset="0" xadvance="2"/>
  <char id="72" width="4" height="6" xoffset="0" yoffset="2" xadvance="5"/>
  <char id="103" width="3" height="6" xoffset="-1" yoffset="4" xadvance="4"/>
  <kerning first="72" second="103" amount="-1"/>
</font>`;

// The same font as Phaser's XML parser caches it: glyphs by character code, each kerning on
// the second character, keyed by the first's code.
function glyph(width: number, height: number, xOffset: number, yOffset: number, xAdvance: number) {
  return { height, kerning: {}, width, xAdvance, xOffset, yOffset };
}
const DATA: PhaserFontData = {
  chars: {
    103: { ...glyph(3, 6, -1, 4, 4), kerning: { 72: -1 } },
    32: glyph(0, 0, 0, 0, 2),
    72: glyph(4, 6, 0, 2, 5),
  },
  lineHeight: 11,
};

describe("phaserBitmapFont", () => {
  it("reads the font Phaser caches as parseBitmapFont reads its .fnt", () => {
    expect(phaserBitmapFont(DATA)).toEqual(parseBitmapFont(FNT));
  });
});
