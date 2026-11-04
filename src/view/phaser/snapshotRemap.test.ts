import type { Scene } from "phaser";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Rect } from "../../rect.ts";
import { mountModalBackdrop } from "./modalBackdrop.ts";
import { snapshotRemapped } from "./snapshotRemap.ts";

vi.mock("phaser", () => ({
  Renderer: { Events: { POST_RENDER: "postrender" } },
  Scenes: { Events: { SHUTDOWN: "shutdown" } },
}));

const RGBA = 0x1908;
const UNSIGNED_BYTE = 0x1401;
const BUFFER_HEIGHT = 10;

// The browser's image element, which Node lacks.
class FakeImage {}

// A canvas texture's 2D context over a 1x1 canvas, recording what was drawn into it.
class FakeContext {
  drawn: unknown;
  readonly pixels = new Uint8ClampedArray([0xff, 0xff, 0xff, 0x80]);

  createImageData(width: number, height: number) {
    return { data: new Uint8ClampedArray(width * height * 4), height, width };
  }

  drawImage(image: unknown): void {
    this.drawn = image;
  }

  getImageData() {
    return { data: this.pixels };
  }

  putImageData(): void {}
}

interface FakeTexture {
  put?: { image: { data: Uint8ClampedArray }; x: number; y: number } | undefined;
  refreshed: boolean;
}

