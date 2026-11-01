import type { Types } from "phaser";

import type { BitmapFont, BitmapGlyph } from "../bitmapFont";

// A glyph as Phaser's bitmap font parsers cache it. Phaser's typedef leaves out xAdvance, its
// advance, which the parsers set.
type PhaserGlyph = Pick<
  Types.GameObjects.BitmapText.BitmapFontCharacterData,
  "height" | "kerning" | "width" | "xOffset" | "yOffset"
> & { readonly xAdvance: number };

// The fields of Phaser's BitmapFontData that phaserBitmapFont reads.
export interface PhaserFontData {
  readonly chars: Readonly<Record<number, PhaserGlyph>>;
  readonly lineHeight: number;
}

// A bitmap font as Phaser's bitmap font cache holds it (scene.cache.bitmapFont.get(key).data),
// read into the shape parseBitmapFont gives a .fnt, so text measured at runtime matches text
// measured from the .fnt in a test. Phaser keys glyphs by character code, and each glyph's
// kerning by the code of the character before it. Read once per font and keep the result:
// it copies every glyph.
export function phaserBitmapFont(data: PhaserFontData): BitmapFont {
  const glyphs = new Map<string, BitmapGlyph>();
  const kernings = new Map<string, number>();
  for (const [code, glyph] of Object.entries(data.chars)) {
    const char = String.fromCodePoint(Number(code));
    glyphs.set(char, {
      advance: glyph.xAdvance,
      height: glyph.height,
      width: glyph.width,
      xOffset: glyph.xOffset,
      yOffset: glyph.yOffset,
    });
    for (const [first, amount] of Object.entries(glyph.kerning)) {
      kernings.set(String.fromCodePoint(Number(first)) + char, amount);
    }
  }
  return { glyphs, kernings, lineHeight: data.lineHeight };
}
