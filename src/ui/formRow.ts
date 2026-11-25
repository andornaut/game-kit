import type { Point, Rect } from "../rect.ts";
import { ACTION_GAPS } from "./actionGroup.ts";
import {
  type ActionProjection,
  checkArtPixel,
  IDENTITY_PROJECTION,
  projectArtRect,
  projectRect,
} from "./projection.ts";

// Form rows: a list of labelled rows, each one whole press target with an optional icon, its label
// and note, and a trailing value stack (a switch over its state word, or a value). The list is a
// CSS grid whose columns every row shares, so the value column is as wide as the widest value
// stack without script measurement, and every label starts at the same x. Rows are the layout's
// gap apart, the action group's stacked standard gap by default. The game supplies the row's
// height, padding and column gap, the icon slot, the switch's art-locked size, the state word's
// placement and its own text; every length is a whole game unit (base px at --ui-unit).

// Row content alignment down the row: top-aligned with the given offsets, or centred.
export type FormRowAlign = "center" | "start";

// The state word under the switch: centred under it, or its ink's right edge on the switch's right
// edge (the word's box moved right by its right side bearing).
export type FormStatePlacement = "center" | "end";

export interface FormRowSides {
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
}

export interface FormRowLayout {
  // The row's least height; content can grow it.
  readonly height: number;
  // Between the icon, label and value columns.
  readonly columnGap: number;
  // Between rows; ACTION_GAPS.standard.stack by default.
  readonly gap?: number;
  readonly padding?: FormRowSides;
  readonly align?: FormRowAlign;
  // The icon column's width and the icon's side; offset is its top below the row's content top
  // when aligned to the start. Omit for a list without icons.
  readonly icon?: { readonly offset?: number; readonly size: number; readonly slot: number };
  // The switch's art-locked size.
  readonly switch?: { readonly height: number; readonly width: number };
  readonly value?: {
    // The word's right side bearing, for "end" placement.
    readonly bearing?: number;
    // Between the switch and the state word.
    readonly gap?: number;
    // The value stack's top below the row's content top when aligned to the start.
    readonly offset?: number;
    readonly state?: FormStatePlacement;
    // A fixed value column width; the widest value stack (max-content) when omitted. A fixed
    // width keeps a centred switch on whole units whatever the words' widths.
    readonly track?: number;
    // The value stack's height in a placed list (formRowsGeometry), which centres the stack by it;
    // the switch's height by default.
    readonly height?: number;
  };
}

export const FORM_ROW_ATTRIBUTES = {
  align: "data-ui-form-align",
  icons: "data-ui-form-icons",
  state: "data-ui-form-state",
} as const;

export interface FormRowPresentation {
  // Attribute values for the list element, by attribute name.
  readonly attributes: Readonly<Record<string, string>>;
  // Custom properties for the list element: unitless base px, or a length for the track.
  readonly properties: Readonly<Record<string, number | string>>;
}

function whole(name: string, value: number | undefined, least = 0): void {
  if (value !== undefined && (!Number.isInteger(value) || value < least)) {
    throw new RangeError(`${name} must be a whole number of units, at least ${least}`);
  }
}

// The list's attributes and custom properties for layout. Throws RangeError on a length that is
// not a whole number of units or an unknown placement.
export function formRowPresentation(layout: FormRowLayout): FormRowPresentation {
  const { align = "center", icon, padding, value } = layout;
  const state = value?.state ?? "center";
  if (align !== "center" && align !== "start") {
    throw new RangeError("Unknown form row alignment");
  }
  if (state !== "center" && state !== "end") {
    throw new RangeError("Unknown state word placement");
  }
  whole("height", layout.height);
  whole("columnGap", layout.columnGap);
  whole("gap", layout.gap);
  for (const side of ["bottom", "left", "right", "top"] as const) {
    whole(`padding.${side}`, padding?.[side]);
  }
  whole("icon.slot", icon?.slot, 1);
  whole("icon.size", icon?.size, 1);
  whole("icon.offset", icon?.offset);
  whole("switch.width", layout.switch?.width, 1);
  whole("switch.height", layout.switch?.height, 1);
  whole("value.bearing", value?.bearing);
  whole("value.gap", value?.gap);
  whole("value.offset", value?.offset);
  whole("value.track", value?.track, 1);
  whole("value.height", value?.height);
  if (icon !== undefined && icon.size > icon.slot) {
    throw new RangeError("The icon must fit its slot");
  }
  const properties: Record<string, number | string> = {
    "--ui-form-row-column-gap": layout.columnGap,
    "--ui-form-row-height": layout.height,
    "--ui-form-row-padding-bottom": padding?.bottom ?? 0,
    "--ui-form-row-padding-left": padding?.left ?? 0,
    "--ui-form-row-padding-right": padding?.right ?? 0,
    "--ui-form-row-padding-top": padding?.top ?? 0,
    "--ui-form-rows-gap": layout.gap ?? ACTION_GAPS.standard.stack,
    "--ui-form-state-bearing": value?.bearing ?? 0,
    "--ui-form-value-gap": value?.gap ?? 0,
    "--ui-form-value-offset": value?.offset ?? 0,
  };
  if (icon !== undefined) {
    properties["--ui-form-icon-offset"] = icon.offset ?? 0;
    properties["--ui-form-icon-size"] = icon.size;
    properties["--ui-form-icon-slot"] = icon.slot;
  }
  if (layout.switch !== undefined) {
    properties["--ui-switch-height"] = layout.switch.height;
    properties["--ui-switch-width"] = layout.switch.width;
  }
  if (value?.track !== undefined) {
    properties["--ui-form-value-track"] = `calc(var(--ui-unit, 1) * ${value.track} * 1px)`;
  }
  return {
    attributes: {
      [FORM_ROW_ATTRIBUTES.align]: align,
      [FORM_ROW_ATTRIBUTES.icons]: icon === undefined ? "none" : "slot",
      [FORM_ROW_ATTRIBUTES.state]: state,
    },
    properties,
  };
}

