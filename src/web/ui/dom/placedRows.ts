import type { Rect } from "../../../rect.ts";
import type { ActionProjection, FormRowsRow } from "../../../ui/index.ts";

// Placed form rows (createFormRows place), shared by the list, its row kinds and press contexts.
// Not a package export.

// What a placed list hands one row: its lengths in whole CSS px, its box in the projection's
// space, and for a slider row its lane in units with the projection and art pixel that place its
// parts.
export interface RowPlacement {
  readonly box: Rect;
  readonly properties: Readonly<Record<string, number>>;
  readonly lane?: {
    readonly artPixel?: number;
    readonly project: ActionProjection;
    readonly units: Rect;
  };
}

export interface PlacedRowHooks {
  // The row's entry in the list's geometry. Throws RangeError where the row cannot be placed.
  entry(): FormRowsRow;
  // Validates the placement and returns its write, which writes it after the row's own lengths,
  // so it wins over them.
  place(placement: RowPlacement): () => void;
}

// Each kit row's hooks, by its element.
export const rowHooks = new WeakMap<HTMLElement, PlacedRowHooks>();

// Each shown placed row's box in the projection's space, by its element.
export const placedBoxes = new WeakMap<HTMLElement, Rect>();
