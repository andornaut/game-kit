export interface PixelGlyph {
  readonly bits: string;
  readonly char: string;
  readonly width: number;
}

export interface PixelFontContext {
  readonly glyphs: readonly PixelGlyph[];
  readonly height: number;
  readonly spaceWidth: number;
  readonly spacing: number;
}

export interface AtlasGlyph {
  readonly advance: number;
  readonly char: string;
  readonly pixels: readonly (readonly [number, number])[];
  readonly width: number;
  readonly x: number;
}

export interface PixelFontAtlas {
  readonly glyphs: readonly AtlasGlyph[];
  readonly height: number;
  readonly width: number;
}

// Unknown characters advance as spaces; clients supply any text normalization.
export function glyphAdvance(context: PixelFontContext, char: string): number {
  const widths = new Map(context.glyphs.map(({ char, width }) => [char, width]));
  return (widths.get(char) ?? context.spaceWidth) + context.spacing;
}

// Glyphs occupy one row with supplied spacing after each glyph, including the last.
export function pixelFontAtlas(context: PixelFontContext): PixelFontAtlas {
  let x = 0;
  const glyphs = context.glyphs.map(({ bits, char, width }): AtlasGlyph => {
    const pixels: [number, number][] = [];
    [...bits].forEach((bit, index) => {
      if (bit === "1") {
        pixels.push([index % width, Math.floor(index / width)]);
      }
    });
    const glyph = { advance: glyphAdvance(context, char), char, pixels, width, x };
    x += width + context.spacing;
    return glyph;
  });
  return { glyphs, height: context.height, width: x };
}
