import { type Scene, Scenes } from "phaser";

import { guardPassed } from "../tapGuard";

// Turns the scene's pointer and keyboard input off until guardMs has passed since the frame
// drawn() is called on, its first drawn frame (tapGuard). A press that lands during the guard
// does nothing, its release after the guard included, so a hold can start only after it. Call
// drawn() from the scene's first render.
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
  const check = () => {
    if (guardPassed(guardMs, drawnMs, scene.time.now)) {
      setEnabled(true);
      scene.events.off(Scenes.Events.UPDATE, check);
    }
  };
  scene.events.on(Scenes.Events.UPDATE, check);
  scene.events.once(Scenes.Events.SHUTDOWN, () => scene.events.off(Scenes.Events.UPDATE, check));
  return {
    drawn: () => {
      drawnMs = scene.time.now;
    },
  };
}
