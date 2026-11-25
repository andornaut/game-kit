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

// A whole-unit rect of the game's art in the projection's space. With artPixel, the whole output
// length of one art pixel (one unit of art), its corner is projected and its size is artPixel per
// unit, so snapping never stretches the art; without it each edge is projected on its own
// (projectRect). Throws RangeError on a corner that is not whole or an artPixel that is not a
// whole number of at least 1.
export function projectArtRect(
  projection: ActionProjection,
  artPixel: number | undefined,
  rect: Rect,
): Rect {
  if (artPixel === undefined) {
    return projectRect(projection, rect);
  }
  checkArtPixel(artPixel);
  const x = projection.x(rect.x);
  const y = projection.y(rect.y);
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    throw new RangeError("A projection must map edges to whole numbers");
  }
  return { height: rect.height * artPixel, width: rect.width * artPixel, x, y };
}

// Throws RangeError unless artPixel is a whole number of at least 1.
export function checkArtPixel(artPixel: number): void {
  if (!Number.isInteger(artPixel) || artPixel < 1) {
    throw new RangeError("artPixel must be a whole number, at least 1");
  }
}
