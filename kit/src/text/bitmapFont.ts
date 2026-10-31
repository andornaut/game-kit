// A bitmap font's glyph, in font pixels: its inked box from the pen position and the line's
// top, and how far it moves the pen.
export interface BitmapGlyph {
  readonly advance: number;
  readonly height: number;
  readonly width: number;
  readonly xOffset: number;
  readonly yOffset: number;
}

// A bitmap font: its glyphs by character, the pen shift between a pair of characters (keyed
// first then second), and its line height, in font pixels. parseBitmapFont reads one from an
// XML BMFont file; phaser/phaserBitmapFont reads one from Phaser's bitmap font cache.
export interface BitmapFont {
  readonly glyphs: ReadonlyMap<string, BitmapGlyph>;
  readonly kernings: ReadonlyMap<string, number>;
  readonly lineHeight: number;
}

function attributes(tag: string): Map<string, number> {
  return new Map(
    [...tag.matchAll(/(\w+)="(-?\d+)"/g)].map(([, name, value]) => [name ?? "", Number(value)]),
  );
}

function char(code: number | undefined): string {
  return String.fromCodePoint(code ?? 0);
}

// The font an XML BMFont (.fnt) file describes.
export function parseBitmapFont(fnt: string): BitmapFont {
  const common = attributes(/<common\b[^>]*>/.exec(fnt)?.[0] ?? "");
  const glyphs = new Map(
    [...fnt.matchAll(/<char\b[^>]*>/g)].map(([tag]) => {
      const field = attributes(tag);
      const glyph: BitmapGlyph = {
        advance: field.get("xadvance") ?? 0,
        height: field.get("height") ?? 0,
        width: field.get("width") ?? 0,
        xOffset: field.get("xoffset") ?? 0,
        yOffset: field.get("yoffset") ?? 0,
      };
      return [char(field.get("id")), glyph] as const;
    }),
  );
  const kernings = new Map(
    [...fnt.matchAll(/<kerning\b[^>]*>/g)].map(([tag]) => {
      const field = attributes(tag);
      return [char(field.get("first")) + char(field.get("second")), field.get("amount") ?? 0];
    }),
  );
  return { glyphs, kernings, lineHeight: common.get("lineHeight") ?? 0 };
}

// A font's rows, in font pixels down from a line's top: where its capitals start (capTop) and
// how many rows they take, from its H; the highest row a letter or digit inks, ascenders
// included (letterTop); the row under its lowest ink, descenders included; and the distance
// from one line's top to the next.
export interface FontMetrics {
  readonly capHeight: number;
  readonly capTop: number;
  readonly inkBottom: number;
  readonly letterTop: number;
  readonly lineHeight: number;
}

export function fontMetrics(font: {
  readonly glyphs: ReadonlyMap<string, Pick<BitmapGlyph, "height" | "yOffset">>;
  readonly lineHeight: number;
}): FontMetrics {
  const capital = font.glyphs.get("H");
  const inked = [...font.glyphs.values()].filter((glyph) => glyph.height > 0);
  const letters = [...font.glyphs]
    .filter(([char, glyph]) => glyph.height > 0 && /[\p{L}\p{N}]/u.test(char))
    .map(([, glyph]) => glyph.yOffset);
  return {
    capHeight: capital?.height ?? 0,
    capTop: capital?.yOffset ?? 0,
    inkBottom: Math.max(0, ...inked.map((glyph) => glyph.yOffset + glyph.height)),
    letterTop: letters.length === 0 ? (capital?.yOffset ?? 0) : Math.min(...letters),
    lineHeight: font.lineHeight,
  };
}

// The columns from the pen to the first column text's first glyph inks, in font pixels: its left
// side bearing, or 0 for text with no glyph.
export function leftBearing(
  glyph: (char: string) => Pick<BitmapGlyph, "xOffset"> | undefined,
  text: string,
): number {
  const first = [...text].find((char) => char.trim() !== "");
  return first === undefined ? 0 : Math.max(0, glyph(first)?.xOffset ?? 0);
}

// The rows of ink from the top of the capitals to the lowest ink.
export function inkRowsFromCapTop(metrics: FontMetrics): number {
  return metrics.inkBottom - metrics.capTop;
}

// The rows from the first line's capitals to the last line's lowest ink, for lines lines a
// line height apart (at least one).
export function inkRowsOfLines(metrics: FontMetrics, lines: number): number {
  return (Math.max(1, lines) - 1) * metrics.lineHeight + inkRowsFromCapTop(metrics);
}

// A character of a line as Phaser lays it out, with the screen columns it inks from the line's
// left edge, or null where its glyph inks nothing, such as a space's.
export interface LaidGlyph {
  readonly char: string;
  readonly ink: { readonly left: number; readonly right: number } | null;
}

// Each character of line the font has, laid out at scale as Phaser's BitmapText lays it out:
// the pen moves by each glyph's advance and the kerning between it and the glyph before, both in
// font pixels before scale. A character the font lacks is skipped, as Phaser skips it.
export function laidGlyphs(font: BitmapFont, scale: number, line: string): LaidGlyph[] {
  let x = 0;
  let previous: string | null = null;
  return [...line].flatMap((char) => {
    const glyph = font.glyphs.get(char);
    if (glyph === undefined) {
      return [];
    }
    x += previous === null ? 0 : (font.kernings.get(previous + char) ?? 0);
    const left = x + glyph.xOffset;
    x += glyph.advance;
    previous = char;
    const ink =
      glyph.width === 0 ? null : { left: left * scale, right: (left + glyph.width) * scale };
    return [{ char, ink }];
  });
}

// The screen pixels from the first column line inks to the last, in the font at scale: its
// first glyph's left side bearing and its last glyph's right one left out. 0 for a line that
// inks nothing.
export function inkWidth(font: BitmapFont, scale: number, line: string): number {
  let left: number | undefined;
  let right = -Infinity;
  for (const { ink } of laidGlyphs(font, scale, line)) {
    if (ink !== null) {
      left = Math.min(left ?? Infinity, ink.left);
      right = Math.max(right, ink.right);
    }
  }
  return left === undefined ? 0 : right - left;
}
