import type { Point, Rect } from "../rect";

// How far the page's game frame is turned clockwise on the screen: 0, or 90 or -90 where the game
// is drawn on its side, such as a landscape game on a phone held in portrait (frameTurn.ts).
export type FrameTurn = -90 | 0 | 90;

// A point on the page, in client pixels, in game pixels: canvasBox is the canvas's box on the page
// (its getBoundingClientRect), turned by turn and stretched to show a game gameSize big. Each axis
// scales on its own, so a canvas at a fractional zoom maps exactly. Turned by 90, the game's x
// runs down the page and its y from right to left, so the game's top-left is the box's top-right;
// turned by -90, its x runs up the page and its y from left to right, so its top-left is the
// box's bottom-left.
// Not clamped: a point off the canvas, in the bars or margins beside it, lies off the game by as
// far, so a drag across them still travels; clampInto puts it on the game's nearest pixel.
export function pageToGame(
  turn: FrameTurn,
  canvasBox: Rect,
  gameSize: Pick<Rect, "height" | "width">,
  client: Point,
): Point {
  if (turn === -90) {
    return {
      x: ((canvasBox.y + canvasBox.height - client.y) * gameSize.width) / canvasBox.height,
      y: ((client.x - canvasBox.x) * gameSize.height) / canvasBox.width,
    };
  }
  if (turn === 90) {
    return {
      x: ((client.y - canvasBox.y) * gameSize.width) / canvasBox.height,
      y: ((canvasBox.x + canvasBox.width - client.x) * gameSize.height) / canvasBox.width,
    };
  }
  return {
    x: ((client.x - canvasBox.x) * gameSize.width) / canvasBox.width,
    y: ((client.y - canvasBox.y) * gameSize.height) / canvasBox.height,
  };
}
