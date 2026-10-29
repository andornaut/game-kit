import { describe, expect, it } from "vitest";

import {
  type FixedStepLimits,
  frameSteps,
  holdStepClock,
  startStepClock,
  type StepClock,
} from "./fixedStep";

const LIMITS = { maxFrameMs: 250, stepMs: 1000 / 60 };

// The steps run over frames at the given timestamps.
function stepsOver(timestamps: readonly number[], limits: FixedStepLimits = LIMITS): number {
  let clock: StepClock = startStepClock;
  let steps = 0;
  for (const time of timestamps) {
    const frame = frameSteps(limits, time, clock);
    clock = frame.clock;
    steps += frame.steps;
  }
  return steps;
}

const framesAt = (fps: number, seconds: number) =>
  Array.from({ length: fps * seconds + 1 }, (_, index) => (index * 1000) / fps);

describe("frameSteps", () => {
  it("runs no steps on the first frame, which has nothing to measure from", () => {
    expect(frameSteps(LIMITS, 5000, startStepClock)).toMatchObject({ frameMs: 0, steps: 0 });
  });

  it("keeps to 60 steps a second at any frame rate", () => {
    for (const fps of [60, 30, 20, 10, 5]) {
      expect(stepsOver(framesAt(fps, 10))).toBe(600);
    }
  });

  it("keeps to real time over uneven frames", () => {
    expect(stepsOver([0, 16, 50, 51, 140, 200, 333.4, 500, 750, 1000])).toBe(60);
  });

  it("banks at most maxFrameMs of a stall", () => {
    const frame = frameSteps(LIMITS, 10000, { bankedMs: 0, lastTimeMs: 0 });
    expect(frame).toMatchObject({ frameMs: 10000, steps: 15 });
    expect(frame.clock.bankedMs).toBeCloseTo(0);
  });

  it("runs time-scaled steps over a second at 60 FPS", () => {
    for (const [timeScale, expected] of [
      [0.5, 30],
      [1, 60],
      [3, 180],
    ] as const) {
      expect(stepsOver(framesAt(60, 1), { ...LIMITS, timeScale })).toBe(expected);
    }
  });

  it("carries what is left of a step into the next frame", () => {
    const frame = frameSteps(LIMITS, 25, { bankedMs: 0, lastTimeMs: 0 });
    expect(frame.steps).toBe(1);
    expect(frame.clock.bankedMs).toBeCloseTo(25 - 1000 / 60);
  });
});

describe("holdStepClock", () => {
  it("drops the banked time and keeps the last timestamp", () => {
    expect(holdStepClock({ bankedMs: 12, lastTimeMs: 400 })).toEqual({
      bankedMs: 0,
      lastTimeMs: 400,
    });
  });
});
