import type { Rect } from "../rect";

type Size = Pick<Rect, "height" | "width">;

// How far, in CSS pixels, the canvas may reach past the visible area, or the play area's size
// differ from the size the last fit used, before the game refits: rounding between layout and
// bounding boxes stays inside it.
export const FIT_TOLERANCE = 1;

// Whether the game's fit has gone stale: the canvas's box on the page reaches past the visible
// area by more than FIT_TOLERANCE on any side, or the play area (the canvas's parent) is a
// different size from the one the last fit used.
export function needsRefit(visible: Rect, canvas: Rect, playArea: Size, fitted: Size): boolean {
  const past =
    visible.x - canvas.x > FIT_TOLERANCE ||
    visible.y - canvas.y > FIT_TOLERANCE ||
    canvas.x + canvas.width - (visible.x + visible.width) > FIT_TOLERANCE ||
    canvas.y + canvas.height - (visible.y + visible.height) > FIT_TOLERANCE;
  const resized =
    Math.abs(playArea.width - fitted.width) > FIT_TOLERANCE ||
    Math.abs(playArea.height - fitted.height) > FIT_TOLERANCE;
  return past || resized;
}
