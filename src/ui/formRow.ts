import { ACTION_GAPS } from "./actionGroup.ts";

// Form rows: a list of labelled rows, each one whole press target with an optional icon, its label
// and note, and a trailing value stack (a switch over its state word, or a value). The list is a
// CSS grid whose columns every row shares, so the value column is as wide as the widest value
// stack without script measurement, and every label starts at the same x. Rows are the action
// group's stacked standard gap apart. The game supplies the row's height, padding and column gap,
// the icon slot, the switch's art-locked size, the state word's placement and its own text; every
// length is a whole game unit (base px at --ui-unit).

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
    "--ui-form-rows-gap": ACTION_GAPS.standard.stack,
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
