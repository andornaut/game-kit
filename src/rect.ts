// A position in screen pixels.
export interface Point {
  readonly x: number;
  readonly y: number;
}

// Placed by its top-left corner, in screen pixels.
export interface Rect {
  height: number;
  width: number;
  x: number;
  y: number;
}

// The left and top edges are inside the rect, the right and bottom edges outside.
export function containsPoint(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}

// Whether two rects share any pixel.
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

// The rect shrunk by the same amount on every side.
export function insetRect(amount: number, rect: Rect): Rect {
  return {
    height: rect.height - 2 * amount,
    width: rect.width - 2 * amount,
    x: rect.x + amount,
    y: rect.y + amount,
  };
}

// A ring of the given thickness just inside rect's edge, as its top, bottom, left and right
// bands; the side bands run the rect's full height.
export function ringRects(thickness: number, rect: Rect): Rect[] {
  const { height, width, x, y } = rect;
  return [
    { height: thickness, width, x, y },
    { height: thickness, width, x, y: y + height - thickness },
    { height, width: thickness, x, y },
    { height, width: thickness, x: x + width - thickness, y },
  ];
}

// A rect size big, centred on x with its bottom at bottom, moved the least to lie inside bounds
// (its top-left inside them where it is bigger than they are).
export function rectAboveIn(
  bounds: Rect,
  at: { bottom: number; x: number },
  size: Pick<Rect, "height" | "width">,
): Rect {
  const keep = (start: number, length: number, from: number, room: number) =>
    Math.max(from, Math.min(start, from + room - length));
  return {
    ...size,
    x: keep(Math.round(at.x - size.width / 2), size.width, bounds.x, bounds.width),
    y: keep(at.bottom - size.height, size.height, bounds.y, bounds.height),
  };
}

// The point of rect nearest to point: the point itself inside rect, else on rect's edge, the last
// column or row for one past its right or bottom edge (containsPoint leaves those edges out).
export function clampInto(rect: Rect, point: Point): Point {
  const within = (value: number, start: number, size: number) =>
    Math.min(Math.max(value, start), start + size - 1);
  return { x: within(point.x, rect.x, rect.width), y: within(point.y, rect.y, rect.height) };
}
