import { describe, expect, it } from "vitest";

import { mapLimit } from "./mapLimit.ts";

// Resolves on a later macrotask, so calls overlap while they wait.
const tick = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

describe("mapLimit", () => {
  it.each([
    { count: 0, limit: 1 },
    { count: 1, limit: 4 },
    { count: 5, limit: 1 },
    { count: 50, limit: 3 },
    { count: 7, limit: 100 },
  ])("runs at most $limit of $count calls at once, in item order", async ({ count, limit }) => {
    let running = 0;
    let peak = 0;
    const items = Array.from({ length: count }, (_, index) => index);
    const results = await mapLimit(
      limit,
      async (item, index) => {
        running += 1;
        peak = Math.max(peak, running);
        // Later items finish first, so the result order cannot come from completion order.
        for (let wait = count - item; wait > 0; wait -= 1) {
          // eslint-disable-next-line no-await-in-loop
          await tick();
        }
        running -= 1;
        return `${item}:${index}`;
      },
      items,
    );
    expect(peak).toBe(Math.min(limit, count));
    expect(results).toEqual(items.map((item) => `${item}:${item}`));
  });

  it("rejects with the first failure and starts no further calls", async () => {
    const started: number[] = [];
    const result = mapLimit(
      2,
      async (item) => {
        started.push(item);
        await tick();
        if (item === 1) {
          throw new Error("item 1 failed");
        }
        return item;
      },
      [0, 1, 2, 3, 4, 5],
    );
    await expect(result).rejects.toThrow("item 1 failed");
    expect(started).toEqual([0, 1, 2]);
  });

  it.each([0, -1, 1.5, Number.NaN])("refuses a limit of %s", async (limit) => {
    await expect(mapLimit(limit, async (item) => item, [1])).rejects.toThrow(RangeError);
  });
});
