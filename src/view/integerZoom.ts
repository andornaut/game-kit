// The game's zoom on the page, in CSS pixels per game pixel. Each game pixel covers the same
// whole number of device pixels, the most that fit the space, so none draws a column or row
// wider than its neighbours; the rest of the space is letterbox. Counting device pixels rather
// than CSS pixels lets a phone at a fractional pixel ratio (2.625, say) use its full width. A
// space too small for one device pixel per game pixel falls back to fitting it, unevenly.
export function integerZoom(
  game: { readonly height: number; readonly width: number },
  pixelRatio: number,
  space: { readonly height: number; readonly width: number },
): number {
  const fit = Math.min(space.width / game.width, space.height / game.height);
  const whole = Math.floor(fit * pixelRatio + 1e-9);
  return whole >= 1 ? whole / pixelRatio : fit;
}
