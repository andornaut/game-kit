import { describe, expect, it } from "vitest";

import {
  checkSliderArt,
  checkSliderStep,
  type SliderArt,
  sliderGeometry,
  sliderLane,
  sliderPresentation,
  sliderStepAt,
  sliderStepForKey,
  sliderThumbOffset,
} from "./slider.ts";

// Archie's volume slider: a 10x16 knob on a 24x10 three-slice track with 4 unit caps, 20 steps.
const ART: SliderArt = {
  thumb: { height: 16, width: 10 },
  track: { caps: { left: 4, right: 4 }, height: 10 },
};
const ARCHIE = { art: ART, steps: 20, width: 280 };

describe("sliderStepForKey", () => {
  it("steps one with the arrows, held to the ends, and jumps with Home and End", () => {
    expect(sliderStepForKey(20, 5, "ArrowLeft")).toBe(4);
    expect(sliderStepForKey(20, 5, "ArrowRight")).toBe(6);
    expect(sliderStepForKey(20, 0, "ArrowLeft")).toBe(0);
    expect(sliderStepForKey(20, 20, "ArrowRight")).toBe(20);
    expect(sliderStepForKey(20, 5, "Home")).toBe(0);
    expect(sliderStepForKey(20, 5, "End")).toBe(20);
    expect(sliderStepForKey(20, 5, "ArrowUp")).toBeUndefined();
    expect(sliderStepForKey(20, 5, "Enter")).toBeUndefined();
  });

  it("rejects a step off the scale", () => {
    expect(() => sliderStepForKey(20, 21, "Home")).toThrow(RangeError);
    expect(() => sliderStepForKey(20, 1.5, "Home")).toThrow(RangeError);
    expect(() => sliderStepForKey(0, 0, "Home")).toThrow(RangeError);
  });
});

describe("sliderThumbOffset", () => {
  it("places the thumb on whole units along its travel, meeting both ends", () => {
    // Travel 270: Archie's knobX, track.x + round(270 * steps / 20).
    for (let step = 0; step <= 20; step += 1) {
      expect(sliderThumbOffset(ARCHIE, step)).toBe(Math.round((270 * step) / 20));
    }
    expect(sliderThumbOffset(ARCHIE, 0)).toBe(0);
    expect(sliderThumbOffset(ARCHIE, 20)).toBe(270);
  });

  it("rounds an exact half right", () => {
    // Travel 1 over 2 steps: step 1 is half a unit along.
    expect(sliderThumbOffset({ art: ART, steps: 2, width: 11 }, 1)).toBe(1);
    // Travel 3 over 2 steps: 1.5 goes to 2.
    expect(sliderThumbOffset({ art: ART, steps: 2, width: 13 }, 1)).toBe(2);
  });

  it("rejects a track narrower than its thumb", () => {
    expect(() => sliderThumbOffset({ art: ART, steps: 20, width: 9 }, 0)).toThrow(RangeError);
    expect(() => sliderThumbOffset({ art: ART, steps: 20, width: 10.5 }, 0)).toThrow(RangeError);
  });
});

describe("sliderStepAt", () => {
  it("follows the thumb's centre, held to the track", () => {
    expect(sliderStepAt(ARCHIE, -40)).toBe(0);
    expect(sliderStepAt(ARCHIE, 5)).toBe(0);
    expect(sliderStepAt(ARCHIE, 5 + 135)).toBe(10);
    expect(sliderStepAt(ARCHIE, 275)).toBe(20);
    expect(sliderStepAt(ARCHIE, 400)).toBe(20);
    // A half step rounds up: 6.75 units is half of 13.5, the travel per step.
    expect(sliderStepAt(ARCHIE, 5 + 6.75)).toBe(1);
    expect(sliderStepAt(ARCHIE, 5 + 6.74)).toBe(0);
  });

  it("agrees with the thumb's place at every step", () => {
    for (let step = 0; step <= 20; step += 1) {
      expect(sliderStepAt(ARCHIE, sliderThumbOffset(ARCHIE, step) + 5)).toBe(step);
    }
  });

  it("has one place on a track no wider than its thumb", () => {
    expect(sliderStepAt({ art: ART, steps: 20, width: 10 }, 50)).toBe(0);
  });
});

