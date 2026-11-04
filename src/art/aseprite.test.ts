import { describe, expect, it } from "vitest";

import {
  animationKey,
  animationSpecs,
  type AsepriteDirection,
  type AsepriteSheet,
  sheetTags,
  tagMs,
  tagRepeat,
} from "./aseprite.ts";

const tag = (name: string, from: number, to: number, direction: AsepriteDirection = "forward") => ({
  direction,
  from,
  name,
  to,
});

const SHEET: AsepriteSheet = {
  frames: {
    "s 0.aseprite": { duration: 400 },
    "s 1.aseprite": { duration: 130 },
    "s 2.aseprite": { duration: 80 },
    "s 3.aseprite": { duration: 60 },
  },
  meta: { frameTags: [tag("rest", 0, 0), tag("press", 1, 2)] },
};

// The frame named "s <index>.aseprite" in SHEET, with its duration.
const frame = (index: number) => {
  const name = `s ${index}.aseprite`;
  return { duration: SHEET.frames[name]?.duration, frame: name };
};

describe("sheetTags", () => {
  it.each<[AsepriteDirection, number[]]>([
    ["forward", [0, 1, 2, 3]],
    ["reverse", [3, 2, 1, 0]],
    ["pingpong", [0, 1, 2, 3, 2, 1]],
    ["pingpong_reverse", [3, 2, 1, 0, 1, 2]],
  ])("plays a %s tag in Aseprite's order", (direction, order) => {
    const sheet = { ...SHEET, meta: { frameTags: [tag("walk", 0, 3, direction)] } };
    expect(sheetTags(sheet).get("walk")).toEqual(order.map(frame));
  });

  it("has no tags for a sheet without frameTags", () => {
    expect(sheetTags({ frames: SHEET.frames, meta: {} }).size).toBe(0);
  });

  it.each([
    ["a frame past the export's", tag("walk", 2, 4)],
    ["a direction Aseprite has not", { ...tag("walk", 0, 1), direction: "sideways" }],
  ])("refuses a tag naming %s", (_, bad) => {
    const sheet = { ...SHEET, meta: { frameTags: [bad as ReturnType<typeof tag>] } };
    expect(() => sheetTags(sheet)).toThrow("walk");
  });
});

describe("animationSpecs", () => {
  it("keys each tag's frames by its texture and tag", () => {
    expect(animationSpecs("ui-touch-jump", SHEET)).toEqual([
      { frames: [frame(0)], key: animationKey("ui-touch-jump", "rest") },
      { frames: [frame(1), frame(2)], key: animationKey("ui-touch-jump", "press") },
    ]);
  });
});

describe("tagMs", () => {
  it("plays a tag for its frames' durations", () => {
    expect(tagMs(sheetTags(SHEET), "press")).toBe(130 + 80);
  });

  it("refuses a missing tag", () => {
    expect(() => tagMs(sheetTags(SHEET), "held")).toThrow("held");
  });
});

describe("tagRepeat", () => {
  it.each([
    [["jump", "land"], "jump", 0],
    [["jump", "land"], "land", 0],
    [["jump", "land"], "walk", -1],
  ])("with %j played once, repeats %s %i times", (once, name, repeat) => {
    expect(tagRepeat(once, name)).toBe(repeat);
  });
});

describe("animationKey", () => {
  it("keeps one sprite's tag apart from another's, and one sprite's tags apart", () => {
    const keys = [
      animationKey("ui-touch-jump", "rest"),
      animationKey("ui-touch-move", "rest"),
      animationKey("ui-touch-jump", "press"),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });
});
