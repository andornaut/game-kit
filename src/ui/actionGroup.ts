import type { Point, Rect } from "../rect.ts";
import type { ButtonRole, ButtonSize } from "./buttonLayout.ts";
import { HIT_RULE, hitMargin, type HitRule, pressedArea } from "./hitAreas.ts";
import { BUTTON_GAP, SMALL_BUTTON_GAP, STACK_BUTTON_GAP } from "./spacing.ts";

// Action groups: a row or a stack of action faces that owns the spacing between them and each
// face's press area. Every input and output is a whole game unit. Layout boxes equal the drawn
// faces (outer ink bounds, lip included); gaps are measured between them. Each press area reaches
// past its face by the press margin, clamped toward a neighbour to its share of the space between
// them, so press areas never overlap and never change layout; with nearest overlap they keep their
// full size and a press goes to the nearest face centre. Where a length splits unevenly the
// odd unit goes to the right or bottom side: centring leaves it after the content, and the later
// of two neighbours takes it of the space between them.

export type ActionAxis = "row" | "stack";

// group: a centred row or stack. footer: pinned edges, secondary actions from the left edge, the
// primary at the right edge and an optional middle slot (a pager) centred between them.
export type ActionVariant = "group" | "footer";

// The gaps between neighbouring faces side by side (row) and stacked (stack). A game names an
// override for an exempt layout, so every exception stays explicit and searchable. These are
// separate from the layout tree's row, group and panel spacing.
export interface ActionGap {
  readonly name: string;
  readonly row: number;
  readonly stack: number;
}

export const ACTION_GAPS = {
  small: { name: "small", row: SMALL_BUTTON_GAP, stack: SMALL_BUTTON_GAP },
  standard: { name: "standard", row: BUTTON_GAP, stack: STACK_BUTTON_GAP },
} as const satisfies Record<string, ActionGap>;

export type ActionGapSelection = keyof typeof ACTION_GAPS | ActionGap;

// How far a press area reaches past its face before clamping: the shared hit rule (rounded up to a
// whole unit and grown to its minimum target) or a fixed margin.
export type ActionPress = HitRule | { readonly margin: number };

// How press areas meet between neighbouring actions. clamp: each outset is clamped to its share of
// the space between the faces, so press areas never overlap. nearest: each press area keeps its
// full size and may overlap a neighbour's; a press goes to the action whose face centre is nearest
// (pressedAction). Toward a footer's middle slot both clamp.
export type ActionPressOverlap = "clamp" | "nearest";

// Maps a whole-unit edge to the caller's output space, such as integer device pixels. Each axis
// must be nondecreasing and return whole numbers. Neighbours share projected edges, so projection
// keeps press areas touching without overlap.
export interface ActionProjection {
  x(edge: number): number;
  y(edge: number): number;
}

export interface ActionOutset {
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
}

export interface ActionItem<K> {
  readonly key: K;
  readonly role: ButtonRole;
  // The face's outer ink bounds, lip included: data sizes or measured labels plus padding.
  readonly size: ButtonSize;
  // Hidden actions keep their identity but take no space and do not count.
  readonly hidden?: boolean;
  // Art-locked faces keep their size in a stack instead of stretching to the shared width.
  readonly locked?: boolean;
}

export interface ActionGroupContext<K = unknown, T = never> {
  // The room across, in whole units. A row that does not fit stacks.
  readonly width: number;
  readonly axis?: "auto" | ActionAxis;
  readonly gap?: ActionGapSelection;
  // The footer's middle slot size; footer only.
  readonly middle?: ButtonSize;
  readonly origin?: Point;
  readonly press?: ActionPress;
  readonly pressOverlap?: ActionPressOverlap;
  readonly project?: ActionProjection;
  // Stacked faces share the widest face's width (content) or the whole room (fill).
  readonly stackWidth?: "content" | "fill";
  readonly variant?: ActionVariant;
  // The game's text placement, from the projected face. Omit to leave text to the game.
  readonly placeText?: (face: Rect, item: ActionItem<K>) => T;
}

