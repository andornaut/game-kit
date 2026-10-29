import { describe, expect, it } from "vitest";

import { probability } from "./units";

describe("units", () => {
  it("rejects a probability outside 0 to 1", () => {
    expect(() => probability(1.5)).toThrow(RangeError);
    expect(() => probability(-0.1)).toThrow(RangeError);
    expect(probability(0.25)).toBe(0.25);
  });
});
