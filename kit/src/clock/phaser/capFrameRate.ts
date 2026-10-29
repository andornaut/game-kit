import { Core, type Game } from "phaser";

import { type FrameGate, gateFrame, OPEN_GATE } from "../frameCap";

// Caps the frame rate at capFps whenever playing() is false. Phaser's loop calls its step on every
// display frame; this passes on only the frames gateFrame draws, each with the time of the frames
// it skipped, so animations, tweens and timers keep their speed. While playing() is true every
// frame draws. The loop takes its step when it starts, after the game's READY event, so the step
// is wrapped on the first frame and gated from the next.
export function capFrameRate(capFps: number, playing: () => boolean, game: Game): void {
  game.events.once(Core.Events.PRE_STEP, () => {
    const step = game.loop.callback;
    let gate: FrameGate = OPEN_GATE;
    game.loop.callback = (time, delta) => {
      const frame = gateFrame(playing() ? undefined : capFps, delta, gate);
      gate = frame.gate;
      if (frame.draw) {
        step(time, frame.elapsedMs);
      }
    };
  });
}
