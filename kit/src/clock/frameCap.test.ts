import { describe, expect, it } from "vitest";

import { type FrameGate, framesPerDraw, gateFrame, MENU_FPS, OPEN_GATE } from "./frameCap";

const hz = (rate: number) => 1000 / rate;

// Which of count display frames lasting frameMs draw under capFps, and each drawn frame's time.
function run(capFps: number | undefined, frameMs: number, count: number) {
  let gate: FrameGate = OPEN_GATE;
  const drawn: number[] = [];
  for (let i = 0; i < count; i++) {
    const frame = gateFrame(capFps, frameMs, gate);
    gate = frame.gate;
    if (frame.draw) {
      drawn.push(Math.round(frame.elapsedMs * 10) / 10);
    }
  }
  return drawn;
}

describe("framesPerDraw", () => {
  it.each([
    [60, 1],
    [75, 1],
    [90, 1],
    [120, 2],
    [144, 2],
    [165, 3],
    [240, 4],
  ])("draws a %i Hz display's every %i frames under a cap of 60", (rate, frames) => {
    expect(framesPerDraw(MENU_FPS, hz(rate))).toBe(frames);
    expect(framesPerDraw(MENU_FPS, hz(rate) * 0.98)).toBe(frames);
    expect(framesPerDraw(MENU_FPS, hz(rate) * 1.02)).toBe(frames);
  });

  it("never skips on a display slower than the cap", () => {
    expect(framesPerDraw(MENU_FPS, hz(30))).toBe(1);
  });
});

describe("gateFrame", () => {
  it.each([
    ["a 120 Hz display under the cap", MENU_FPS, 120, [16.7, 16.7, 16.7]],
    ["a 165 Hz display under the cap", MENU_FPS, 165, [18.2, 18.2]],
    ["a 60 Hz display under the cap", MENU_FPS, 60, [16.7, 16.7, 16.7, 16.7, 16.7, 16.7]],
    ["a 120 Hz display with no cap", undefined, 120, [8.3, 8.3, 8.3, 8.3, 8.3, 8.3]],
  ])("draws %s evenly, passing on the skipped time", (_, capFps, rate, drawn) => {
    expect(run(capFps, hz(rate), 6)).toEqual(drawn);
  });

  it("draws at once with the skipped time when the cap lifts", () => {
    const skipped = gateFrame(MENU_FPS, hz(120), OPEN_GATE);
    expect(skipped.draw).toBe(false);
    const lifted = gateFrame(undefined, hz(120), skipped.gate);
    expect(lifted).toEqual({ draw: true, elapsedMs: 2 * hz(120), gate: OPEN_GATE });
  });
});
