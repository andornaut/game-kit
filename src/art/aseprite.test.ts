import { describe, expect, it } from "vitest";

import {
  animationKey,
  animationSpecs,
  type AsepriteDirection,
  type AsepriteSheet,
  sheetTags,
  tagMs,
  tagRepeat,
} from "./aseprite";

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
  it.each([
    ["rest", [frame(0)]],
    ["press", [frame(1), frame(2)]],
  ])("gives %s its frames in order", (name, frames) => {
    expect(sheetTags(SHEET).get(name)).toEqual(frames);
  });

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
  it.each([
    ["rest", [0]],
    ["press", [1, 2]],
  ])("plays %s for its frames' durations", (name, indexes) => {
    const total = indexes.reduce((sum, index) => sum + (frame(index).duration ?? 0), 0);
    expect(tagMs(sheetTags(SHEET), name)).toBe(total);
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
    [[], "rest", -1],
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
