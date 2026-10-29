import { Core, type Game, Scale } from "phaser";

import { integerZoom } from "../integerZoom";

// Keeps the canvas at the integer zoom for size (the game's size in game pixels), its parent's
// size and the screen's pixel ratio. Phaser measures the parent and emits a resize on each
// change, a change of pixel ratio included, since that resizes the window. The game's scale
// config sets mode Scale.NONE, so the zoom set here is the only one, and autoCenter to centre
// the canvas in its parent.
export function fitWholePixels(
  size: { readonly height: number; readonly width: number },
  game: Game,
): void {
  const fit = () => {
    const { height, width } = game.scale.parentSize;
    if (width <= 0 || height <= 0) {
      return;
    }
    const zoom = integerZoom(size, window.devicePixelRatio || 1, { height, width });
    if (zoom !== game.scale.zoom) {
      game.scale.setZoom(zoom);
    }
  };
  game.scale.on(Scale.Events.RESIZE, fit);
  game.events.once(Core.Events.READY, fit);
}
