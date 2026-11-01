import { describe, expect, it, vi } from "vitest";

import { type AtlasBuildPage, buildAtlasPages, drawAtlasPage } from "./atlasBuild.ts";

const source = { data: new Uint8Array([11, 22, 33, 0]), height: 1, width: 1 };
const page: AtlasBuildPage<{ file: string }> = {
  blits: [{ at: { x: 1, y: 1 }, from: { height: 1, width: 1, x: 0, y: 0 }, source: "pixel" }],
  height: 3,
  metadata: { file: "caller.webp" },
  width: 3,
};

describe("atlas page orchestration", () => {
  it("shares decoded sources and preserves extruded transparent RGB, metadata and page order", async () => {
    const read = vi.fn(async () => new Uint8Array([7]));
    const decode = vi.fn(() => source);
    const encode = vi.fn(async () => new Uint8Array([9]));
    const results = await buildAtlasPages({ decode, encode, extrude: 1, read }, [page, page]);
    expect(read).toHaveBeenCalledExactlyOnceWith("pixel");
    expect(decode).toHaveBeenCalledExactlyOnceWith(new Uint8Array([7]));
    expect(encode).toHaveBeenCalledTimes(2);
    expect(results.map(({ metadata }) => metadata)).toEqual([page.metadata, page.metadata]);
    expect(results[0]?.image.data).toEqual(new Uint8Array(Array(9).fill([11, 22, 33, 0]).flat()));
    expect(results[0]?.bytes).toEqual(new Uint8Array([9]));
  });

  it("uses supplied decoded images without IO and forwards frame bounds", async () => {
    const image = { data: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), height: 1, width: 2 };
    const read = vi.fn(async () => new Uint8Array());
    const decode = vi.fn(() => source);
    const bounded = {
      ...page,
      blits: page.blits.map((blit) => ({ ...blit, bounds: { height: 1, width: 2, x: 0, y: 0 } })),
    };
    const [result] = await buildAtlasPages(
      {
        decode,
        decoded: new Map([["pixel", image]]),
        encode: () => new Uint8Array(),
        extrude: 1,
        read,
      },
      [bounded],
    );
    expect(read).not.toHaveBeenCalled();
    expect(decode).not.toHaveBeenCalled();
    expect(result?.image.data.slice(8, 12)).toEqual(new Uint8Array([5, 6, 7, 8]));
    expect(() => drawAtlasPage(1, new Map(), page)).toThrow("No atlas source for pixel");
  });

  it("propagates codec failures", async () => {
    await expect(
      buildAtlasPages(
        {
          decode: () => source,
          encode: () => {
            throw new Error("codec failure");
          },
          extrude: 1,
          read: async () => new Uint8Array(),
        },
        [page],
      ),
    ).rejects.toThrow("codec failure");
  });
});