// A row of a placed list, in the list's order: its height (the layout's by default), whether it
// is a switch row, a slider row's lane (SliderLayout: the first line's height, the gap under it,
// the lane's height and its insets from the content sides), a one-action row's face size, its
// press dip, and the gap above it from the previous row (the layout's gap by default; none above
// the first).
export interface FormRowsRow {
  readonly height?: number;
  readonly switch?: boolean;
  readonly lane?: {
    readonly gap?: number;
    readonly height: number;
    readonly inset?: { readonly left?: number; readonly right?: number };
    readonly line: number;
  };
  readonly action?: { readonly height: number; readonly width: number };
  readonly pressDip?: number;
  readonly gap?: number;
}

// A placed list: its width and corner in whole units, its shown rows, the projection that maps
// edges to the caller's space, as for arrangeActions, and artPixel, the whole output length of one
// art pixel (one unit of art), which keeps art-locked parts at their art size (projectArtRect).
export interface FormRowsContext {
  readonly width: number;
  readonly rows: readonly FormRowsRow[];
  readonly origin?: Point;
  readonly project?: ActionProjection;
  readonly artPixel?: number;
}

export interface PlacedFormRow {
  // The row's box: its face and press target, exactly its height.
  readonly row: Rect;
  // Inside the padding.
  readonly content: Rect;
  // The first line, which holds the icon, label and value: the content, or above a slider's lane.
  readonly line: Rect;
  // The icon slot and the icon art in it.
  readonly slot?: Rect;
  readonly icon?: Rect;
  readonly label: Rect;
  readonly value: Rect;
  // The value stack: the switch over its state word, at value.height.
  readonly stack: Rect;
  readonly switch?: Rect;
  readonly lane?: Rect;
  // A one-action row's face.
  readonly face?: Rect;
  // How far the row's art moves down while pressed.
  readonly pressDip?: number;
}

export interface FormRowsGeometry {
  readonly list: Rect;
  readonly rows: readonly PlacedFormRow[];
}

