import { describe, expect, it } from "vitest";

import { decodeWebp, encodeLosslessWebp, type RgbaImage, sameRgba, webpDecodesTo } from "./webp";

// A width x height image whose every byte differs, with clear pixels that still carry colour.
function numbered(width: number, height: number): RgbaImage {
  const data = new Uint8Array(width * height * 4).map((_, i) => (i * 37 + 11) % 256);
  for (let i = 3; i < data.length; i += 16) {
    data[i] = 0;
  }
  return { data, height, width };
}

const changed = (image: RgbaImage, at: number): RgbaImage => {
  const data = image.data.slice();
  data[at] = ((data[at] ?? 0) + 1) % 256;
  return { ...image, data };
};

describe("sameRgba", () => {
  const image = numbered(3, 2);

  it.each<[string, RgbaImage, boolean]>([
    ["the same pixels", numbered(3, 2), true],
    ["one byte changed", changed(image, 5), false],
    ["the same bytes in another shape", { ...numbered(3, 2), height: 3, width: 2 }, false],
  ])("compares %s", (_case, other, same) => {
    expect(sameRgba(image, other)).toBe(same);
  });
});

describe("the lossless WebP", () => {
  it.each([
    ["a single pixel", 1, 1],
    ["a wide strip", 17, 3],
    ["a square", 16, 16],
  ])("decodes %s to exactly its pixels, colour under clear alpha included", async (_, w, h) => {
    const image = numbered(w, h);
    expect(sameRgba(await decodeWebp(await encodeLosslessWebp(image)), image)).toBe(true);
  });

  it("writes the same bytes each time", async () => {
    const image = numbered(16, 16);
    const [a, b] = await Promise.all([encodeLosslessWebp(image), encodeLosslessWebp(image)]);
    expect(Buffer.compare(a, b)).toBe(0);
  });

  it.each([
    ["its own pixels", (image: RgbaImage) => image, true],
    ["other pixels", (image: RgbaImage) => changed(image, 0), false],
  ])("tells whether a WebP decodes to %s", async (_, expected, decodes) => {
    const image = numbered(4, 4);
    expect(await webpDecodesTo(expected(image), await encodeLosslessWebp(image))).toBe(decodes);
  });
});
