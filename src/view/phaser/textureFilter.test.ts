import { Textures } from "phaser";
import { describe, expect, it, vi } from "vitest";

import { setTextureFilters } from "./textureFilter.ts";

vi.mock("phaser", async () => {
  const nodeModule = await import("node:module");
  const path = await import("node:path");
  const load = nodeModule.createRequire(import.meta.url);
  const root = path.dirname(load.resolve("phaser/package.json"));
  // The real constants, so tests compare against Phaser's values rather than copies.
  return { Textures: { FilterMode: load(path.join(root, "src/textures/const.js")) } };
});

function source() {
  return { setFilter: vi.fn() };
}
function manager(keys: Record<string, ReturnType<typeof source>[]>): Textures.TextureManager {
  return {
    exists: (key: string) => key in keys,
    get: (key: string) => ({ source: keys[key] }),
  } as unknown as Textures.TextureManager;
}

describe("setTextureFilters", () => {
  it("sets every source of each key to its mode", () => {
    const [a, b, c] = [source(), source(), source()];
    setTextureFilters(
      manager({ chrome: [c], tiles: [a, b] }),
      new Map([
        ["chrome", "linear"],
        ["tiles", "nearest"],
      ]),
    );
    expect([a, b, c].map((value) => value.setFilter.mock.calls)).toEqual([
      [[Textures.FilterMode.NEAREST]],
      [[Textures.FilterMode.NEAREST]],
      [[Textures.FilterMode.LINEAR]],
    ]);
  });

  it("sets a source shared by keys with one mode once", () => {
    const page = source();
    setTextureFilters(
      manager({ hero: [page], tree: [page] }),
      new Map([
        ["hero", "nearest"],
        ["tree", "nearest"],
      ]),
    );
    expect(page.setFilter).toHaveBeenCalledExactlyOnceWith(Textures.FilterMode.NEAREST);
  });

  it("throws on a missing key without changing any filter", () => {
    const page = source();
    expect(() =>
      setTextureFilters(
        manager({ hero: [page] }),
        new Map([
          ["hero", "nearest"],
          ["absent", "linear"],
        ]),
      ),
    ).toThrow("No texture absent to filter");
    expect(page.setFilter).not.toHaveBeenCalled();
  });

  it("throws on keys sharing a source with different modes without changing any filter", () => {
    const [page, own] = [source(), source()];
    expect(() =>
      setTextureFilters(
        manager({ hero: [own, page], tree: [page] }),
        new Map([
          ["hero", "nearest"],
          ["tree", "linear"],
        ]),
      ),
    ).toThrow("Textures hero and tree share a source with different filters");
    expect([own, page].map((value) => value.setFilter.mock.calls.length)).toEqual([0, 0]);
  });
});
