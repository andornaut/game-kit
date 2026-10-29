import type { Point, Rect } from "../rect";

// A point on the page, in client pixels, in game pixels: canvasBox is the canvas's box on the page
// (its getBoundingClientRect), stretched to show a game gameSize big. Each axis scales on its
// own, so a canvas at a fractional zoom maps exactly. Not clamped: a point off the canvas, in the
// bars or margins beside it, lies off the game by as far, so a drag across them still travels;
// clampInto puts it on the game's nearest pixel.
export function pageToGame(
  canvasBox: Rect,
  gameSize: Pick<Rect, "height" | "width">,
  client: Point,
): Point {
  return {
    x: ((client.x - canvasBox.x) * gameSize.width) / canvasBox.width,
    y: ((client.y - canvasBox.y) * gameSize.height) / canvasBox.height,
  };
}