// Places a list's rows as formRow.css lays them out, for a caller that places every part on its
// own grid: rows exactly their heights, each its gap below the one before (the layout's gap by
// default); the padding, then the icon slot, the label column and the value column, columnGap
// apart, the value column value.track wide at the content's end. The icon is centred in its slot;
// down the first line the icon and the value stack are centred, or with align "start" at their
// offsets. A switch is at the value column's end, or for a centred state word midway along it. A
// slider's lane is gap under its first line, inset from the content sides. A one-action row's
// face is centred in its content. Each odd unit goes right or below. Every edge is projected on
// its own, but with artPixel the icon and switch keep their art size from their projected corner
// and a press dip is that many art pixels; without it a press dip is projected from the row's top.
// Throws RangeError on an invalid layout, a list without value.track, or rows that do not fit.
export function formRowsGeometry(
  layout: FormRowLayout,
  context: FormRowsContext,
): FormRowsGeometry {
  formRowPresentation(layout);
  const { artPixel, origin = { x: 0, y: 0 }, rows, width } = context;
  const project = context.project ?? IDENTITY_PROJECTION;
  whole("width", width);
  whole("origin.x", origin.x, Number.MIN_SAFE_INTEGER);
  whole("origin.y", origin.y, Number.MIN_SAFE_INTEGER);
  if (artPixel !== undefined) {
    checkArtPixel(artPixel);
  }
  const { align = "center", columnGap, icon, padding, value } = layout;
  const listGap = layout.gap ?? ACTION_GAPS.standard.stack;
  const track = value?.track;
  if (track === undefined) {
    throw new RangeError("A placed form row list needs a fixed value.track");
  }
  const pad = { bottom: 0, left: 0, right: 0, top: 0, ...padding };
  const labelX = pad.left + (icon === undefined ? 0 : icon.slot + columnGap);
  const valueX = width - pad.right - track;
  if (valueX - columnGap < labelX) {
    throw new RangeError("The form row's columns exceed its width");
  }
  const down = (box: { height: number; y: number }, height: number, offset: number | undefined) =>
    align === "start" ? box.y + (offset ?? 0) : box.y + Math.floor((box.height - height) / 2);
  const placed: PlacedFormRow[] = [];
  // Every rect from the list's corner, then moved to origin and projected: its edges on their
  // own, or for art its corner.
  const shift = (rect: Rect): Rect => ({ ...rect, x: origin.x + rect.x, y: origin.y + rect.y });
  const at = (rect: Rect): Rect => projectRect(project, shift(rect));
  const art = (rect: Rect): Rect => projectArtRect(project, artPixel, shift(rect));
  let y = 0;
  rows.forEach((entry, i) => {
    whole("row gap", entry.gap);
    if (i > 0) {
      y += entry.gap ?? listGap;
    }
    const height = entry.height ?? layout.height;
    whole("row height", height);
    whole("pressDip", entry.pressDip);
    if (pad.top + pad.bottom > height) {
      throw new RangeError("A form row's padding exceeds its height");
    }
    const content = { height: height - pad.top - pad.bottom, x: pad.left, y: y + pad.top };
    const contentWidth = width - pad.left - pad.right;
    const { action, lane } = entry;
    if (lane !== undefined) {
      whole("lane.line", lane.line);
      whole("lane.gap", lane.gap);
      whole("lane.height", lane.height, 1);
      whole("lane.inset.left", lane.inset?.left);
      whole("lane.inset.right", lane.inset?.right);
    }
    if (action !== undefined) {
      whole("action.width", action.width, 1);
      whole("action.height", action.height, 1);
      if (action.width > contentWidth || action.height > content.height) {
        throw new RangeError("A one-action row's face must fit its content");
      }
    }
    const line = { ...content, height: lane?.line ?? content.height };
    const across = (x: number, w: number): Rect => ({
      height: line.height,
      width: w,
      x,
      y: line.y,
    });
    const stackHeight = value?.height ?? (entry.switch === true ? (layout.switch?.height ?? 0) : 0);
    if (entry.switch === true && layout.switch === undefined) {
      throw new RangeError("A switch row needs the layout's switch size");
    }
    const stack = {
      height: stackHeight,
      width: track,
      x: valueX,
      y: down(line, stackHeight, value?.offset),
    };
    const sw = layout.switch;
    const left = (lane?.inset?.left ?? 0) + pad.left;
    const laneWidth = contentWidth - (lane?.inset?.left ?? 0) - (lane?.inset?.right ?? 0);
    if (lane !== undefined && laneWidth < 0) {
      throw new RangeError("A slider lane's insets exceed its row");
    }
    const row = at({ height, width, x: 0, y });
    const dip = entry.pressDip;
    placed.push({
      content: at({ ...content, width: contentWidth }),
      label: at(across(labelX, valueX - columnGap - labelX)),
      line: at({ ...line, width: contentWidth }),
      row,
      stack: at(stack),
      value: at(across(valueX, track)),
      ...(icon === undefined
        ? {}
        : {
            icon: art({
              height: icon.size,
              width: icon.size,
              x: pad.left + Math.floor((icon.slot - icon.size) / 2),
              y: down(line, icon.size, icon.offset),
            }),
            slot: at(across(pad.left, icon.slot)),
          }),
      ...(entry.switch !== true || sw === undefined
        ? {}
        : {
            switch: art({
              ...sw,
              x:
                (value?.state ?? "center") === "end"
                  ? valueX + track - sw.width
                  : valueX + Math.floor((track - sw.width) / 2),
              y: stack.y,
            }),
          }),
      ...(lane === undefined
        ? {}
        : {
            lane: at({
              height: lane.height,
              width: laneWidth,
              x: left,
              y: line.y + line.height + (lane.gap ?? 0),
            }),
          }),
      ...(action === undefined
        ? {}
        : {
            face: at({
              ...action,
              x: content.x + Math.floor((contentWidth - action.width) / 2),
              y: content.y + Math.floor((content.height - action.height) / 2),
            }),
          }),
      ...(dip === undefined
        ? {}
        : {
            pressDip:
              artPixel === undefined
                ? at({ height: dip, width: 0, x: 0, y }).height
                : dip * artPixel,
          }),
    });
    y += height;
  });
  return { list: at({ height: y, width, x: 0, y: 0 }), rows: placed };
}
