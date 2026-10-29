import { describe, expect, it } from "vitest";

import { type CanvasPlacement, centresVertically } from "./canvasPlacement";

describe("centresVertically", () => {
  it.each([
    ["centre", "a portrait phone", { height: 800, width: 360 }, true],
    ["centre", "a landscape screen", { height: 768, width: 1366 }, true],
    ["topInPortrait", "a portrait phone", { height: 800, width: 360 }, false],
    ["topInPortrait", "a tall portrait phone", { height: 915, width: 412 }, false],
    ["topInPortrait", "a phone on its side", { height: 360, width: 800 }, true],
    ["topInPortrait", "a landscape screen", { height: 768, width: 1366 }, true],
    ["topInPortrait", "a square viewport", { height: 600, width: 600 }, true],
  ] satisfies readonly [CanvasPlacement, string, { height: number; width: number }, boolean][])(
    "%s, %s: %s",
    (placement, _viewport, size, expected) => {
      expect(centresVertically(placement, size)).toBe(expected);
    },
  );
});
