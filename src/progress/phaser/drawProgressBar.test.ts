import { expect, it } from "vitest";

import { drawProgressBar, drawProgressDisplay } from "./drawProgressBar.ts";

const recorder = () => {
  const drawn: unknown[] = [];
  const graphics = {
    fillRect: (...rect: number[]) => drawn.push(rect),
    fillStyle: (colour: number, alpha: number) => drawn.push([colour, alpha]),
  } as unknown as Parameters<typeof drawProgressBar>[0];
  return { drawn, graphics };
};
const style = { border: 1, fills: [3, 4], frame: 1, track: 2 };
const frame = { height: 4, width: 12, x: 5, y: 6 };
const motion = { cycleMs: 1000, segment: 0.5 };

it("draws the border, track and ordered fill bands without clearing other graphics", () => {
  const { drawn, graphics } = recorder();
  drawProgressBar(graphics, style, frame, 0.5);
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

it("draws the indeterminate segment at the caller's elapsed time", () => {
  const { drawn, graphics } = recorder();
  drawProgressDisplay(graphics, style, motion, frame, { elapsedMs: 500, kind: "indeterminate" });
  expect(drawn.slice(4)).toEqual([
    [3, 1],
    [8, 7, 5, 1],
    [4, 1],
    [8, 8, 5, 1],
  ]);
});

it("draws nothing while hidden and a measured display as drawProgressBar does", () => {
  const hidden = recorder();
  drawProgressDisplay(hidden.graphics, style, motion, frame, { kind: "hidden" });
  expect(hidden.drawn).toEqual([]);
  const display = recorder();
  const bar = recorder();
  drawProgressDisplay(display.graphics, style, motion, frame, { kind: "measured", value: 0.5 });
  drawProgressBar(bar.graphics, style, frame, 0.5);
  expect(display.drawn).toEqual(bar.drawn);
});

it("draws the frame and track at their alphas, the fills opaque, and skips a transparent frame", () => {
  const { drawn, graphics } = recorder();
  drawProgressBar(graphics, { ...style, frameAlpha: 0, trackAlpha: 0.6 }, frame, 0.5);
  expect(drawn).toEqual([
    [2, 0.6],
    [6, 7, 10, 2],
    [3, 1],
    [6, 7, 5, 1],
    [4, 1],
    [6, 8, 5, 1],
  ]);
});

it("multiplies a fading display's opacity into every alpha", () => {
  const { drawn, graphics } = recorder();
  drawProgressDisplay(graphics, { ...style, trackAlpha: 0.6 }, motion, frame, {
    kind: "measured",
    opacity: 0.5,
    value: 1,
  });
  expect(drawn.filter((_, index) => index % 2 === 0)).toEqual([
    [1, 0.5],
    [2, 0.3],
    [3, 0.5],
    [4, 0.5],
  ]);
});

it("draws nothing at opacity zero", () => {
  const { drawn, graphics } = recorder();
  drawProgressDisplay(graphics, style, motion, frame, { kind: "measured", opacity: 0, value: 1 });
  expect(drawn).toEqual([]);
});

it("rejects an alpha outside [0, 1], even while hidden", () => {
  const { graphics } = recorder();
  expect(() => drawProgressBar(graphics, { ...style, frameAlpha: 2 }, frame, 0.5)).toThrow(
    RangeError,
  );
  expect(() =>
    drawProgressDisplay(graphics, { ...style, trackAlpha: NaN }, motion, frame, {
      kind: "hidden",
    }),
  ).toThrow(RangeError);
});
