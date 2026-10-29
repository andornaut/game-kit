export interface PixelBounds {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

// The smallest box around the opaque pixels, with right and bottom one past the last
// opaque column and row. Undefined when nothing is opaque.
export function opaqueBounds(
  width: number,
  height: number,
  isOpaque: (x: number, y: number) => boolean,
): PixelBounds | undefined {
  let [left, top, right, bottom] = [width, height, 0, 0];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isOpaque(x, y)) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x + 1);
        bottom = Math.max(bottom, y + 1);
      }
    }
  }
  return right === 0 ? undefined : { bottom, left, right, top };
}

// opaqueBounds over RGBA bytes, as canvas ImageData holds them: a pixel is opaque when its
// alpha byte is not 0.
export function opaqueBoundsOfRgba(
  width: number,
  height: number,
  rgba: ArrayLike<number>,
): PixelBounds | undefined {
  return opaqueBounds(width, height, (x, y) => (rgba[(y * width + x) * 4 + 3] ?? 0) > 0);
}
