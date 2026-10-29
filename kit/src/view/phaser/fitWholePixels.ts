import { Core, type Game, Scale } from "phaser";

import { type CanvasPlacement, centresVertically } from "../canvasPlacement";
import { integerZoom } from "../integerZoom";

// Keeps the canvas at the integer zoom for size (the game's size in game pixels), its parent's
// size and the screen's pixel ratio, placed in its parent by placement for the viewport's shape.
// Phaser measures the parent and emits a resize on each change, a change of pixel ratio or of
// orientation included, since those resize the window. The game's scale config sets mode
// Scale.NONE, so the zoom set here is the only one; the canvas's centring (Phaser's autoCenter)
// is set here too, always centred across.
export function fitWholePixels(
  placement: CanvasPlacement,
  size: { readonly height: number; readonly width: number },
  game: Game,
): void {
  const fit = () => {
    const { height, width } = game.scale.parentSize;
    if (width <= 0 || height <= 0) {
      return;
    }
    const viewport = { height: window.innerHeight, width: window.innerWidth };
    const centre = centresVertically(placement, viewport)
      ? Scale.CENTER_BOTH
      : Scale.CENTER_HORIZONTALLY;
    const zoom = integerZoom(size, window.devicePixelRatio || 1, { height, width });
    const placed = centre === game.scale.autoCenter;
    game.scale.autoCenter = centre;
    if (zoom !== game.scale.zoom) {
      game.scale.setZoom(zoom);
    } else if (!placed) {
      game.scale.updateCenter();
    }
  };
  game.scale.on(Scale.Events.RESIZE, fit);
  game.events.once(Core.Events.READY, fit);
}
