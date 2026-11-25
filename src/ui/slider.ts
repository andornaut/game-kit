import type { Point, Rect } from "../rect.ts";
import type { ActionProjection } from "./actionGroup.ts";

// Sliders: a stepped value from 0 to a set number of steps, shown as the game's track art with a
// thumb that slides along it. The track is a three-slice (fixed caps, a stretched middle) at its
// art-locked height; the fill is the same three-slice from the track's left edge to the thumb's
// right edge. The thumb's travel is the track less the thumb, so it meets both ends, and its
// offset is a whole unit with the odd half going right. Track and thumb share a lane as tall as
// the taller of them, each centred down it with the odd unit below. Every length is a whole game
// unit (base px at --ui-unit).

export interface SliderArt {
  // The thumb's art-locked size.
  readonly thumb: { readonly height: number; readonly width: number };
  // The track's art-locked height and its three-slice caps, in the art's pixels, one per unit.
  readonly track: {
    readonly caps: { readonly left: number; readonly right: number };
    readonly height: number;
  };
}

export interface SliderContext {
  readonly art: SliderArt;
  // The number of steps: the value runs from 0 to steps.
  readonly steps: number;
  // The track's width.
  readonly width: number;
  // The lane's top-left corner, at the track's left edge; (0, 0) by default.
  readonly origin?: Point;
  // Maps edges to the caller's space, as for arrangeActions.
  readonly project?: ActionProjection;
}

export interface SliderLane {
  readonly height: number;
  // The track's and the thumb's tops in the lane.
  readonly thumbTop: number;
  readonly trackTop: number;
}

export interface SliderGeometry {
  readonly fill: Rect;
  readonly lane: Rect;
  readonly thumb: Rect;
  readonly track: Rect;
}

// A slider row's layout in a form row list (web/ui/dom/slider): the art, the least row height
// where it differs from the list's, the gap from the row's first line (icon, label and value
// word) down to the lane, and the lane's insets from the row's content sides.
export interface SliderLayout {
  readonly art: SliderArt;
  readonly gap?: number;
  readonly height?: number;
  readonly inset?: { readonly left?: number; readonly right?: number };
}

function whole(name: string, value: number | undefined, least: number): void {
  if (value !== undefined && (!Number.isInteger(value) || value < least)) {
    throw new RangeError(`${name} must be a whole number of units, at least ${least}`);
  }
}

// Validates the art. Throws RangeError on a size that is not a whole positive unit, or on caps
// wider than the thumb: the fill is at least the thumb wide, so it must hold both caps.
export function checkSliderArt(art: SliderArt): void {
  whole("thumb.width", art.thumb.width, 1);
  whole("thumb.height", art.thumb.height, 1);
  whole("track.height", art.track.height, 1);
  whole("track.caps.left", art.track.caps.left, 0);
  whole("track.caps.right", art.track.caps.right, 0);
  if (art.track.caps.left + art.track.caps.right > art.thumb.width) {
    throw new RangeError("The track's caps must fit within the thumb's width");
  }
}

// Validates a step count. Throws RangeError unless it is a whole number of at least 1.
export function checkSliderSteps(steps: number): void {
  if (!Number.isInteger(steps) || steps < 1) {
    throw new RangeError("steps must be a whole number, at least 1");
  }
}

// Validates a step. Throws RangeError unless it is a whole number from 0 to steps.
export function checkSliderStep(steps: number, step: number): void {
  checkSliderSteps(steps);
  if (!Number.isInteger(step) || step < 0 || step > steps) {
    throw new RangeError(`step must be a whole number from 0 to ${steps}`);
  }
}

function checkContext(context: SliderContext): void {
  checkSliderArt(context.art);
  checkSliderSteps(context.steps);
  whole("width", context.width, context.art.thumb.width);
}

// The step a key moves the slider to from step: ArrowLeft and ArrowRight one step down or up,
// held to the ends, Home to 0 and End to steps. Undefined for any other key (KeyboardEvent.key).
export function sliderStepForKey(steps: number, step: number, key: string): number | undefined {
  checkSliderStep(steps, step);
  switch (key) {
    case "ArrowLeft":
      return Math.max(0, step - 1);
    case "ArrowRight":
      return Math.min(steps, step + 1);
    case "Home":
      return 0;
    case "End":
      return steps;
    default:
      return undefined;
  }
}

