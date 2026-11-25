import type { Rect } from "../rect.ts";

// Maps a whole-unit edge to the caller's output space, such as integer device pixels. Each axis
// must be nondecreasing and return whole numbers. Neighbours share projected edges, so projection
// keeps press areas touching without overlap.
export interface ActionProjection {
  x(edge: number): number;
  y(edge: number): number;
}

export const IDENTITY_PROJECTION: ActionProjection = { x: (edge) => edge, y: (edge) => edge };

// A whole-unit rect in the projection's space, each edge mapped on its own. Throws RangeError
// on an edge that is not whole or edges out of order.
export function projectRect(projection: ActionProjection, rect: Rect): Rect {
  const left = projection.x(rect.x);
  const right = projection.x(rect.x + rect.width);
  const top = projection.y(rect.y);
  const bottom = projection.y(rect.y + rect.height);
  for (const edge of [left, right, top, bottom]) {
    if (!Number.isInteger(edge)) {
      throw new RangeError("A projection must map edges to whole numbers");
    }
  }
  if (right < left || bottom < top) {
    throw new RangeError("A projection must keep edges in order");
  }
  return { height: bottom - top, width: right - left, x: left, y: top };
}
