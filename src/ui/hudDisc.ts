import type { Point, Rect } from "../rect.ts";
import type { ActionProjection } from "./actionGroup.ts";

// HUD discs: round icon buttons whose face is the layout box, laid out and given press areas by
// an action group (one disc alone is a group of one). A state changes only the face's fill and the
// icon's colour, so the disc's face and press geometry never change. The icon is the game's SVG or
// art in an icon box; its ink, the box less its side bearings, is centred on the face. Every
// length is a whole game unit, and the odd unit of a centring goes right or below.

// A size token: the face's side and the icon box's side.
export interface HudDiscSize {
  readonly face: number;
  readonly icon: number;
}

// The icon box's transparent margins on each side, from the game's art data.
export interface IconBearings {
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
}

export const NO_BEARINGS: IconBearings = { bottom: 0, left: 0, right: 0, top: 0 };

export interface HudDiscContext {
  // The face's top-left corner, in whole units; (0, 0) by default.
  readonly origin?: Point;
  // Maps edges to the caller's space, as for arrangeActions.
  readonly project?: ActionProjection;
}

export interface HudDiscGeometry {
  readonly face: Rect;
  readonly icon: Rect;
}

function whole(name: string, value: number, least: number): void {
  if (!Number.isInteger(value) || value < least) {
    throw new RangeError(`${name} must be a whole number of units, at least ${least}`);
  }
}

// Validates a size token. Throws RangeError on a face or icon that is not a whole positive unit.
export function checkHudDiscSize(size: HudDiscSize): void {
  whole("face", size.face, 1);
  whole("icon", size.icon, 1);
}

// The icon box's place relative to the face's corner, its ink centred on the face with the odd
// unit right or below. Throws RangeError on invalid sizes or bearings that leave no ink.
export function hudDiscIconOffset(size: HudDiscSize, bearings: IconBearings = NO_BEARINGS): Point {
  checkHudDiscSize(size);
  for (const side of ["bottom", "left", "right", "top"] as const) {
    whole(`bearings.${side}`, bearings[side], 0);
  }
  const inkWidth = size.icon - bearings.left - bearings.right;
  const inkHeight = size.icon - bearings.top - bearings.bottom;
  if (inkWidth < 1 || inkHeight < 1) {
    throw new RangeError("Icon bearings leave no ink");
  }
  return {
    x: Math.floor((size.face - inkWidth) / 2) - bearings.left,
    y: Math.floor((size.face - inkHeight) / 2) - bearings.top,
  };
}

// The disc's face and icon box in the caller's space.
export function hudDiscGeometry(
  context: HudDiscContext,
  size: HudDiscSize,
  bearings: IconBearings = NO_BEARINGS,
): HudDiscGeometry {
  const { origin = { x: 0, y: 0 }, project = { x: (edge) => edge, y: (edge) => edge } } = context;
  whole("origin.x", origin.x, Number.MIN_SAFE_INTEGER);
  whole("origin.y", origin.y, Number.MIN_SAFE_INTEGER);
  const offset = hudDiscIconOffset(size, bearings);
  const place = (x: number, y: number, side: number): Rect => {
    const left = project.x(x);
    const top = project.y(y);
    const right = project.x(x + side);
    const bottom = project.y(y + side);
    for (const edge of [left, top, right, bottom]) {
      if (!Number.isInteger(edge)) {
        throw new RangeError("A projection must map edges to whole numbers");
      }
    }
    if (right < left || bottom < top) {
      throw new RangeError("A projection must keep edges in order");
    }
    return { height: bottom - top, width: right - left, x: left, y: top };
  };
  return {
    face: place(origin.x, origin.y, size.face),
    icon: place(origin.x + offset.x, origin.y + offset.y, size.icon),
  };
}
