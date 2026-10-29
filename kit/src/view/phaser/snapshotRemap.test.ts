import type { Scene } from "phaser";
import { afterEach, describe, expect, it } from "vitest";

import { snapshotRemapped } from "./snapshotRemap";

// The browser's image element, which Node lacks.
class FakeImage {}

// A canvas texture's 2D context over a 1x1 canvas, recording what was drawn into it.
class FakeContext {
  drawn: unknown;
  readonly pixels = new Uint8ClampedArray([0xff, 0xff, 0xff, 0x80]);

  drawImage(image: unknown): void {
    this.drawn = image;
  }

  getImageData() {
    return { data: this.pixels };
  }

  putImageData(): void {}
}

// A scene whose renderer reads back snapshot, and whose texture manager holds textures by key.
// canvas false: the manager makes no canvas texture.
function fakeScene(snapshot: unknown, canvas = true) {
  const context = new FakeContext();
  const textures = new Map<string, { refreshed: boolean }>([["dim", { refreshed: false }]]);
  const areas: number[][] = [];
  const scene = {
    game: {
      renderer: {
        snapshotArea(x: number, y: number, w: number, h: number, callback: (s: unknown) => void) {
          areas.push([x, y, w, h]);
          callback(snapshot);
        },
      },
    },
    textures: {
      createCanvas(key: string) {
        if (!canvas) {
          return null;
        }
        const texture = {
          getContext: () => context,
          refresh() {
            texture.refreshed = true;
          },
          refreshed: false,
        };
        textures.set(key, texture);
        return texture;
      },
      exists: (key: string) => textures.has(key),
      remove: (key: string) => textures.delete(key),
    },
  };
  return { areas, context, scene: scene as unknown as Scene, textures };
}

const AREA = { height: 1, width: 1, x: 3, y: 4 };

afterEach(() => {
  delete (globalThis as { HTMLImageElement?: unknown }).HTMLImageElement;
});

describe("snapshotRemapped", () => {
  it("draws the area's pixels remapped into a fresh texture", async () => {
    (globalThis as { HTMLImageElement?: unknown }).HTMLImageElement = FakeImage;
    const image = new FakeImage();
    const { areas, context, scene, textures } = fakeScene(image);
    const drawn = await snapshotRemapped(() => 0x102030, scene, AREA, "dim");
    expect({
      areas,
      drawn,
      image: context.drawn === image,
      pixels: [...context.pixels],
      refreshed: textures.get("dim")?.refreshed,
    }).toEqual({
      areas: [[3, 4, 1, 1]],
      drawn: true,
      image: true,
      pixels: [0x10, 0x20, 0x30, 0x80],
      refreshed: true,
    });
  });

  it.each([
    ["no image element in the environment", false, new FakeImage(), true],
    ["a snapshot that is no image", true, { r: 0 }, true],
    ["no canvas texture", true, new FakeImage(), false],
  ])("resolves false with %s", async (_, browser, snapshot, canvas) => {
    if (browser) {
      (globalThis as { HTMLImageElement?: unknown }).HTMLImageElement = FakeImage;
    }
    const { scene } = fakeScene(snapshot, canvas);
    await expect(snapshotRemapped((colour) => colour, scene, AREA, "dim")).resolves.toBe(false);
  });
});
