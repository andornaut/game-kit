import { describe, expect, it } from "vitest";

import { arrangeActions } from "./actionGroup.ts";
import { arrangePager, PAGER_GAP, pagerItems, pagerSize, pagerState } from "./pager.ts";
import { BUTTON_GAP, STACK_BUTTON_GAP } from "./spacing.ts";

const sizes = {
  count: { height: 20, width: 41 },
  next: { height: 48, width: 70 },
  previous: { height: 48, width: 90 },
};

describe("pagerState", () => {
  it("makes each step available only where there is a page", () => {
    expect(pagerState(0, 3)).toEqual({ next: true, page: 0, pages: 3, previous: false });
    expect(pagerState(1, 3)).toEqual({ next: true, page: 1, pages: 3, previous: true });
    expect(pagerState(2, 3)).toEqual({ next: false, page: 2, pages: 3, previous: true });
    expect(pagerState(0, 1)).toEqual({ next: false, page: 0, pages: 1, previous: false });
  });

  it("refuses pages that are not whole or out of range", () => {
    expect(() => pagerState(0, 0)).toThrow(RangeError);
    expect(() => pagerState(3, 3)).toThrow(RangeError);
    expect(() => pagerState(-1, 3)).toThrow(RangeError);
    expect(() => pagerState(0.5, 3)).toThrow(RangeError);
  });
});

describe("arrangePager", () => {
  it("separates the count from each button by the one pager gap", () => {
    expect(PAGER_GAP.row).toBe(STACK_BUTTON_GAP);
    const result = arrangePager({ width: 300 }, sizes);
    expect(result.gap).toEqual(PAGER_GAP);
    // 90 + 8 + 41 + 8 + 70 = 217, centred in 300 with the odd unit right: 41 before.
    expect(result.previous.face).toEqual({ height: 48, width: 90, x: 41, y: 0 });
    expect(result.count).toEqual({ height: 20, width: 41, x: 139, y: 14 });
    expect(result.next.face).toEqual({ height: 48, width: 70, x: 188, y: 0 });
    expect(result.count.x - (result.previous.face.x + 90)).toBe(PAGER_GAP.row);
    expect(result.next.face.x - (result.count.x + 41)).toBe(PAGER_GAP.row);
  });

  it("clamps button press areas to half the gap toward the count", () => {
    const result = arrangePager({ width: 217 }, sizes);
    expect(result.previous.outset.right).toBe(4);
    expect(result.next.outset.left).toBe(4);
    expect(result.previous.press.x + result.previous.press.width).toBe(result.count.x - 4);
  });

  it("takes another gap token for both sides", () => {
    const result = arrangePager({ gap: "standard", width: 233 }, sizes);
    expect(result.count.x - (result.previous.face.x + 90)).toBe(BUTTON_GAP);
    expect(result.next.face.x - (result.count.x + 41)).toBe(BUTTON_GAP);
  });

  it("refuses a pager that does not fit in one row", () => {
    expect(() => arrangePager({ width: 216 }, sizes)).toThrow(RangeError);
  });

  it("sizes the pager as a footer's middle slot", () => {
    const middle = pagerSize(sizes);
    expect(middle).toEqual({ height: 48, width: 217 });
    const footer = arrangeActions({ middle, variant: "footer", width: 600 }, [
      { key: "back", role: "secondary", size: { height: 48, width: 80 } },
      { key: "done", role: "primary", size: { height: 48, width: 80 } },
    ]);
    expect(footer.middle).toEqual({ height: 48, width: 217, x: 191, y: 0 });
    const inside = arrangePager({ origin: footer.middle!, width: middle.width }, sizes);
    expect(inside.previous.face.x).toBe(191);
    expect(inside.next.face.x + 70).toBe(191 + 217);
  });

  it("is the action group arrangement of its three parts", () => {
    const direct = arrangeActions({ axis: "row", gap: PAGER_GAP, width: 300 }, pagerItems(sizes));
    const result = arrangePager({ width: 300 }, sizes);
    expect(direct.actions[0]).toEqual(result.previous);
    expect(direct.actions[2]).toEqual(result.next);
  });
});