describe("sliderLane and sliderGeometry", () => {
  it("centres the track and the thumb down the lane, the odd unit below", () => {
    expect(sliderLane(ART)).toEqual({ height: 16, thumbTop: 0, trackTop: 3 });
    expect(
      sliderLane({
        thumb: { height: 9, width: 4 },
        track: { caps: { left: 1, right: 1 }, height: 4 },
      }),
    ).toEqual({ height: 9, thumbTop: 0, trackTop: 2 });
  });

  it("lays out the track, the fill to the thumb's right edge and the thumb", () => {
    // Archie's row at (32, 100): the track at x 40, its top 30 rows down, the knob 3 above it.
    const geometry = sliderGeometry({ ...ARCHIE, origin: { x: 40, y: 127 } }, 10);
    expect(geometry).toEqual({
      fill: { height: 10, width: 145, x: 40, y: 130 },
      lane: { height: 16, width: 280, x: 40, y: 127 },
      thumb: { height: 16, width: 10, x: 175, y: 127 },
      track: { height: 10, width: 280, x: 40, y: 130 },
    });
  });

  it("projects edges, and rejects projections off whole numbers or out of order", () => {
    const double = { x: (edge: number) => edge * 2, y: (edge: number) => edge * 2 };
    expect(sliderGeometry({ ...ARCHIE, project: double }, 20).thumb).toEqual({
      height: 32,
      width: 20,
      x: 540,
      y: 0,
    });
    expect(() =>
      sliderGeometry({ ...ARCHIE, project: { x: (edge) => edge / 3, y: (edge) => edge } }, 1),
    ).toThrow(RangeError);
    expect(() =>
      sliderGeometry({ ...ARCHIE, project: { x: (edge) => -edge, y: (edge) => edge } }, 1),
    ).toThrow(RangeError);
  });

  it("keeps the thumb and the track's height at their art size with artPixel", () => {
    // Archie at 390x844@3: 3.25 device px per unit on whole 3 px art pixels.
    const grid = (edge: number) => Math.round((edge * 3.25) / 3) * 3;
    const project = { x: grid, y: grid };
    const context = { ...ARCHIE, artPixel: 3, origin: { x: 40, y: 127 }, project };
    for (let step = 0; step <= 20; step += 1) {
      const units = sliderGeometry({ ...ARCHIE, origin: { x: 40, y: 127 } }, step);
      const placed = sliderGeometry(context, step);
      expect(placed.thumb).toEqual({
        height: 48,
        width: 30,
        x: grid(units.thumb.x),
        y: grid(units.thumb.y),
      });
      expect([placed.track.height, placed.fill.height]).toEqual([30, 30]);
      expect(placed.track.width).toBe(grid(320) - grid(40));
      expect(placed.fill.width).toBe(grid(units.fill.x + units.fill.width) - grid(40));
    }
    expect(() => sliderGeometry({ ...context, artPixel: 1.5 }, 0)).toThrow(RangeError);
  });
});

describe("checkSliderArt and checkSliderStep", () => {
  it("rejects lengths off whole units and caps wider than the thumb", () => {
    expect(() => checkSliderArt(ART)).not.toThrow();
    expect(() => checkSliderArt({ ...ART, thumb: { height: 16, width: 0 } })).toThrow(RangeError);
    expect(() => checkSliderArt({ ...ART, thumb: { height: 16.5, width: 10 } })).toThrow(
      RangeError,
    );
    expect(() =>
      checkSliderArt({ ...ART, track: { caps: { left: 6, right: 5 }, height: 10 } }),
    ).toThrow(RangeError);
    expect(() => checkSliderStep(20, -1)).toThrow(RangeError);
    expect(() => checkSliderStep(20, 20)).not.toThrow();
  });
});

describe("sliderPresentation", () => {
  it("writes the art, lane, gap and insets, and the row height only when set", () => {
    const properties = sliderPresentation({ art: ART, gap: 2, inset: { left: 2 } });
    expect(properties).toEqual({
      "--ui-slider-cap-left": 4,
      "--ui-slider-cap-right": 4,
      "--ui-slider-gap": 2,
      "--ui-slider-inset-left": 2,
      "--ui-slider-inset-right": 0,
      "--ui-slider-lane-height": 16,
      "--ui-slider-thumb-height": 16,
      "--ui-slider-thumb-top": -3,
      "--ui-slider-thumb-width": 10,
      "--ui-slider-track-height": 10,
      "--ui-slider-track-top": 3,
    });
    expect(sliderPresentation({ art: ART, height: 56 })).toMatchObject({
      "--ui-form-row-height": 56,
    });
    expect(() => sliderPresentation({ art: ART, gap: 0.5 })).toThrow(RangeError);
    expect(() => sliderPresentation({ art: ART, inset: { right: -1 } })).toThrow(RangeError);
  });
});
