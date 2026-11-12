import { describe, expect, it } from "vitest";

import { createFileShare } from "./fileShare.ts";

describe("createFileShare", () => {
  it("is settled files over the total while the total stays put", () => {
    const share = createFileShare();
    expect([share(0, 4), share(1, 4), share(3, 4), share(4, 4)]).toEqual([0, 0.25, 0.75, 1]);
  });

  it("keeps its share when the total grows and fills the rest by the files settled since", () => {
    const share = createFileShare();
    expect(share(2, 4)).toBe(0.5);
    // Four more files: Phaser's own fraction would fall to 2 / 8.
    expect(share(2, 8)).toBe(0.5);
    expect(share(5, 8)).toBe(0.75);
    expect(share(8, 8)).toBe(1);
  });

  it("re-bases again on each growth and never moves backward", () => {
    const share = createFileShare();
    const shown = [share(0, 2), share(1, 2), share(1, 3), share(2, 3), share(2, 6), share(6, 6)];
    expect(shown).toEqual([0, 0.5, 0.5, 0.75, 0.75, 1]);
    expect(shown.every((value, index) => index === 0 || value >= (shown[index - 1] ?? 0))).toBe(
      true,
    );
  });

  it("sets no base from the first total, even with files already settled", () => {
    expect(createFileShare()(3, 4)).toBe(0.75);
  });

  it("clamps more settled files than the total to 1", () => {
    expect(createFileShare()(5, 4)).toBe(1);
  });

  it("keeps the share shown so far for a zero total or an invalid count", () => {
    const share = createFileShare();
    expect(share(0, 0)).toBe(0);
    expect(share(1, 2)).toBe(0.5);
    expect([share(Number.NaN, 2), share(1, Number.POSITIVE_INFINITY), share(-1, 2)]).toEqual([
      0.5, 0.5, 0.5,
    ]);
    expect(share(0, 0)).toBe(0.5);
  });
});
