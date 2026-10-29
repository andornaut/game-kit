import { clampIndex } from "../arrays";
import type { Point, Rect } from "../rect";

// An image's pixels, 4 bytes each (red, green, blue, alpha), row by row from the top-left.
export interface RgbaImage {
  data: Uint8Array;
  height: number;
  width: number;
}

// An image of clear pixels.
export function blankImage(width: number, height: number): RgbaImage {
  return { data: new Uint8Array(width * height * 4), height, width };
}

// Copies the from rect of source to target with its top-left at, and extrude pixels around it on
// every side as source holds them inside bounds, repeating bounds' edge pixels past its edges, so
// a frame sampled just past its edge reads its own colour rather than a neighbour's. bounds is
// the whole frame a trimmed rect was cut from, so the border holds what the whole frame's pixels
// hold there; it defaults to from.
export function blitExtruded(
  source: RgbaImage,
  from: Rect,
  extrude: number,
  target: RgbaImage,
  at: Point,
  bounds: Rect = from,
): void {
  for (let dy = -extrude; dy < from.height + extrude; dy++) {
    const sourceY = bounds.y + clampIndex(bounds.height, from.y - bounds.y + dy);
    for (let dx = -extrude; dx < from.width + extrude; dx++) {
      const sourceX = bounds.x + clampIndex(bounds.width, from.x - bounds.x + dx);
      const read = (sourceY * source.width + sourceX) * 4;
      const write = ((at.y + dy) * target.width + at.x + dx) * 4;
      target.data.set(source.data.subarray(read, read + 4), write);
    }
  }
}
