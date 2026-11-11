import { clamp } from "../numbers.ts";
import { containsPoint, type Point, type Rect } from "../rect.ts";

// Press areas: a drawn control's press area reaches past it on every side by marginShare of its
// shorter side, never less than leastMargin or more than mostMargin, and is at least minTarget on
// each axis, grown evenly about its centre where it would be smaller. The game supplies the rule
// and the shapes, in its own base pixels.
export interface HitRule {
  readonly leastMargin: number;
  readonly marginShare: number;
  readonly minTarget: number;
  readonly mostMargin: number;
}

// How far a drawn control's press area reaches past it on every side.
export function hitMargin(rule: HitRule, art: Rect): number {
  const { leastMargin, marginShare, mostMargin } = rule;
  return clamp(leastMargin, mostMargin, marginShare * Math.min(art.width, art.height));
}

// A drawn control's press area: art grown by hitMargin on every side, then to minTarget on each
// axis where it is still smaller, about its centre.
export function hitAround(rule: HitRule, art: Rect): Rect {
  const margin = hitMargin(rule, art);
  const grow = (start: number, size: number) => {
    const grown = size + 2 * margin;
    const side = Math.max(grown, rule.minTarget);
    return { size: side, start: start - margin - (side - grown) / 2 };
  };
  const x = grow(art.x, art.width);
  const y = grow(art.y, art.height);
  return { height: y.size, width: x.size, x: x.start, y: y.start };
}

// A circle, cut where awayFrom is given along the line midway between its centre and awayFrom: it
// then takes in only the points nearer its own centre, so two circles cut toward each other meet
// on that line and never overlap.
export interface HitCircle {
  readonly awayFrom?: Point;
  readonly centre: Point;
  readonly radius: number;
}

// A press area's shape: a rect, a circle, or the union of several.
export type PressShape = HitCircle | Rect | readonly (HitCircle | Rect)[];

// A control on screen: what it is, where it is drawn, and its press area.
export interface PressArea<K> {
  readonly art: Rect;
  readonly hit: PressShape;
  readonly key: K;
}

function contains(shape: PressShape, point: Point): boolean {
  if (Array.isArray(shape)) {
    return shape.some((part: HitCircle | Rect) => contains(part, point));
  }
  if ("radius" in shape) {
    const fromCentre = Math.hypot(point.x - shape.centre.x, point.y - shape.centre.y);
    const { awayFrom } = shape;
    return (
      fromCentre < shape.radius &&
      (awayFrom === undefined ||
        fromCentre < Math.hypot(point.x - awayFrom.x, point.y - awayFrom.y))
    );
  }
  return containsPoint(shape as Rect, point.x, point.y);
}

function distanceToCentre(art: Rect, point: Point): number {
  return Math.hypot(point.x - (art.x + art.width / 2), point.y - (art.y + art.height / 2));
}

// The control a press at point lands on: of those whose press area takes it in, the one whose
// drawn centre is nearest, so where two areas overlap the nearer control wins; the earlier one
// on a tie.
export function pressedArea<K>(areas: readonly PressArea<K>[], point: Point): K | undefined {
  let best: PressArea<K> | undefined;
  for (const area of areas) {
    if (
      contains(area.hit, point) &&
      (best === undefined || distanceToCentre(area.art, point) < distanceToCentre(best.art, point))
    ) {
      best = area;
    }
  }
  return best?.key;
}
