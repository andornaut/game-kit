import { expect, it } from "vitest";

import { drawProgressBar } from "./drawProgressBar.ts";

it("draws the border, track and ordered fill bands without clearing other graphics", () => {
  const drawn: unknown[] = [];
  const graphics = {
    fillRect: (...rect: number[]) => drawn.push(rect),
    fillStyle: (colour: number, alpha: number) => drawn.push([colour, alpha]),
  } as unknown as Parameters<typeof drawProgressBar>[0];
  drawProgressBar(
    graphics,
    { border: 1, fills: [3, 4], frame: 1, track: 2 },
    { height: 4, width: 12, x: 5, y: 6 },
    0.5,
  );
  expect(drawn).toEqual([
    [1, 1],
    [5, 6, 12, 4],
    [2, 1],
    [6, 7, 10, 2],
    [3, 1],
    [6, 7, 5, 1],
    [4, 1],
    [6, 8, 5, 1],
  ]);
});
