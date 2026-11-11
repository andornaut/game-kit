import type { Rect } from "../rect.ts";

type Size = Readonly<Pick<Rect, "height" | "width">>;

// The default cap on the WebGL backing's device pixels per CSS pixel.
export const MAX_RENDER_SCALE = 2;

// Device pixels per CSS pixel for the WebGL backing: devicePixelRatio, at most max. A
// non-finite or non-positive ratio gives 1.
export function renderScale(max: number, devicePixelRatio: number): number {
  return Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
    ? Math.min(devicePixelRatio, max)
    : 1;
}

// A logical base resolution fitted to a CSS area at render scale r.
export interface RenderFit {
  // round(css x r), in device pixels.
  readonly backing: Size;
  // CSS pixels per logical pixel: the largest that keeps the base inside css.
  readonly fit: number;
  readonly r: number;
  // round(base x zoom), in device pixels.
  readonly view: Size;
  // r x fit, device pixels per logical pixel, fractional.
  readonly zoom: number;
}

// Fits base (logical pixels) to css (CSS pixels) with a backing r device pixels per CSS pixel.
export function renderFit(base: Size, r: number, css: Size): RenderFit {
  const fit = Math.min(css.width / base.width, css.height / base.height);
  const zoom = r * fit;
  return {
    backing: { height: Math.round(css.height * r), width: Math.round(css.width * r) },
    fit,
    r,
    view: { height: Math.round(base.height * zoom), width: Math.round(base.width * zoom) },
    zoom,
  };
}

// Texels for a screen-density texture logical pixels long, drawn at zoom device pixels per
// logical pixel: at least one.
export function densityTexels(zoom: number, logical: number): number {
  return Math.max(1, Math.round(logical * zoom));
}
