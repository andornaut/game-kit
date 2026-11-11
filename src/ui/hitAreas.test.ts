import { describe, expect, it } from "vitest";

import type { Rect } from "../rect.ts";
import { hitAround, hitMargin, type HitRule, type PressArea, pressedArea } from "./hitAreas.ts";

const RULE: HitRule = { leastMargin: 6, marginShare: 0.25, minTarget: 48, mostMargin: 16 };

const square = (side: number) => ({ height: side, width: side, x: 100, y: 100 });

describe("hitMargin", () => {
  it.each([
    ["a share of a mid-sized control's shorter side", { height: 40, width: 200, x: 0, y: 0 }, 10],
    ["no less than the least margin", square(16), RULE.leastMargin],
    ["no more than the most margin", square(200), RULE.mostMargin],
  ])("is %s", (_, art, margin) => {
    expect(hitMargin(RULE, art)).toBe(margin);
  });
});

describe("hitAround", () => {
  it.each<[string, Rect, { height: number; width: number }]>([
    ["a 35 px disc by its margin", square(35), { height: 52.5, width: 52.5 }],
    ["a 16 px icon to the least size", square(16), { height: 48, width: 48 }],
    ["a wide button by its margin on both axes", square(48), { height: 72, width: 72 }],
  ])("grows %s", (_, art, size) => {
    const hit = hitAround(RULE, art);
    expect({ height: hit.height, width: hit.width }).toEqual(size);
  });

  it("grows a small control evenly about its centre", () => {
    const hit = hitAround(RULE, square(16));
    expect({ x: hit.x + hit.width / 2, y: hit.y + hit.height / 2 }).toEqual({ x: 108, y: 108 });
  });
});

describe("pressedArea", () => {
  // Two 40 px tall buttons side by side, each grown by 10, overlapping by 20.
  const button = (key: string, art: Rect): PressArea<string> => ({
    art,
    hit: hitAround(RULE, art),
    key,
  });
  const LEFT = button("left", { height: 40, width: 50, x: 0, y: 0 });
  const RIGHT = button("right", { height: 40, width: 50, x: 50, y: 0 });
  it.each([
    ["just inside the left margin", { x: -10, y: 20 }, "left"],
    ["just outside the left margin", { x: -11, y: 20 }, undefined],
    ["just inside the bottom margin", { x: 25, y: 49 }, "left"],
    ["just outside the bottom margin", { x: 25, y: 50 }, undefined],
    ["in the overlap, nearer the left button", { x: 49, y: 20 }, "left"],
    ["in the overlap, nearer the right button", { x: 51, y: 20 }, "right"],
  ])("takes a press %s as %s", (_, point, key) => {
    expect(pressedArea([LEFT, RIGHT], point)).toBe(key);
  });

  it("takes a press in any part of a union", () => {
    const art = { height: 10, width: 10, x: 0, y: 0 };
    const area = { art, hit: [art, { height: 10, width: 10, x: 100, y: 100 }], key: "union" };
    expect([
      pressedArea([area], { x: 105, y: 105 }),
      pressedArea([area], { x: 50, y: 50 }),
    ]).toEqual(["union", undefined]);
  });
});

describe("a circle cut away from a point", () => {
  // Circles of radius 100 about centres 100 apart, each cut toward the other.
  const a = { x: 0, y: 0 };
  const b = { x: 100, y: 0 };
  const art = { height: 1, width: 1, x: 0, y: 0 };
  const areas = [
    { art, hit: { awayFrom: b, centre: a, radius: 100 }, key: "a" },
    { art: { ...art, x: 100 }, hit: { awayFrom: a, centre: b, radius: 100 }, key: "b" },
  ];
  it.each<[string, { x: number; y: number }, string | undefined]>([
    ["just short of the midline, on a's side", { x: 49.9, y: 0 }, "a"],
    ["just past the midline, on b's side", { x: 50.1, y: 0 }, "b"],
    ["on the midline, nearer neither", { x: 50, y: 0 }, undefined],
    ["outside both radii", { x: 50, y: 90 }, undefined],
  ])("takes a press %s as %s", (_, point, key) => {
    expect(pressedArea(areas, point)).toBe(key);
  });
});
