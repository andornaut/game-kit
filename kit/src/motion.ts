import { clamp01 } from "./numbers";

export type Easing = "linear" | "sineInOut";

// Coordinates use the caller's units, independently on each axis.
export interface Point {
  readonly x: number;
  readonly y: number;
}

// Start and duration use the same progress unit, such as seconds or road scroll.
export interface Segment {
  readonly duration: number;
  readonly easing: Easing;
  readonly from: Point;
  readonly start: number;
  readonly to: Point;
}

// Callers validate finite start and nonnegative finite duration. Infinite positions query
// either endpoint. A zero-duration segment changes instantly at start; NaN stays NaN.
export function progressAt(start: number, duration: number, position: number): number {
  if (duration === 0) {
    return position < start ? 0 : position >= start ? 1 : NaN;
  }
  return clamp01((position - start) / duration);
}

export function easeProgress(easing: Easing, progress: number): number {
  const held = clamp01(progress);
  return easing === "sineInOut" ? (1 - Math.cos(Math.PI * held)) / 2 : held;
}

// Evaluate without changing the segment, drawing randomness or advancing a clock.
export function segmentAt(segment: Segment, position: number): Point {
  const done = easeProgress(segment.easing, progressAt(segment.start, segment.duration, position));
  return {
    x: segment.from.x + (segment.to.x - segment.from.x) * done,
    y: segment.from.y + (segment.to.y - segment.from.y) * done,
  };
}
