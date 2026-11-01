// The simulation steps at a fixed rate whatever the frame rate, so a seed and an input log
// replay a run exactly. Each frame banks the wall-clock time since the last frame and runs
// every whole step that fits, so a slow frame runs more steps and the walk keeps to real time.
// A frame longer than maxFrameMs banks only maxFrameMs: after a stall the walk does not lurch
// ahead, and a device too slow to run the steps cannot fall further and further behind.
// timeScale multiplies the time each frame banks (1 when absent): the dev panel's movement
// speed.
export interface FixedStepLimits {
  readonly maxFrameMs: number;
  readonly stepMs: number;
  readonly timeScale?: number;
}

// bankedMs is wall-clock time not yet stepped; lastTimeMs the last frame's timestamp, or null
// before the first frame.
export interface StepClock {
  readonly bankedMs: number;
  readonly lastTimeMs: number | null;
}

interface FrameSteps {
  readonly clock: StepClock;
  // Wall-clock time since the last frame, before the cap; 0 on the first frame.
  readonly frameMs: number;
  readonly steps: number;
}

// The game steps at 60 Hz.
export const STEP_SECONDS = 1 / 60;

// Fixed steps do not sum exactly to a tuned length (60 steps of 1/60 s fall short of 1 s by
// a rounding error), so a clock counting them reaches a length within this much of it.
export const SECONDS_EPSILON = 1e-6;

export const startStepClock: StepClock = { bankedMs: 0, lastTimeMs: null };

// timeMs is the frame's timestamp. It must come from the frame timestamps and not Phaser's
// delta: that is smoothed and clamped to one 60 FPS frame while the window is unfocused and for
// 120 frames after it regains focus or visibility, so a slow device would lose real time.
export function frameSteps(limits: FixedStepLimits, timeMs: number, clock: StepClock): FrameSteps {
  const frameMs = clock.lastTimeMs === null ? 0 : Math.max(0, timeMs - clock.lastTimeMs);
  const banked = clock.bankedMs + Math.min(limits.maxFrameMs, frameMs) * (limits.timeScale ?? 1);
  // A step is due within a rounding error of its length: 1000 / 60 does not sum exactly.
  const steps = Math.floor(banked / limits.stepMs + 1e-9);
  return {
    clock: { bankedMs: Math.max(0, banked - steps * limits.stepMs), lastTimeMs: timeMs },
    frameMs,
    steps,
  };
}

// Banked time is dropped while the walk is held, so it does not jump on when it goes again.
export function holdStepClock(clock: StepClock): StepClock {
  return { ...clock, bankedMs: 0 };
}
