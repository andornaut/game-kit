import type { Rect } from "../rect.ts";
import {
  type ActionArrangement,
  type ActionGap,
  type ActionGapSelection,
  type ActionGroupContext,
  arrangeActions,
  type PlacedAction,
} from "./actionGroup.ts";
import type { ButtonSize } from "./buttonLayout.ts";
import { STACK_BUTTON_GAP } from "./spacing.ts";

// The pager: Previous, the page count and Next in one row, an action group whose one gap token
// separates the count from each button. Previous and Next are standard buttons with the group's
// press areas, clamped to half the gap toward the count; the count (text or decorative dots) takes
// no presses. The whole pager can be a footer's middle slot (pagerSize). Every length is a whole
// game unit.

// The pager's gap between the count and each button: the space between a button and its copy.
export const PAGER_GAP = {
  name: "pager",
  row: STACK_BUTTON_GAP,
  stack: STACK_BUTTON_GAP,
} as const satisfies ActionGap;

export type PagerPart = "count" | "next" | "previous";

export interface PagerSizes {
  // Each part's face in whole units: the buttons' faces and the count's box.
  readonly count: ButtonSize;
  readonly next: ButtonSize;
  readonly previous: ButtonSize;
}

// The action-group context less the parts a pager fixes: one row of three, its own gap.
export type PagerContext<T = never> = Omit<
  ActionGroupContext<PagerPart, T>,
  "axis" | "gap" | "middle" | "pressOverlap" | "stackWidth" | "variant"
> & {
  // PAGER_GAP by default; a shared token or a named override, used on both sides of the count.
  readonly gap?: ActionGapSelection;
};

export interface PagerArrangement<T = never> {
  readonly count: Rect;
  readonly gap: ActionGap;
  readonly group: Rect;
  readonly next: PlacedAction<PagerPart, T>;
  readonly previous: PlacedAction<PagerPart, T>;
}

// Which steps are available on page (from 0) of pages.
export interface PagerState {
  readonly next: boolean;
  readonly page: number;
  readonly pages: number;
  readonly previous: boolean;
}

// The pager's state. Throws RangeError unless pages is a whole number of at least 1 and page a
// whole number below it.
export function pagerState(page: number, pages: number): PagerState {
  if (!Number.isInteger(pages) || pages < 1) {
    throw new RangeError("pages must be a whole number, at least 1");
  }
  if (!Number.isInteger(page) || page < 0 || page >= pages) {
    throw new RangeError("page must be a whole number below pages");
  }
  return { next: page + 1 < pages, page, pages, previous: page > 0 };
}

// The items an action group arranges for a pager, in visual order. A DOM pager passes the same
// three to its action group, so its geometry equals arrangePager's.
export function pagerItems(sizes: PagerSizes) {
  return [
    { key: "previous", role: "secondary", size: sizes.previous },
    { key: "count", role: "secondary", size: sizes.count },
    { key: "next", role: "secondary", size: sizes.next },
  ] as const satisfies readonly { key: PagerPart; role: "secondary"; size: ButtonSize }[];
}

// The pager's size, its parts the gap apart: a footer's middle slot.
// Throws RangeError on invalid sizes or gap.
export function pagerSize(sizes: PagerSizes, gap: ActionGapSelection = PAGER_GAP): ButtonSize {
  const items = pagerItems(sizes);
  const { gap: resolved } = arrangeActions({ axis: "stack", gap, width: 0 }, []);
  const width = items.reduce((sum, item) => sum + item.size.width, 0) + 2 * resolved.row;
  const { group } = arrangeActions({ axis: "row", gap, width }, items);
  return { height: group.height, width: group.width };
}

function part<T>(
  arrangement: ActionArrangement<PagerPart, T>,
  key: PagerPart,
): PlacedAction<PagerPart, T> {
  const placed = arrangement.actions.find((action) => action.key === key);
  if (placed === undefined || placed.hidden) {
    throw new Error(`Pager part ${key} was not placed`);
  }
  return placed;
}

// Arranges the pager centred in context.width. Throws RangeError on invalid sizes or a row that
// does not fit at full size.
export function arrangePager<T = never>(
  context: PagerContext<T>,
  sizes: PagerSizes,
): PagerArrangement<T> {
  const { gap, ...rest } = context;
  const arrangement = arrangeActions<PagerPart, T>(
    { ...rest, axis: "row", gap: gap ?? PAGER_GAP },
    pagerItems(sizes),
  );
  return {
    count: part(arrangement, "count").face,
    gap: arrangement.gap,
    group: arrangement.group,
    next: part(arrangement, "next"),
    previous: part(arrangement, "previous"),
  };
}
