// Math.min(maximum, Math.max(minimum, value)), without sorting or sanitizing inputs.
// NaN propagates. Reversed bounds return maximum for a non-NaN value.
export function clamp(minimum: number, maximum: number, value: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

// value held between 0 and 1.
export function clamp01(value: number): number {
  return clamp(0, 1, value);
}

// Unclamped linear interpolation, including extrapolation and IEEE non-finite arithmetic.
export function lerp(from: number, to: number, fraction: number): number {
  return from + (to - from) * fraction;
}
