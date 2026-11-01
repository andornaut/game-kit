import type { Scene } from "phaser";
import { describe, expect, it, vi } from "vitest";

import { registerPixelFont } from "./registerPixelFont.ts";

const options = { colour: "#123456", key: "supplied", lineHeight: 7, size: 3, spaceAdvance: 4 };
const atlas = {
  glyphs: [{ advance: 3, char: "♥", pixels: [[1, 2]] as const, width: 2, x: 3 }],
  height: 3,
  width: 6,
};

function fixture(exists = false) {
  const context = { fillRect: vi.fn(), fillStyle: "" };
  const texture = { getContext: () => context, refresh: vi.fn() };
  const createCanvas = vi.fn((): typeof texture | null => texture);
  const add = vi.fn();
  const scene = {
    cache: { bitmapFont: { add, exists: () => exists } },
    textures: { createCanvas },
  };
  return { add, context, createCanvas, scene: scene as unknown as Scene, texture };
}

describe("pixel font registration", () => {
  it("draws supplied ink and caches Phaser metrics including space", () => {
    const f = fixture();
    registerPixelFont(f.scene, options, atlas);
    expect(f.createCanvas).toHaveBeenCalledWith("supplied", 6, 3);
    expect(f.context.fillStyle).toBe("#123456");
    expect(f.context.fillRect).toHaveBeenCalledWith(4, 2, 1, 1);
    expect(f.texture.refresh).toHaveBeenCalledOnce();
    expect(f.add).toHaveBeenCalledWith("supplied", {
      data: {
        chars: {
          32: expect.objectContaining({ height: 3, width: 0, xAdvance: 4 }),
          9829: expect.objectContaining({
            centerX: 1,
            centerY: 1,
            height: 3,
            kerning: {},
            u0: 0.5,
            u1: 5 / 6,
            v0: 1,
            v1: 0,
            width: 2,
            x: 3,
            xAdvance: 3,
            xOffset: 0,
            y: 0,
            yOffset: 0,
          }),
        },
        font: "supplied",
        lineHeight: 7,
        retroFont: false,
        size: 3,
      },
      frame: null,
      texture: "supplied",
    });
  });

  it("leaves existing font resources alone", () => {
    const f = fixture(true);
    registerPixelFont(f.scene, options, atlas);
    expect(f.createCanvas).not.toHaveBeenCalled();
    expect(f.add).not.toHaveBeenCalled();
  });

  it("does not cache a font when canvas creation fails", () => {
    const f = fixture();
    f.createCanvas.mockReturnValue(null);
    registerPixelFont(f.scene, options, atlas);
    expect(f.add).not.toHaveBeenCalled();
  });
});
