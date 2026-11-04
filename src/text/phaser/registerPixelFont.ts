import type { Scene, Types } from "phaser";

import type { PixelFontAtlas } from "../pixelFont.ts";

export interface PixelFontRegistration {
  readonly colour: string;
  readonly key: string;
  readonly lineHeight: number;
  readonly size: number;
  readonly spaceAdvance: number;
}

export function registerPixelFont(
  scene: Scene,
  options: PixelFontRegistration,
  atlas: PixelFontAtlas,
): void {
  if (scene.cache.bitmapFont.exists(options.key)) {
    return;
  }
  // Phaser returns null for an invalid key or one an existing texture already uses.
  const texture = scene.textures.createCanvas(options.key, atlas.width, atlas.height);
  if (texture === null) {
    throw new Error(
      `Pixel font "${options.key}" has no cached font, and its texture key is invalid or already in use`,
    );
  }
  const context = texture.getContext();
  context.fillStyle = options.colour;
  for (const glyph of atlas.glyphs) {
    for (const [x, y] of glyph.pixels) {
      context.fillRect(glyph.x + x, y, 1, 1);
    }
  }
  texture.refresh();

  const chars: Types.GameObjects.BitmapText.BitmapFontData["chars"] = {};
  const glyphData = (x: number, width: number, advance: number) => ({
    centerX: Math.floor(width / 2),
    centerY: Math.floor(atlas.height / 2),
    data: {},
    height: atlas.height,
    kerning: {},
    u0: x / atlas.width,
    u1: (x + width) / atlas.width,
    v0: 1,
    v1: 0,
    width,
    x,
    xAdvance: advance,
    xOffset: 0,
    y: 0,
    yOffset: 0,
  });
  for (const glyph of atlas.glyphs) {
    chars[glyph.char.codePointAt(0) ?? 0] = glyphData(glyph.x, glyph.width, glyph.advance);
  }
  chars[" ".codePointAt(0) ?? 32] = glyphData(0, 0, options.spaceAdvance);
  scene.cache.bitmapFont.add(options.key, {
    data: {
      chars,
      font: options.key,
      lineHeight: options.lineHeight,
      retroFont: false,
      size: options.size,
    },
    frame: null,
    texture: options.key,
  });
}