// The thumb's left edge at step, in whole units from the track's left edge: the travel's share,
// a half rounded right. Throws RangeError on an invalid context or step.
export function sliderThumbOffset(context: SliderContext, step: number): number {
  checkContext(context);
  checkSliderStep(context.steps, step);
  const travel = context.width - context.art.thumb.width;
  return Math.floor((2 * travel * step + context.steps) / (2 * context.steps));
}

// The step a press at x (units from the track's left edge, fractional allowed) picks: the
// thumb's centre follows the press, held to the track, and the nearest step wins, a half
// rounding up. A track no wider than its thumb has one place, step 0.
export function sliderStepAt(context: SliderContext, x: number): number {
  checkContext(context);
  if (!Number.isFinite(x)) {
    throw new RangeError("x must be finite");
  }
  const travel = context.width - context.art.thumb.width;
  if (travel === 0) {
    return 0;
  }
  const along = Math.min(travel, Math.max(0, x - context.art.thumb.width / 2));
  return Math.round((along * context.steps) / travel);
}

// The lane's height and the track's and thumb's tops in it.
export function sliderLane(art: SliderArt): SliderLane {
  checkSliderArt(art);
  const height = Math.max(art.thumb.height, art.track.height);
  return {
    height,
    thumbTop: Math.floor((height - art.thumb.height) / 2),
    trackTop: Math.floor((height - art.track.height) / 2),
  };
}

// The lane, the track, the fill and the thumb at step in the caller's space. Throws RangeError
// on an invalid context, step or projection.
export function sliderGeometry(context: SliderContext, step: number): SliderGeometry {
  const offset = sliderThumbOffset(context, step);
  const { art, origin = { x: 0, y: 0 }, width } = context;
  const project = context.project ?? { x: (edge: number) => edge, y: (edge: number) => edge };
  whole("origin.x", origin.x, Number.MIN_SAFE_INTEGER);
  whole("origin.y", origin.y, Number.MIN_SAFE_INTEGER);
  const lane = sliderLane(art);
  const place = (x: number, y: number, w: number, h: number): Rect => {
    const left = project.x(origin.x + x);
    const top = project.y(origin.y + y);
    const right = project.x(origin.x + x + w);
    const bottom = project.y(origin.y + y + h);
    for (const edge of [left, top, right, bottom]) {
      if (!Number.isInteger(edge)) {
        throw new RangeError("A projection must map edges to whole numbers");
      }
    }
    if (right < left || bottom < top) {
      throw new RangeError("A projection must keep edges in order");
    }
    return { height: bottom - top, width: right - left, x: left, y: top };
  };
  return {
    fill: place(0, lane.trackTop, offset + art.thumb.width, art.track.height),
    lane: place(0, 0, width, lane.height),
    thumb: place(offset, lane.thumbTop, art.thumb.width, art.thumb.height),
    track: place(0, lane.trackTop, width, art.track.height),
  };
}

// A slider row's custom properties: unitless base px for its art, lane and insets, and the row
// height where the layout sets one. Throws RangeError on a length that is not a whole unit.
export function sliderPresentation(layout: SliderLayout): Readonly<Record<string, number>> {
  const { art, gap, height, inset } = layout;
  const lane = sliderLane(art);
  whole("gap", gap, 0);
  whole("height", height, 0);
  whole("inset.left", inset?.left, 0);
  whole("inset.right", inset?.right, 0);
  return {
    "--ui-slider-cap-left": art.track.caps.left,
    "--ui-slider-cap-right": art.track.caps.right,
    "--ui-slider-gap": gap ?? 0,
    "--ui-slider-inset-left": inset?.left ?? 0,
    "--ui-slider-inset-right": inset?.right ?? 0,
    "--ui-slider-lane-height": lane.height,
    "--ui-slider-thumb-height": art.thumb.height,
    "--ui-slider-thumb-top": lane.thumbTop - lane.trackTop,
    "--ui-slider-thumb-width": art.thumb.width,
    "--ui-slider-track-height": art.track.height,
    "--ui-slider-track-top": lane.trackTop,
    ...(height === undefined ? {} : { "--ui-form-row-height": height }),
  };
}
