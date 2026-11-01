import { describe, expect, it } from "vitest";

import { progressBarLayout, type ProgressBarStyle } from "./progress";

const style: ProgressBarStyle = {
  border: 1,
  fills: [0xffff00, 0xffaa00],
  frame: 0,
  track: 0x333333,
};
const frame = { height: 4, width: 102, x: 10, y: 20 };

describe("progressBarLayout", () => {
  it.each([
    [-1, 0],
    [0.339, 33],
    [1, 100],
    [2, 100],
  ])("clamps measured %s and covers only complete pixels", (value, width) => {
    const layout = progressBarLayout(style, frame, value);
    expect(layout.track).toEqual({ height: 2, width: 100, x: 11, y: 21 });
    expect(layout.fills).toEqual([
      { height: 1, width, x: 11, y: 21 },
      { height: 1, width, x: 11, y: 22 },
    ]);
  });

  it("marks unknown or nonfinite work with the same static centred segment", () => {
    const pending = progressBarLayout(style, frame, undefined);
    expect(pending.value).toBeUndefined();
    expect(pending.fills[0]).toEqual({ height: 1, width: 25, x: 48, y: 21 });
    expect(progressBarLayout(style, frame, NaN)).toEqual(pending);
  });

  it("keeps a narrow bar's track within its frame", () => {
    const layout = progressBarLayout(style, { height: 1, width: 1, x: 0, y: 0 }, 1);
    expect(layout.track).toEqual({ height: 0, width: 0, x: 0.5, y: 0.5 });
    expect(layout.fills.every(({ height, width }) => width === 0 && height === 0)).toBe(true);
  });
});
