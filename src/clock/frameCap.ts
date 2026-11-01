// A frame rate cap for when the game is not in play (phaser/capFrameRate). Menus draw at most
// about MENU_FPS frames a second, so a 120 Hz or faster phone does half or less of the work its
// refresh rate would ask for. 60 is the
// rate a 60 Hz phone draws everything at, so a capped menu looks as it does there; 30 would show
// each 60 ms frame of a tap burst for 33 or 67 ms, step a 140 ms press dip in 4 frames, and add
// up to 33 ms to a dragged list.
export const MENU_FPS = 60;

// The display frames each drawn frame lasts, to draw at about capFps on a display whose frames
// last frameMs: 1 at 60, 75 and 90 Hz, 2 at 120 and 144 Hz, 3 at 165 Hz and 4 at 240 Hz. The
// count steps up 0.6 of a frame past each whole number of display frames per capped frame (96,
// 156 and 216 Hz for a cap of 60), at least 5% from each of those refresh rates, so frame time
// jitter never flips it and the drawn frames stay evenly spaced.
export function framesPerDraw(capFps: number, frameMs: number): number {
  return Math.max(1, Math.round(1000 / capFps / frameMs - 0.1));
}

// The display frames skipped since the last drawn one, and their time.
export interface FrameGate {
  readonly skipped: number;
  readonly skippedMs: number;
}

export const OPEN_GATE: FrameGate = { skipped: 0, skippedMs: 0 };

// Whether a display frame lasting frameMs draws, under a cap of capFps (undefined for none), and
// the time the drawn frame advances by: its own and that of the frames skipped before it, so
// animations keep their speed.
export function gateFrame(
  capFps: number | undefined,
  frameMs: number,
  gate: FrameGate,
): { draw: boolean; elapsedMs: number; gate: FrameGate } {
  const frames = gate.skipped + 1;
  const elapsedMs = gate.skippedMs + frameMs;
  const draw = capFps === undefined || frames >= framesPerDraw(capFps, frameMs);
  return { draw, elapsedMs, gate: draw ? OPEN_GATE : { skipped: frames, skippedMs: elapsedMs } };
}
