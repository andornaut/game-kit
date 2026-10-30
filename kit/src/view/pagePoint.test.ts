import { describe, expect, it } from "vitest";

import { clampInto, type Point } from "../rect";
import { type FrameTurn, pageToGame } from "./pagePoint";

// A 648x360 game drawn at 720x400 (10/9 scale) with 140 px bars either side, unturned; turned,
// the same canvas on its side, its box 400 wide and 720 tall with 140 px bars above and below, so
// the game's top-left is the box's top-right turned by 90 and its bottom-left turned by -90.
const GAME = { height: 360, width: 648 };
const CANVAS: Record<FrameTurn, { height: number; width: number; x: number; y: number }> = {
  0: { height: 400, width: 720, x: 140, y: 0 },
  90: { height: 720, width: 400, x: 0, y: 140 },
  [-90]: { height: 720, width: 400, x: 0, y: 140 },
};

describe("pageToGame", () => {
  it.each<[string, FrameTurn, Point, Point]>([
    ["the canvas's top-left", 0, { x: 140, y: 0 }, { x: 0, y: 0 }],
    ["mid-canvas", 0, { x: 500, y: 200 }, { x: 324, y: 180 }],
    ["the left bar", 0, { x: 50, y: 200 }, { x: -81, y: 180 }],
    ["the right bar", 0, { x: 950, y: 300 }, { x: 729, y: 270 }],
    ["above the canvas", 0, { x: 500, y: -30 }, { x: 324, y: -27 }],
    ["the game's top-left", 90, { x: 400, y: 140 }, { x: 0, y: 0 }],
    ["mid-canvas", 90, { x: 200, y: 500 }, { x: 324, y: 180 }],
    ["the bar above the game's left edge", 90, { x: 200, y: 50 }, { x: -81, y: 180 }],
    ["the bar below the game's right edge", 90, { x: 100, y: 950 }, { x: 729, y: 270 }],
    ["right of the canvas", 90, { x: 430, y: 500 }, { x: 324, y: -27 }],
    ["the game's top-left", -90, { x: 0, y: 860 }, { x: 0, y: 0 }],
    ["mid-canvas", -90, { x: 200, y: 500 }, { x: 324, y: 180 }],
    ["the bar below the game's left edge", -90, { x: 200, y: 950 }, { x: -81, y: 180 }],
    ["the bar above the game's right edge", -90, { x: 300, y: 50 }, { x: 729, y: 270 }],
    ["left of the canvas", -90, { x: -30, y: 500 }, { x: 324, y: -27 }],
  ])("maps %s, turned %i, without clamping", (_, turn, client, game) => {
    expect(pageToGame(turn, CANVAS[turn], GAME, client)).toEqual(game);
  });

  it.each<[string, FrameTurn, Point, Point]>([
    ["the left bar", 0, { x: 20, y: 200 }, { x: 0, y: 180 }],
    ["the right bar", 0, { x: 990, y: 300 }, { x: 647, y: 270 }],
    ["below the canvas", 0, { x: 500, y: 430 }, { x: 324, y: 359 }],
    ["a corner beyond both edges", 0, { x: 1000, y: 500 }, { x: 647, y: 359 }],
    ["the game's bottom-right", 90, { x: 0, y: 860 }, { x: 647, y: 359 }],
    ["the bar above the game's left edge", 90, { x: 200, y: 20 }, { x: 0, y: 180 }],
    ["the bar below the game's right edge", 90, { x: 100, y: 990 }, { x: 647, y: 270 }],
    ["the game's bottom-right", -90, { x: 400, y: 140 }, { x: 647, y: 359 }],
    ["the bar below the game's left edge", -90, { x: 200, y: 990 }, { x: 0, y: 180 }],
    ["the bar above the game's right edge", -90, { x: 300, y: 20 }, { x: 647, y: 270 }],
  ])(
    "maps %s, turned %i, onto the game's nearest pixel through clampInto",
    (_, turn, client, game) => {
      const point = pageToGame(turn, CANVAS[turn], GAME, client);
      expect(clampInto({ ...GAME, x: 0, y: 0 }, point)).toEqual(game);
    },
  );
});
