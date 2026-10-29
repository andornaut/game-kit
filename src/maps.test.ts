import { describe, expect, it } from "vitest";

import { getOrInsertComputed } from "./maps";

describe("getOrInsertComputed", () => {
  it("makes a key's value once and returns the stored one after", () => {
    const store = new Map<string, number[]>();
    let made = 0;
    const make = () => {
      made += 1;
      return [made];
    };
    const first = getOrInsertComputed("a", make, store);
    expect(getOrInsertComputed("a", make, store)).toBe(first);
    expect(getOrInsertComputed("b", make, store)).toEqual([2]);
    expect(made).toBe(2);
  });
});