export interface PlacedAction<K, T = never> {
  readonly face: Rect;
  readonly hidden: false;
  readonly key: K;
  // The place in visual order among visible actions: secondary actions first, primary last.
  readonly order: number;
  // How far the action takes presses past its face: the press area, or with nearest overlap the
  // part of it where this face's centre is nearest along the group's axis (what the DOM draws).
  readonly outset: ActionOutset;
  // The press area. With nearest overlap it may overlap a neighbour's.
  readonly press: Rect;
  readonly role: ButtonRole;
  readonly text?: T;
}

export interface HiddenAction<K> {
  readonly hidden: true;
  readonly key: K;
  readonly role: ButtonRole;
}

export interface ActionArrangement<K, T = never> {
  // In the caller's order.
  readonly actions: readonly (HiddenAction<K> | PlacedAction<K, T>)[];
  readonly axis: ActionAxis;
  readonly gap: ActionGap;
  // The group box: the whole room across and the content's height.
  readonly group: Rect;
  readonly middle?: Rect;
  readonly pressOverlap: ActionPressOverlap;
  readonly variant: ActionVariant;
}

const IDENTITY: ActionProjection = { x: (edge) => edge, y: (edge) => edge };

function whole(name: string, value: number, least = 0): void {
  if (!Number.isInteger(value) || value < least) {
    throw new RangeError(`${name} must be a whole number of units, at least ${least}`);
  }
}

function resolveGap(selection: ActionGapSelection): ActionGap {
  if (typeof selection === "string") {
    if (!Object.hasOwn(ACTION_GAPS, selection)) {
      throw new RangeError(`Unknown action gap: ${selection}`);
    }
    return ACTION_GAPS[selection];
  }
  if (selection.name.trim() === "" || Object.hasOwn(ACTION_GAPS, selection.name)) {
    throw new RangeError("An action gap override needs its own nonempty name");
  }
  whole("gap.row", selection.row);
  whole("gap.stack", selection.stack);
  return { name: selection.name, row: selection.row, stack: selection.stack };
}

// Space either side of a face along one axis, before and after it.
interface Span {
  after: number;
  before: number;
}

function desiredOutset(press: ActionPress, size: ButtonSize): { x: Span; y: Span } {
  if ("margin" in press) {
    const span = () => ({ after: press.margin, before: press.margin });
    return { x: span(), y: span() };
  }
  const margin = Math.ceil(hitMargin(press, { ...size, x: 0, y: 0 }));
  const grow = (length: number): Span => {
    const extra = Math.max(0, Math.ceil(press.minTarget) - (length + 2 * margin));
    return { after: margin + Math.ceil(extra / 2), before: margin + Math.floor(extra / 2) };
  };
  return { x: grow(size.width), y: grow(size.height) };
}

function validatePress(press: ActionPress): void {
  if ("margin" in press) {
    whole("press.margin", press.margin);
    return;
  }
  for (const name of ["leastMargin", "marginShare", "minTarget", "mostMargin"] as const) {
    if (!Number.isFinite(press[name]) || press[name] < 0) {
      throw new RangeError(`press.${name} must be finite and nonnegative`);
    }
  }
}

// An entry along the layout axis: an action or the footer's middle slot.
interface Entry {
  readonly face: { x: number; y: number; width: number; height: number };
  readonly item?: ActionItem<unknown>;
  readonly outset?: { x: Span; y: Span };
}

