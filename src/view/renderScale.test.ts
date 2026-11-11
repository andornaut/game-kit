import { describe, expect, it } from "vitest";

import { densityTexels, MAX_RENDER_SCALE, renderFit, renderScale } from "./renderScale.ts";

describe("renderScale", () => {
  it.each([
    [1, 1],
    [1.5, 1.5],
    [2, 2],
    [3, 2],
    [2.625, 2],
    [0, 1],
    [-2, 1],
    [Number.NaN, 1],
    [Number.POSITIVE_INFINITY, 1],
  ])("caps a device pixel ratio of %d at %d", (devicePixelRatio, scale) => {
    expect(renderScale(MAX_RENDER_SCALE, devicePixelRatio)).toBe(scale);
  });
});

describe("renderFit", () => {
  it("fits the base by its tighter axis and rounds the backing and view to device pixels", () => {
    // An 844x390 CSS phone area at r 2 holding a 720x360 base: the height binds (390 / 360).
    const fit = 390 / 360;
    expect(renderFit({ height: 360, width: 720 }, 2, { height: 390, width: 844 })).toEqual({
      backing: { height: 780, width: 1688 },
      fit,
      r: 2,
      view: { height: 780, width: 1560 },
      zoom: 2 * fit,
    });
  });

  it("rounds a fractional CSS area's backing to the nearest device pixel", () => {
    const { backing, fit, zoom } = renderFit({ height: 100, width: 100 }, 1.5, {
      height: 50.3,
      width: 200.5,
    });
    expect([backing, fit, zoom]).toEqual([
      { height: 75, width: 301 },
      50.3 / 100,
      1.5 * (50.3 / 100),
    ]);
  });
});

describe("densityTexels", () => {
  it.each([
    [2.17, 48, 104],
    [1, 0.2, 1],
    [3.25, 10, 33],
  ])("gives zoom %d over %d logical pixels %d texels", (zoom, logical, texels) => {
    expect(densityTexels(zoom, logical)).toBe(texels);
  });
});
