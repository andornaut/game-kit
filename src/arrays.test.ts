import { describe, expect, it } from "vitest";

import { partitionPoint } from "./arrays";

describe("partitionPoint", () => {
  it.each([
    { below: 0, index: 0, items: [] },
    { below: 1, index: 0, items: [1, 2, 3] },
    { below: 2, index: 1, items: [1, 2, 2, 3] },
    { below: 3, index: 3, items: [1, 2, 2, 3] },
    { below: 9, index: 4, items: [1, 2, 2, 3] },
  ])("finds the first of $items not below $below at $index", ({ below, index, items }) => {
    expect(partitionPoint((item) => item < below, items)).toBe(index);
  });
});