function placeRow(
  context: { gap: number; middle?: ButtonSize; variant: ActionVariant; width: number },
  actions: readonly ActionItem<unknown>[],
): Entry[] | undefined {
  const { gap, middle, variant, width } = context;
  const sized = (size: ButtonSize, x: number, item?: ActionItem<unknown>): Entry => ({
    face: { height: size.height, width: size.width, x, y: 0 },
    ...(item === undefined ? {} : { item }),
  });
  let entries: Entry[];
  if (variant === "group" || (middle === undefined && actions.length <= 1)) {
    const total =
      actions.reduce((sum, item) => sum + item.size.width, 0) +
      Math.max(0, actions.length - 1) * gap;
    if (total > width) {
      return undefined;
    }
    let x = Math.floor((width - total) / 2);
    entries = actions.map((item) => {
      const entry = sized(item.size, x, item);
      x += item.size.width + gap;
      return entry;
    });
  } else {
    const primary = actions.find((item) => item.role === "primary");
    let x = 0;
    entries = actions
      .filter((item) => item !== primary)
      .map((item) => {
        const entry = sized(item.size, x, item);
        x += item.size.width + gap;
        return entry;
      });
    if (middle !== undefined) {
      entries.push(sized(middle, Math.floor((width - middle.width) / 2)));
    }
    if (primary !== undefined) {
      entries.push(sized(primary.size, width - primary.size.width, primary));
    }
    for (let index = 1; index < entries.length; index += 1) {
      const previous = entries[index - 1]!.face;
      if (entries[index]!.face.x - (previous.x + previous.width) < gap) {
        return undefined;
      }
    }
    if (entries.some(({ face }) => face.x < 0 || face.x + face.width > width)) {
      return undefined;
    }
  }
  const height = Math.max(0, ...entries.map(({ face }) => face.height));
  for (const { face } of entries) {
    face.y = Math.floor((height - face.height) / 2);
  }
  return entries;
}

function placeStack(
  context: {
    gap: number;
    middle?: ButtonSize;
    stackWidth: "content" | "fill";
    width: number;
  },
  actions: readonly ActionItem<unknown>[],
): Entry[] {
  const { gap, middle, stackWidth, width } = context;
  const widest = Math.max(0, ...actions.map((item) => item.size.width));
  const column = stackWidth === "fill" ? width : widest;
  if (widest > width || (middle !== undefined && middle.width > width)) {
    throw new RangeError("Action stack exceeds its room at full size");
  }
  const left = Math.floor((width - column) / 2);
  let y = 0;
  const entry = (size: ButtonSize, x: number, faceWidth: number, item?: ActionItem<unknown>) => {
    const placed: Entry = {
      face: { height: size.height, width: faceWidth, x, y },
      ...(item === undefined ? {} : { item }),
    };
    y += size.height + gap;
    return placed;
  };
  const entries: Entry[] = [];
  if (middle !== undefined) {
    entries.push(entry(middle, Math.floor((width - middle.width) / 2), middle.width));
  }
  for (const item of actions) {
    entries.push(
      item.locked === true
        ? entry(item.size, left + Math.floor((column - item.size.width) / 2), item.size.width, item)
        : entry(item.size, left, column, item),
    );
  }
  return entries;
}

// Clamps each pair of neighbours' outsets toward each other to their share of the space between
// their faces: the earlier takes the lower half, the later the odd unit.
function clampNeighbours(axis: ActionAxis, entries: readonly Entry[]): void {
  const along = axis === "row" ? "x" : "y";
  const length = axis === "row" ? "width" : "height";
  for (let index = 1; index < entries.length; index += 1) {
    const previous = entries[index - 1]!;
    const next = entries[index]!;
    const space = next.face[along] - (previous.face[along] + previous.face[length]);
    const share = Math.floor(space / 2);
    if (previous.outset !== undefined) {
      previous.outset[along].after = Math.min(previous.outset[along].after, share);
    }
    if (next.outset !== undefined) {
      next.outset[along].before = Math.min(next.outset[along].before, space - share);
    }
  }
}

