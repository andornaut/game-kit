import { describe, expect, it } from "vitest";

import { clamp01 } from "./numbers";

describe("clamp01", () => {
  it.each([
    { held: 0, value: -0.5 },
    { held: 0.25, value: 0.25 },
    { held: 1, value: 3 },
  ])("holds $value at $held", ({ held, value }) => {
    expect(clamp01(value)).toBe(held);
  });
});
