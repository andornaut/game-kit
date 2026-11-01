import { type Scene, Scenes } from "phaser";

import { guardPassed } from "../tapGuard";

// Turns the scene's pointer and keyboard input off until guardMs has passed since the frame
// drawn() is called on, its first drawn frame (tapGuard). A press that lands during the guard
// does nothing, its release after the guard included, so a hold can start only after it. Call
// drawn() from the scene's first render. Times are the scene's update times, which its clock
// also reads, so the guard needs no Time plugin and a build may leave Phaser's Time out.
export function guardSceneInput(guardMs: number, scene: Scene): { drawn: () => void } {
  const { input } = scene;
  const setEnabled = (enabled: boolean) => {
    input.enabled = enabled;
    if (input.keyboard !== null) {
      input.keyboard.enabled = enabled;
    }
  };
  setEnabled(false);
  let drawnMs: number | null = null;
  // The latest update's time, and whether drawn() came before any update, to take the next's.
  let updateMs: number | undefined;
  let drawnBeforeUpdate = false;
  const check = (time: number) => {
    updateMs = time;
    if (drawnBeforeUpdate) {
      drawnBeforeUpdate = false;
      drawnMs = time;
    }
    if (guardPassed(guardMs, drawnMs, time)) {
      setEnabled(true);
      scene.events.off(Scenes.Events.UPDATE, check);
    }
  };
  scene.events.on(Scenes.Events.UPDATE, check);
  scene.events.once(Scenes.Events.SHUTDOWN, () => scene.events.off(Scenes.Events.UPDATE, check));
  return {
    drawn: () => {
      if (updateMs === undefined) {
        drawnBeforeUpdate = true;
      } else {
        drawnMs = updateMs;
      }
    },
  };
}