// Cuts each pair of neighbouring actions' outsets toward each other at the whole-unit edge where
// the nearer face centre changes, a tie going to the earlier action; toward a middle slot it
// clamps as clampNeighbours does.
function routeNeighbours(axis: ActionAxis, entries: readonly Entry[]): void {
  const along = axis === "row" ? "x" : "y";
  const length = axis === "row" ? "width" : "height";
  for (let index = 1; index < entries.length; index += 1) {
    const previous = entries[index - 1]!;
    const next = entries[index]!;
    const end = previous.face[along] + previous.face[length];
    const start = next.face[along];
    const space = start - end;
    let edge = end + Math.floor(space / 2);
    if (previous.item !== undefined && next.item !== undefined) {
      // A unit cell [k, k + 1) is the earlier action's while its centre k + 1/2 is no nearer the
      // later face's centre, so the cut falls at floor(midpoint + 1/2).
      const centres =
        previous.face[along] + previous.face[length] / 2 + start + next.face[length] / 2;
      edge = Math.min(start, Math.max(end, Math.floor(centres / 2 + 1 / 2)));
    }
    if (previous.outset !== undefined) {
      previous.outset[along].after = Math.min(previous.outset[along].after, edge - end);
    }
    if (next.outset !== undefined) {
      next.outset[along].before = Math.min(next.outset[along].before, start - edge);
    }
  }
}

function project(projection: ActionProjection, rect: Rect): Rect {
  const left = projection.x(rect.x);
  const right = projection.x(rect.x + rect.width);
  const top = projection.y(rect.y);
  const bottom = projection.y(rect.y + rect.height);
  for (const edge of [left, right, top, bottom]) {
    if (!Number.isInteger(edge)) {
      throw new RangeError("A projection must map edges to whole numbers");
    }
  }
  if (right < left || bottom < top) {
    throw new RangeError("A projection must keep edges in order");
  }
  return { height: bottom - top, width: right - left, x: left, y: top };
}

