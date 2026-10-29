import { describe, expect, it } from "vitest";

import { integerZoom } from "./integerZoom";

// A portrait game. Each space below is measured in game sizes, so any size gives the same zooms.
const GAME = { height: 560, width: 360 };
// A space this many game sizes across and down, in CSS pixels.
const games = (across: number, down: number) => ({
  height: GAME.height * down,
  width: GAME.width * across,
});

describe("integerZoom", () => {
  it("gives each game pixel a whole number of device pixels that fits the space", () => {
    for (const row of [
      { devicePixels: 1, name: "exactly one game", pixelRatio: 1, space: games(1, 1) },
      { devicePixels: 1, name: "just short of two", pixelRatio: 1, space: games(1.99, 3) },
      { devicePixels: 2, name: "two games by height", pixelRatio: 1, space: games(3, 2.5) },
      { devicePixels: 3, name: "a phone at ratio 3", pixelRatio: 3, space: games(1.08, 1.2) },
      {
        devicePixels: 3,
        name: "a phone at ratio 2.625",
        pixelRatio: 2.625,
        space: games(1.15, 1.3),
      },
      { devicePixels: 2, name: "a phone at ratio 2", pixelRatio: 2, space: games(1.08, 1.2) },
    ]) {
      const zoom = integerZoom(GAME, row.pixelRatio, row.space);
      expect(zoom * row.pixelRatio).toBeCloseTo(row.devicePixels);
      expect(GAME.width * zoom).toBeLessThanOrEqual(row.space.width);
      expect(GAME.height * zoom).toBeLessThanOrEqual(row.space.height);
    }
  });

  it("fits a space too small for one device pixel per game pixel", () => {
    const space = games(0.5, 0.8);
    expect(integerZoom(GAME, 1, space)).toBe(0.5);
  });
});
