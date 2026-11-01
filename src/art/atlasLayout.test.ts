import { describe, expect, it } from "vitest";

import { type AtlasItem, type AtlasPolicy, packAtlas } from "./atlasLayout.ts";

const item = (value: string, ...sizes: [number, number][]): AtlasItem<string> => ({
  rectangles: sizes.map(([width, height]) => ({ height, width })),
  value,
});
const policy: AtlasPolicy<string> = {
  compare: () => 0,
  extrude: 1,
  maxSize: 10,
  widths: [10],
};

describe("packAtlas", () => {
  it.each<[string, [number, number][], number, number]>([
    ["one rectangle", [[24, 24]], 2048, 1],
    [
      "wide strips",
      [
        [672, 42],
        [384, 80],
        [300, 36],
        [250, 26],
      ],
      2048,
      1,
    ],
    [
      "tall and wide rectangles",
      [
        [48, 720],
        [640, 96],
        [336, 272],
        [96, 204],
      ],
      2048,
      1,
    ],
    [
      "page spill",
      [
        [60, 60],
        [60, 60],
        [60, 60],
        [60, 60],
        [60, 60],
      ],
      128,
      2,
    ],
  ])(
    "packs %s once each with bounded, nonoverlapping extruded cells",
    (_, sizes, maxSize, pages) => {
      const items = sizes.map((size, index) => item(String(index), size));
      const extrude = 1;
      const layout = packAtlas(
        {
          compare: () => 0,
          extrude,
          maxSize,
          widths: [maxSize],
        },
        items,
      );
      expect(layout?.pages).toHaveLength(pages);
      const cells =
        layout?.pages.flatMap((page, pageIndex) =>
          page.placed.flatMap(({ at, item }) => {
            expect(at).toHaveLength(item.rectangles.length);
            return item.rectangles.map(({ height, width }, index) => {
              const point = at[index];
              expect(point).toBeDefined();
              const left = (point?.x ?? NaN) - extrude;
              const top = (point?.y ?? NaN) - extrude;
              const right = left + width + 2 * extrude;
              const bottom = top + height + 2 * extrude;
              expect(page.width).toBeLessThanOrEqual(maxSize);
              expect(page.height).toBeLessThanOrEqual(maxSize);
              expect(left).toBeGreaterThanOrEqual(0);
              expect(top).toBeGreaterThanOrEqual(0);
              expect(right).toBeLessThanOrEqual(page.width);
              expect(bottom).toBeLessThanOrEqual(page.height);
              return { bottom, key: item.value, left, pageIndex, right, top };
            });
          }),
        ) ?? [];
      expect(cells.map(({ key }) => key).sort()).toEqual(items.map(({ value }) => value).sort());
      for (const cell of cells) {
        expect(
          cells.filter(
            (other) =>
              other !== cell &&
              other.pageIndex === cell.pageIndex &&
              other.left < cell.right &&
              cell.left < other.right &&
              other.top < cell.bottom &&
              cell.top < other.bottom,
          ),
        ).toEqual([]);
      }
    },
  );

  it("rolls back a partial atomic item and retries all its rectangles on a new page", () => {
    const first = item("first", [4, 4]);
    const frames = item("frames", [2, 2], [4, 4]);
    expect(packAtlas(policy, [first, frames])?.pages).toEqual([
      { height: 6, placed: [{ at: [{ x: 1, y: 1 }], item: first }], width: 10 },
      {
        height: 6,
        placed: [
          {
            at: [
              { x: 1, y: 1 },
              { x: 5, y: 1 },
            ],
            item: frames,
          },
        ],
        width: 10,
      },
    ]);
  });

  it("uses the supplied comparator and preserves rectangle order and input", () => {
    const items = [item("b", [1, 2]), item("a", [2, 1])];
    const result = packAtlas(
      { ...policy, compare: (a, b) => a.value.localeCompare(b.value) },
      items,
    );
    expect(result?.pages[0]?.placed.map(({ at, item }) => [item.value, at])).toEqual([
      ["a", [{ x: 1, y: 1 }]],
      ["b", [{ x: 5, y: 1 }]],
    ]);
    expect(items.map(({ value }) => value)).toEqual(["b", "a"]);
  });

  it("prefers fewer pages before area, then smaller area, keeping first width on ties", () => {
    const items = [item("a", [2, 2]), item("b", [2, 2])];
    expect(
      packAtlas({ ...policy, maxSize: 8, widths: [4, 8] }, [...items, item("c", [2, 2])])?.width,
    ).toBe(8);
    expect(packAtlas({ ...policy, widths: [10, 8] }, items)?.width).toBe(8);
    expect(packAtlas({ ...policy, widths: [8, 4] }, items)?.width).toBe(8);
  });

  it("rejects an atomic item that cannot fit and returns no pages for no items", () => {
    expect(packAtlas(policy, [item("oversize", [9, 1])])).toBeUndefined();
    expect(packAtlas(policy, [item("too many", [8, 8], [8, 8])])).toBeUndefined();
    expect(packAtlas(policy, [])).toEqual({ pages: [], width: 10 });
  });
});
