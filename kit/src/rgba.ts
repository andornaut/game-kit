// Remaps RGBA pixel data in place, each pixel's colour (0xRRGGBB) to what remap gives for it,
// leaving alpha alone. Each distinct colour is remapped once.
export function remapRgb(remap: (colour: number) => number, pixels: Uint8ClampedArray): void {
  const cache = new Map<number, number>();
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const colour = ((pixels[i] ?? 0) << 16) | ((pixels[i + 1] ?? 0) << 8) | (pixels[i + 2] ?? 0);
    let mapped = cache.get(colour);
    if (mapped === undefined) {
      mapped = remap(colour);
      cache.set(colour, mapped);
    }
    pixels[i] = (mapped >> 16) & 0xff;
    pixels[i + 1] = (mapped >> 8) & 0xff;
    pixels[i + 2] = mapped & 0xff;
  }
}

function distance(a: number, b: number): number {
  const red = ((a >> 16) & 0xff) - ((b >> 16) & 0xff);
  const green = ((a >> 8) & 0xff) - ((b >> 8) & 0xff);
  const blue = (a & 0xff) - (b & 0xff);
  return red * red + green * green + blue * blue;
}

// Moves a colour (0xRRGGBB) steps down its ramp: snapped first to the nearest colour oneStep
// maps, so a colour off the palette (a blended pixel) still lands on a ramp, then through oneStep
// steps times, stopping at a ramp's end. Never blends with black. oneStep maps each palette colour
// to the next one down its ramp.
export function rampDown(
  oneStep: ReadonlyMap<number, number>,
  steps: number,
): (colour: number) => number {
  const palette = [...oneStep.keys()];
  return (colour) => {
    let result = palette.reduce(
      (best, candidate) =>
        distance(candidate, colour) < distance(best, colour) ? candidate : best,
      palette[0] ?? colour,
    );
    for (let step = 0; step < steps; step += 1) {
      result = oneStep.get(result) ?? result;
    }
    return result;
  };
}
