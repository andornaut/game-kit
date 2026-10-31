import { clamp01 } from "./numbers";
import type { Rect } from "./rect";

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

// Fill bands run top to bottom. A centred static segment marks pending work without a clock.
// Determinate widths cover only complete pixels, reaching the track's end at exactly one.
export function progressBarLayout(
  style: ProgressBarStyle,
  frame: Rect,
  progress: ProgressValue,
): ProgressBarLayout {
  const border = Math.max(0, Math.min(style.border, frame.width / 2, frame.height / 2));
  const track = {
    height: Math.max(0, frame.height - 2 * border),
    width: Math.max(0, frame.width - 2 * border),
    x: frame.x + border,
    y: frame.y + border,
  };
  const value = progress !== undefined && Number.isFinite(progress) ? clamp01(progress) : undefined;
  const width = value === undefined ? Math.floor(track.width / 4) : Math.floor(track.width * value);
  const x = track.x + (value === undefined ? Math.floor((track.width - width) / 2) : 0);
  const height = style.fills.length === 0 ? 0 : track.height / style.fills.length;
  const fills = style.fills.map((_colour, index) => ({
    height,
    width,
    x,
    y: track.y + index * height,
  }));
  return { fills, frame, track, value };
}