// A Canvas renderer that reads back snapshot, or a WebGL renderer whose drawing buffer holds raw
// (bottom row first) and which renders when complete is called. canvas false: the texture manager
// makes no canvas texture.
function fakeScene(
  options: Readonly<{
    canvas?: boolean;
    deferred?: boolean;
    premultipliedAlpha?: boolean;
    raw?: readonly number[];
    snapshot?: unknown;
  }>,
) {
  const { canvas = true, deferred = false, premultipliedAlpha = true, raw, snapshot } = options;
  let complete = () => {};
  const context = new FakeContext();
  const textures = new Map<string, FakeTexture>([["dim", { refreshed: false }]]);
  const areas: number[][] = [];
  const events: string[] = [];
  const reads: number[][] = [];
  const schedule = (callback: () => void) => {
    complete = callback;
    if (!deferred) {
      complete();
    }
  };
  const renderer =
    raw === undefined
      ? {
          snapshotArea(x: number, y: number, w: number, h: number, callback: (s: unknown) => void) {
            areas.push([x, y, w, h]);
            schedule(() => callback(snapshot));
          },
        }
      : {
          gl: {
            RGBA,
            UNSIGNED_BYTE,
            drawingBufferHeight: BUFFER_HEIGHT,
            readPixels(...args: [number, number, number, number, number, number, Uint8Array]) {
              reads.push(args.slice(0, 6) as number[]);
              args[6].set(raw);
            },
          },
          once(event: string, listener: () => void) {
            events.push(event);
            schedule(listener);
          },
        };
  const scene = {
    game: { config: { premultipliedAlpha }, renderer },
    textures: {
      createCanvas(key: string) {
        if (!canvas) {
          return null;
        }
        const texture = {
          getContext: () => context,
          put: undefined as FakeTexture["put"],
          putData(image: { data: Uint8ClampedArray }, x: number, y: number) {
            texture.put = { image, x, y };
          },
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
  return {
    areas,
    complete: () => complete(),
    context,
    events,
    reads,
    scene: scene as unknown as Scene,
    textures,
  };
}

const AREA = { height: 1, width: 1, x: 3, y: 4 };
const identity = (colour: number) => colour;

afterEach(() => {
  delete (globalThis as { HTMLImageElement?: unknown }).HTMLImageElement;
});

describe("snapshotRemapped on WebGL", () => {
  // Pixels: opaque O and Q, premultiplied half-alpha P, transparent T.
  const O = [1, 2, 3, 0xff];
  const Q = [9, 8, 7, 0xff];
  const P = [0x40, 0x20, 0x10, 0x80];
  const T = [5, 6, 7, 0];
  // P un-premultiplied: each channel times 255 / 0x80, floored.
  const S = [127, 63, 31, 0x80];
  const SQUARE = { height: 2, width: 2, x: 3, y: 4 };
  const COLUMN = { height: 3, width: 1, x: 0, y: 0 };
  const FRACTIONAL = { height: 1.2, width: 1.9, x: 2.6, y: -1.4 };
  // Area, premultiplied, buffer rows bottom first, texture rows top first, then the rounded
  // x, y, width and height, y counted up from the buffer's bottom, that Phaser would read.
  it.each<[string, Rect, boolean, number[][], number[][], number[]]>([
    ["two rows, premultiplied", SQUARE, true, [P, T, O, Q], [O, Q, S, T], [3, 4, 2, 2]],
    ["two rows, straight", SQUARE, false, [P, T, O, Q], [O, Q, P, T], [3, 4, 2, 2]],
    ["three rows about the middle", COLUMN, true, [O, P, Q], [Q, S, O], [0, 7, 1, 3]],
    ["a fractional area, as Phaser rounds it", FRACTIONAL, true, [O], [O], [3, 8, 1, 1]],
  ])("reads %s at post-render", async (_, area, premultipliedAlpha, raw, expected, read) => {
    const view = fakeScene({ deferred: true, premultipliedAlpha, raw: raw.flat() });
    const pending = snapshotRemapped(identity, view.scene, area, "dim");
    expect(view.reads).toEqual([]);
    view.complete();
    expect(await pending).toBe(true);
    const texture = view.textures.get("dim");
    expect({
      events: view.events,
      pixels: [...(texture?.put?.image.data ?? [])],
      position: [texture?.put?.x, texture?.put?.y],
      reads: view.reads,
      refreshed: texture?.refreshed,
    }).toEqual({
      events: ["postrender"],
      pixels: expected.flat(),
      position: [0, 0],
      reads: [[...read, RGBA, UNSIGNED_BYTE]],
      refreshed: true,
    });
  });

  it("remaps each read pixel's colour and keeps its alpha", async () => {
    const view = fakeScene({ raw: [0xff, 0xff, 0xff, 0x80] });
    expect(await snapshotRemapped(() => 0x102030, view.scene, AREA, "dim")).toBe(true);
    const pixels = [...(view.textures.get("dim")?.put?.image.data ?? [])];
    expect(pixels).toEqual([0x10, 0x20, 0x30, 0x80]);
  });

  it.each<[string, Rect, boolean]>([
    ["no canvas texture", AREA, false],
    ["an empty area", { ...AREA, width: 0 }, true],
  ])("resolves false with %s", async (_, area, canvas) => {
    const view = fakeScene({ canvas, raw: [] });
    await expect(snapshotRemapped(identity, view.scene, area, "dim")).resolves.toBe(false);
  });
});

describe("snapshotRemapped on Canvas", () => {
  it("settles a modal fallback and removes its failed deferred capture", async () => {
    (globalThis as { HTMLImageElement?: unknown }).HTMLImageElement = FakeImage;
    const { complete, scene, textures } = fakeScene({ deferred: true, snapshot: new FakeImage() });
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

  it("draws the area's pixels remapped into a fresh texture", async () => {
    (globalThis as { HTMLImageElement?: unknown }).HTMLImageElement = FakeImage;
    const image = new FakeImage();
    const { areas, context, scene, textures } = fakeScene({ snapshot: image });
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
    const { scene } = fakeScene({ canvas, snapshot });
    await expect(snapshotRemapped(identity, scene, AREA, "dim")).resolves.toBe(false);
  });
});

it.each<[string, Parameters<typeof fakeScene>[0]]>([
  ["WebGL", { raw: [0, 0, 0, 0xff] }],
  ["Canvas", { snapshot: new FakeImage() }],
])("rejects errors from a deferred %s read", async (_, options) => {
  (globalThis as { HTMLImageElement?: unknown }).HTMLImageElement = FakeImage;
  const { complete, scene } = fakeScene({ ...options, deferred: true });
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
