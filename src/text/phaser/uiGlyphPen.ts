import type { Types } from "phaser";

import type { Quad, UiGlyphPen } from "../../view/phaser/uiCommands.ts";

export function uiGlyphPen(
  context: Readonly<{ baseline: number }>,
  submission: Readonly<{
    text: string;
    glyph: Pick<
      Types.GameObjects.BitmapText.BitmapFontCharacterData,
      "width" | "height" | "xOffset" | "yOffset"
    >;
    quad: Quad;
  }>,
): UiGlyphPen | undefined {
  const { glyph, quad, text } = submission;
  if (glyph.width === 0 || glyph.height === 0) {
    return undefined;
  }
  if (
    glyph.width < 0 ||
    glyph.height < 0 ||
    ![
      glyph.width,
      glyph.height,
      glyph.xOffset,
      glyph.yOffset,
      context.baseline,
      ...quad.flatMap(({ x, y }) => [x, y]),
    ].every(Number.isFinite)
  ) {
    throw new RangeError("Invalid UI glyph geometry");
  }
  const [tl, bl, , tr] = quad;
  const a = (tr.x - tl.x) / glyph.width;
  const b = (tr.y - tl.y) / glyph.width;
  const c = (bl.x - tl.x) / glyph.height;
  const d = (bl.y - tl.y) / glyph.height;
  return {
    baseline: context.baseline,
    pen: {
      x: tl.x - a * glyph.xOffset - c * glyph.yOffset,
      y: tl.y - b * glyph.xOffset - d * glyph.yOffset,
    },
    text,
    transform: [a, b, c, d],
  };
}
