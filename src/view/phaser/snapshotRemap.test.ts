import type { Scene } from "phaser";
import { afterEach, describe, expect, it } from "vitest";

import { mountModalBackdrop } from "./modalBackdrop.ts";
import { snapshotRemapped } from "./snapshotRemap.ts";

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
function fakeScene(snapshot: unknown, canvas = true, deferred = false) {
  let complete = () => {};
  const context = new FakeContext();
  const textures = new Map<string, { refreshed: boolean }>([["dim", { refreshed: false }]]);
  const areas: number[][] = [];
  const scene = {
    game: {
      renderer: {
        snapshotArea(x: number, y: number, w: number, h: number, callback: (s: unknown) => void) {
          areas.push([x, y, w, h]);
          complete = () => callback(snapshot);
          if (!deferred) {
            complete();
          }
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
  return { areas, complete: () => complete(), context, scene: scene as unknown as Scene, textures };
}

const AREA = { height: 1, width: 1, x: 3, y: 4 };

afterEach(() => {
  delete (globalThis as { HTMLImageElement?: unknown }).HTMLImageElement;
});

describe("snapshotRemapped", () => {
  it("settles a modal fallback and removes its failed deferred capture", async () => {
    (globalThis as { HTMLImageElement?: unknown }).HTMLImageElement = FakeImage;
    const { complete, scene, textures } = fakeScene(new FakeImage(), true, true);
    let destroyed = false;
    let fallback = false;
    const object = {
      destroy() {
        destroyed = true;
      },
      setDepth() {
        return object;
      },
      setOrigin() {
        return object;
      },
      setScrollFactor() {
        return object;
      },
    };
    Object.assign(scene, {
      add: {
        rectangle() {
          fallback = true;
          return object;
        },
      },
      events: { off() {}, once() {} },
    });
    const handle = mountModalBackdrop(
      {
        depth: 1,
        fallbackColour: 0,
        remap: () => {
          throw new Error("readback failed");
        },
        scene,
      },
      AREA,
    );
    complete();
    await expect(handle.ready).resolves.toBe(false);
    expect(fallback).toBe(true);
    expect([...textures.keys()]).toEqual(["dim"]);
    handle.destroy();
    expect(destroyed).toBe(true);
  });
  it("rejects errors from a deferred renderer callback", async () => {
    (globalThis as { HTMLImageElement?: unknown }).HTMLImageElement = FakeImage;
    const { complete, scene } = fakeScene(new FakeImage(), true, true);
    const failure = new Error("readback failed");
    const pending = snapshotRemapped(
      () => {
        throw failure;
      },
      scene,
      AREA,
      "dim",
    );
    const rejected = expect(pending).rejects.toBe(failure);
    expect(complete).not.toThrow();
    await rejected;
  });
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
