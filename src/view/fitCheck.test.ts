import { describe, expect, it } from "vitest";

import { FIT_TOLERANCE, needsRefit } from "./fitCheck";

// A landscape phone's visible area, a canvas fitted inside it, and the play area the fit used.
const VISIBLE = { height: 390, width: 844, x: 0, y: 0 };
const CANVAS = { height: 390, width: 780, x: 64, y: 0 };
const PLAY_AREA = { height: 390, width: 780 };
const past = FIT_TOLERANCE + 1;

describe("needsRefit", () => {
  it.each<[string, typeof CANVAS, typeof PLAY_AREA, boolean]>([
    ["a canvas inside the visible area", CANVAS, PLAY_AREA, false],
    ["a canvas within the tolerance of its edges", { ...CANVAS, width: 781 }, PLAY_AREA, false],
    ["a canvas past the bottom", { ...CANVAS, height: 390 + past }, PLAY_AREA, true],
    ["a canvas past the right", { ...CANVAS, width: 780 + past }, PLAY_AREA, true],
    ["a canvas past the top", { ...CANVAS, y: -past }, PLAY_AREA, true],
    ["a canvas past the left", { ...CANVAS, x: -past }, PLAY_AREA, true],
    ["a play area grown since the fit", CANVAS, { height: 390, width: 780 + past }, true],
    ["a play area shrunk since the fit", CANVAS, { height: 390 - past, width: 780 }, true],
    ["a play area within the tolerance", CANVAS, { height: 390.6, width: 780.4 }, false],
  ])("refits for %s: %s", (_, canvas, playArea, refit) => {
    expect(needsRefit(VISIBLE, canvas, playArea, PLAY_AREA)).toBe(refit);
  });
});