// Arranges actions as a row when they fit in context.width at full size, otherwise as a stack.
// Secondary actions keep the caller's order and the primary goes last: rightmost in a row, at the
// bottom of a stack. A sole visible action is centred, including in a footer without a middle
// slot. A stacked footer puts the middle slot first. At most one visible action is primary.
// Invalid input, a forced row that does not fit, or a stack wider than its room throws RangeError.
export function arrangeActions<K, T = never>(
  context: ActionGroupContext<K, T>,
  items: readonly ActionItem<K>[],
): ActionArrangement<K, T> {
  const {
    axis = "auto",
    middle,
    origin = { x: 0, y: 0 },
    press = HIT_RULE,
    pressOverlap = "clamp",
    project: projection = IDENTITY,
    stackWidth = "content",
    variant = "group",
    width,
  } = context;
  whole("width", width);
  whole("origin.x", origin.x, Number.MIN_SAFE_INTEGER);
  whole("origin.y", origin.y, Number.MIN_SAFE_INTEGER);
  if (axis !== "auto" && axis !== "row" && axis !== "stack") {
    throw new RangeError("Unknown action axis");
  }
  if (variant !== "group" && variant !== "footer") {
    throw new RangeError("Unknown action variant");
  }
  if (stackWidth !== "content" && stackWidth !== "fill") {
    throw new RangeError("Unknown stack width");
  }
  if (pressOverlap !== "clamp" && pressOverlap !== "nearest") {
    throw new RangeError("Unknown press overlap");
  }
  if (middle !== undefined) {
    if (variant !== "footer") {
      throw new RangeError("Only a footer has a middle slot");
    }
    whole("middle.width", middle.width, 1);
    whole("middle.height", middle.height, 1);
  }
  const gap = resolveGap(context.gap ?? "standard");
  validatePress(press);
  const keys = new Set<K>();
  for (const item of items) {
    if (item.role !== "primary" && item.role !== "secondary" && item.role !== "navigation") {
      throw new RangeError("Unknown button role");
    }
    whole("size.width", item.size.width, 1);
    whole("size.height", item.size.height, 1);
    if (keys.has(item.key)) {
      throw new RangeError("Action keys must be unique");
    }
    keys.add(item.key);
  }
  const visible = items.filter((item) => item.hidden !== true);
  if (visible.filter((item) => item.role === "primary").length > 1) {
    throw new RangeError("An action group has at most one visible primary action");
  }
  const ordered = [
    ...visible.filter((item) => item.role !== "primary"),
    ...visible.filter((item) => item.role === "primary"),
  ];
  let placedAxis: ActionAxis = "row";
  let entries =
    axis === "stack"
      ? undefined
      : placeRow(
          { gap: gap.row, variant, width, ...(middle === undefined ? {} : { middle }) },
          ordered,
        );
  if (entries === undefined) {
    if (axis === "row") {
      throw new RangeError("Action row does not fit its room at full size");
    }
    placedAxis = "stack";
    entries = placeStack(
      { gap: gap.stack, stackWidth, width, ...(middle === undefined ? {} : { middle }) },
      ordered,
    );
  }
  const withOutsets = entries.map((entry) =>
    entry.item === undefined ? entry : { ...entry, outset: desiredOutset(press, entry.item.size) },
  );
  // The full press areas, kept with nearest overlap.
  const full = withOutsets.map(({ outset }) =>
    outset === undefined ? undefined : { x: { ...outset.x }, y: { ...outset.y } },
  );
  if (pressOverlap === "nearest") {
    routeNeighbours(placedAxis, withOutsets);
  } else {
    clampNeighbours(placedAxis, withOutsets);
  }
  const height =
    placedAxis === "row"
      ? Math.max(0, ...withOutsets.map(({ face }) => face.height))
      : withOutsets.reduce((sum, { face }) => sum + face.height, 0) +
        Math.max(0, withOutsets.length - 1) * gap.stack;
  const shift = (rect: Rect): Rect => ({ ...rect, x: rect.x + origin.x, y: rect.y + origin.y });
  const placed = new Map<K, PlacedAction<K, T>>();
  let middleRect: Rect | undefined;
  const around = (entry: Entry, outset: { x: Span; y: Span }) =>
    project(
      projection,
      shift({
        height: entry.face.height + outset.y.before + outset.y.after,
        width: entry.face.width + outset.x.before + outset.x.after,
        x: entry.face.x - outset.x.before,
        y: entry.face.y - outset.y.before,
      }),
    );
  for (const [index, entry] of withOutsets.entries()) {
    const face = project(projection, shift(entry.face));
    if (entry.item === undefined) {
      middleRect = face;
      continue;
    }
    const taken = around(entry, entry.outset!);
    const pressRect = pressOverlap === "nearest" ? around(entry, full[index]!) : taken;
    const item = entry.item as ActionItem<K>;
    placed.set(item.key, {
      face,
      hidden: false,
      key: item.key,
      order: placed.size,
      outset: {
        bottom: taken.y + taken.height - (face.y + face.height),
        left: face.x - taken.x,
        right: taken.x + taken.width - (face.x + face.width),
        top: face.y - taken.y,
      },
      press: pressRect,
      role: item.role,
      ...(context.placeText === undefined ? {} : { text: context.placeText(face, item) }),
    });
  }
  return {
    actions: items.map(
      (item) => placed.get(item.key) ?? { hidden: true, key: item.key, role: item.role },
    ),
    axis: placedAxis,
    gap,
    group: project(projection, shift({ height, width, x: 0, y: 0 })),
    ...(middleRect === undefined ? {} : { middle: middleRect }),
    pressOverlap,
    variant,
  };
}

// The action a press at point lands on: of the visible actions whose press area takes it in,
// the one whose face centre is nearest, the earlier in the caller's order on a tie (hitAreas
// pressedArea). Point is in the arrangement's projected space.
export function pressedAction<K, T>(
  arrangement: ActionArrangement<K, T>,
  point: Point,
): K | undefined {
  return pressedArea(
    arrangement.actions.flatMap((action) =>
      action.hidden ? [] : [{ art: action.face, hit: action.press, key: action.key }],
    ),
    point,
  );
}
