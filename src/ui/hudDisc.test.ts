import { describe, expect, it } from "vitest";

import { checkHudDiscSize, hudDiscGeometry, hudDiscIconOffset } from "./hudDisc.ts";

describe("hudDiscIconOffset", () => {
  it("centres the icon box on the face, the odd unit right and below", () => {
    // Ada's disc: a 20 glyph on a 33 face, 13 spare: 6 before, 7 after.
    expect(hudDiscIconOffset({ face: 33, icon: 20 })).toEqual({ x: 6, y: 6 });
    expect(hudDiscIconOffset({ face: 32, icon: 20 })).toEqual({ x: 6, y: 6 });
  });

  it("centres the ink, not the box, by the side bearings", () => {
    // Ada's rapid missile glyph: ink 17 wide (1 left, 2 right) and 14 high (3 and 3).
    const bearings = { bottom: 3, left: 1, right: 2, top: 3 };
    expect(hudDiscIconOffset({ face: 33, icon: 20 }, bearings)).toEqual({ x: 7, y: 6 });
    // Ink 11 wide (4 left, 5 right) on 33: 22 spare, so the ink starts at 11 and the box at 7.
    expect(
      hudDiscIconOffset({ face: 33, icon: 20 }, { bottom: 1, left: 4, right: 5, top: 1 }),
    ).toEqual({ x: 7, y: 6 });
  });

  it("refuses sizes and bearings that are not whole units or leave no ink", () => {
    expect(() => checkHudDiscSize({ face: 33.5, icon: 20 })).toThrow(RangeError);
    expect(() => checkHudDiscSize({ face: 33, icon: 0 })).toThrow(RangeError);
    expect(() =>
      hudDiscIconOffset({ face: 33, icon: 20 }, { bottom: 0, left: 10, right: 10, top: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      hudDiscIconOffset({ face: 33, icon: 20 }, { bottom: 0, left: -1, right: 0, top: 0 }),
    ).toThrow(RangeError);
  });
});

describe("hudDiscGeometry", () => {
  it("places the face and icon from the origin through the projection", () => {
    const geometry = hudDiscGeometry(
      { origin: { x: 10, y: 4 }, project: { x: (edge) => edge * 3, y: (edge) => edge * 3 } },
      { face: 33, icon: 20 },
    );
    expect(geometry.face).toEqual({ height: 99, width: 99, x: 30, y: 12 });
    expect(geometry.icon).toEqual({ height: 60, width: 60, x: 48, y: 30 });
  });

  it("keeps every edge whole and in order", () => {
    expect(() =>
      hudDiscGeometry(
        { project: { x: (edge) => edge / 2, y: (edge) => edge } },
        { face: 33, icon: 20 },
      ),
    ).toThrow(RangeError);
    expect(() =>
      hudDiscGeometry(
        { project: { x: (edge) => -edge, y: (edge) => edge } },
        { face: 33, icon: 20 },
      ),
    ).toThrow(RangeError);
    expect(() => hudDiscGeometry({ origin: { x: 0.5, y: 0 } }, { face: 33, icon: 20 })).toThrow(
      RangeError,
    );
  });
});
