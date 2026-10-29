import { describe, expect, it } from "vitest";

import { clampInto } from "../rect";
import { pageToGame } from "./pagePoint";

// A 648x360 game drawn at 720x400 (10/9 scale) with 140 px bars either side.
const CANVAS = { height: 400, width: 720, x: 140, y: 0 };
const GAME = { height: 360, width: 648 };

describe("pageToGame", () => {
  it.each([
    ["the canvas's top-left", { x: 140, y: 0 }, { x: 0, y: 0 }],
    ["mid-canvas", { x: 500, y: 200 }, { x: 324, y: 180 }],
    ["the left bar", { x: 50, y: 200 }, { x: -81, y: 180 }],
    ["the right bar", { x: 950, y: 300 }, { x: 729, y: 270 }],
    ["above the canvas", { x: 500, y: -30 }, { x: 324, y: -27 }],
  ])("maps %s without clamping", (_, client, game) => {
    expect(pageToGame(CANVAS, GAME, client)).toEqual(game);
  });

  it.each([
    ["the left bar", { x: 20, y: 200 }, { x: 0, y: 180 }],
    ["the right bar", { x: 990, y: 300 }, { x: 647, y: 270 }],
    ["below the canvas", { x: 500, y: 430 }, { x: 324, y: 359 }],
    ["a corner beyond both edges", { x: 1000, y: 500 }, { x: 647, y: 359 }],
  ])("maps %s onto the game's nearest pixel through clampInto", (_, client, game) => {
    expect(clampInto({ ...GAME, x: 0, y: 0 }, pageToGame(CANVAS, GAME, client))).toEqual(game);
  });
});
