import type { Scene } from "phaser";
import { afterEach, expect, it, vi } from "vitest";

import { mountModalBackdrop } from "./modalBackdrop.ts";
import { snapshotRemapped } from "./snapshotRemap.ts";

vi.mock("./snapshotRemap", () => ({ snapshotRemapped: vi.fn() }));

function setup() {
  const textures = new Set<string>();
  const object = {
    destroy: vi.fn(),
    setDepth: vi.fn(),
    setOrigin: vi.fn(),
    setScrollFactor: vi.fn(),
  };
  object.setDepth.mockReturnValue(object);
  object.setOrigin.mockReturnValue(object);
  object.setScrollFactor.mockReturnValue(object);
  let shutdown: (() => void) | undefined;
  const fake = {
    add: { image: vi.fn(() => object), rectangle: vi.fn(() => object) },
    events: {
      off: vi.fn(),
      once: vi.fn((_event: string, handler: () => void) => {
        shutdown = handler;
      }),
    },
    textures: {
      exists: (key: string) => textures.has(key),
      remove: vi.fn((key: string) => textures.delete(key)),
    },
  };
  const context = {
    depth: -1,
    fallbackColour: 0x181425,
    remap: (colour: number) => colour,
    scene: fake as unknown as Scene,
  };
  return { context, fake, object, shutdown: () => shutdown?.(), textures };
}

const area = { height: 200, width: 300, x: 5, y: 6 };
afterEach(() => vi.clearAllMocks());

it("paints a remapped snapshot at caller depth and destroys only its owned texture", async () => {
  const view = setup();
  view.textures.add("unrelated");
  vi.mocked(snapshotRemapped).mockImplementation(async (_remap, _scene, _area, key) => {
    view.textures.add(key);
    return true;
  });
  const backdrop = mountModalBackdrop(view.context, area);
  expect(view.fake.add.image).not.toHaveBeenCalled();
  expect(await backdrop.ready).toBe(true);
  expect(view.fake.add.image).toHaveBeenCalledWith(5, 6, expect.any(String));
  expect(view.object.setDepth).toHaveBeenCalledWith(-1);
  backdrop.destroy();
  backdrop.destroy();
  expect(view.object.destroy).toHaveBeenCalledTimes(1);
  expect([...view.textures]).toEqual(["unrelated"]);
});

it.each(["unavailable", "failed"])(
  "uses the palette fallback when canvas readback is %s",
  async (result) => {
    const view = setup();
    vi.mocked(snapshotRemapped).mockImplementation(() =>
      result === "failed" ? Promise.reject(new Error("readback")) : Promise.resolve(false),
    );
    const backdrop = mountModalBackdrop(view.context, area);
    expect(await backdrop.ready).toBe(false);
    expect(view.fake.add.rectangle).toHaveBeenCalledWith(5, 6, 300, 200, 0x181425);
    expect(view.fake.add.image).not.toHaveBeenCalled();
    view.shutdown();
    expect(view.object.destroy).toHaveBeenCalledTimes(1);
  },
);

it("cleans a late capture after shutdown without adding an object or touching a newer backdrop", async () => {
  const view = setup();
  let finish: ((captured: boolean) => void) | undefined;
  let oldKey = "";
  vi.mocked(snapshotRemapped).mockImplementation((_remap, _scene, _area, key) => {
    oldKey = key;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const old = mountModalBackdrop(view.context, area);
  view.shutdown();
  vi.mocked(snapshotRemapped).mockImplementation(async (_remap, _scene, _area, key) => {
    view.textures.add(key);
    return true;
  });
  const current = mountModalBackdrop(view.context, area);
  await current.ready;
  view.textures.add(oldKey);
  finish?.(true);
  expect(await old.ready).toBe(false);
  expect(view.fake.add.image).toHaveBeenCalledTimes(1);
  expect([...view.textures]).toHaveLength(1);
  expect(view.textures.has(oldKey)).toBe(false);
  current.destroy();
});
