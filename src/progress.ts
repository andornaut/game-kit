import { assertNever } from "./assertNever.ts";
import { clamp01 } from "./numbers.ts";
import type { Rect } from "./rect.ts";

// Undefined means work whose total is unknown, rather than a measured percentage.
export type ProgressValue = number | undefined;

export interface ProgressBarStyle {
  readonly border: number;
  readonly fills: readonly number[];
  readonly frame: number;
  readonly track: number;
}

export interface ProgressBarLayout {
  readonly fills: readonly Rect[];
  readonly frame: Rect;
  readonly track: Rect;
  readonly value: ProgressValue;
}

// The indeterminate segment: it travels left to right across the track once every cycleMs,
// entering at the left edge and leaving at the right. segment is its width as a share of the
// track, greater than zero and at most one.
export interface ProgressMotion {
  readonly cycleMs: number;
  readonly segment: number;
}

// What a loading bar shows at one moment: nothing, a measured share, or work of unknown total
// elapsedMs after the segment began travelling.
export type ProgressDisplay =
  | { readonly kind: "hidden" }
  | { readonly kind: "indeterminate"; readonly elapsedMs: number }
  | { readonly kind: "measured"; readonly value: number };

const trackOf = (style: ProgressBarStyle, frame: Rect): Rect => {
  const border = Math.max(0, Math.min(style.border, frame.width / 2, frame.height / 2));
  return {
    height: Math.max(0, frame.height - 2 * border),
    width: Math.max(0, frame.width - 2 * border),
    x: frame.x + border,
    y: frame.y + border,
  };
};

const layoutOf = (
  style: ProgressBarStyle,
  frame: Rect,
  track: Rect,
  span: { readonly width: number; readonly x: number },
  value: ProgressValue,
): ProgressBarLayout => {
  const height = style.fills.length === 0 ? 0 : track.height / style.fills.length;
  const fills = style.fills.map((_colour, index) => ({
    height,
    width: span.width,
    x: track.x + span.x,
    y: track.y + index * height,
  }));
  return { fills, frame, track, value };
};

// Fill bands run top to bottom. Widths cover only complete pixels, reaching the track's end at
// exactly one. A nonfinite share draws an empty track.
export function progressBarLayout(
  style: ProgressBarStyle,
  frame: Rect,
  progress: number,
): ProgressBarLayout {
  const track = trackOf(style, frame);
  const value = Number.isFinite(progress) ? clamp01(progress) : 0;
  return layoutOf(style, frame, track, { width: Math.floor(track.width * value), x: 0 }, value);
}

// Throws a RangeError on a nonpositive or nonfinite cycle, or a segment outside (0, 1].
export function checkProgressMotion(motion: ProgressMotion): void {
  const { cycleMs, segment } = motion;
  if (!(Number.isFinite(cycleMs) && cycleMs > 0)) {
    throw new RangeError(`Indeterminate cycle must be positive and finite: ${cycleMs}`);
  }
  if (!(segment > 0 && segment <= 1)) {
    throw new RangeError(`Indeterminate segment must be in (0, 1]: ${segment}`);
  }
}

// The visible part of the travelling segment within a track of whole pixels, x from the
// track's left edge. Its leading edge sweeps from the left edge to one segment past the right
// edge each cycle, so the segment is clipped while it enters and leaves. progressBar.css draws
// the same motion. Throws as checkProgressMotion does.
export function indeterminateSegment(
  motion: ProgressMotion,
  width: number,
  elapsedMs: number,
): { readonly width: number; readonly x: number } {
  checkProgressMotion(motion);
  const { cycleMs, segment } = motion;
  const track = Math.max(0, Math.floor(width));
  if (track === 0) {
    return { width: 0, x: 0 };
  }
  const length = Math.min(track, Math.max(1, Math.round(segment * track)));
  const time = Number.isFinite(elapsedMs) ? elapsedMs : 0;
  const phase = (((time % cycleMs) + cycleMs) % cycleMs) / cycleMs;
  const lead = Math.floor(phase * (track + length));
  const x = Math.max(0, lead - length);
  return { width: Math.min(track, lead) - x, x };
}

// The layout a loading bar draws for display, or undefined while hidden. Reduced motion does
// not change the indeterminate segment.
export function progressDisplayLayout(
  style: ProgressBarStyle,
  motion: ProgressMotion,
  frame: Rect,
  display: ProgressDisplay,
): ProgressBarLayout | undefined {
  switch (display.kind) {
    case "hidden":
      return undefined;
    case "measured":
      return progressBarLayout(style, frame, display.value);
    case "indeterminate": {
      const track = trackOf(style, frame);
      const span = indeterminateSegment(motion, track.width, display.elapsedMs);
      return layoutOf(style, frame, track, span, undefined);
    }
    default:
      return assertNever(display);
  }
}
