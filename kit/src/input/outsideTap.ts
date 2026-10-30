import { containsPoint, type Point, type Rect } from "../rect";

// A tap outside an open panel closes it, as its close control does: a press that lands in
// bounds, off the panel and every rect covered lists (the panel, controls drawn outside it and
// the top bar's buttons, which keep their own taps), never travels past the tap distance and is
// released outside. phaser/catchOutsideTaps applies it to a scene.

// Where a tap outside counts: in bounds, off every covered rect.
export interface OutsideArea {
  readonly bounds: Rect;
  readonly covered: readonly Rect[];
}

// A press that landed outside, from its start, and whether it is still a tap.
export interface OutsidePress {
  readonly start: Point;
  readonly tapping: boolean;
}

export function isOutside(area: OutsideArea, point: Point): boolean {
  return (
    containsPoint(area.bounds, point.x, point.y) &&
    !area.covered.some((rect) => containsPoint(rect, point.x, point.y))
  );
}

// A press that lands outside, or undefined for one that lands anywhere else.
export function outsidePressDown(area: OutsideArea, point: Point): OutsidePress | undefined {
  return isOutside(area, point) ? { start: point, tapping: true } : undefined;
}

// A press that travels past tapMaxDistance is a drag, and stays one.
export function outsidePressMove(
  tapMaxDistance: number,
  point: Point,
  press: OutsidePress,
): OutsidePress {
  const travel = Math.hypot(point.x - press.start.x, point.y - press.start.y);
  return { ...press, tapping: press.tapping && travel <= tapMaxDistance };
}

// A tap outside: a press that landed outside, never travelled past tapMaxDistance, and is
// released outside. cancelled: the browser called the press off.
export function outsideTapped(
  area: OutsideArea,
  tapMaxDistance: number,
  cancelled: boolean,
  press: OutsidePress | undefined,
  point: Point,
): boolean {
  return (
    !cancelled &&
    press !== undefined &&
    outsidePressMove(tapMaxDistance, point, press).tapping &&
    isOutside(area, point)
  );
}
