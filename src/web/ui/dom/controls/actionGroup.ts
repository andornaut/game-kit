import type { Rect } from "../../../../rect.ts";
import {
  type ActionArrangement,
  type ActionGridArrangement,
  type ActionGridContext,
  type ActionGroupContext,
  arrangeActionGrid,
  arrangeActions,
  type PressMember,
  separatePressAreas,
} from "../../../../ui/actions/actionGroup.ts";
import type { ButtonRole, ButtonSize } from "../../../../ui/actions/buttonLayout.ts";
import { writeLayoutProperties } from "../layoutProperties.ts";
import { readUnit } from "../viewUnits.ts";
import { placedBoxes } from "./placedRows.ts";

// The HTML action group (actionGroup.css): the group element holds the game's action elements as
// direct children and places each one by the pure arrangement, in base px times --ui-unit, or
// with a projection in whole CSS px on the game's grid (--ui-action-length: 1px). Layout
// boxes equal the faces. Each action's press area is its ::before, outset by the arranged press
// outsets, so it takes presses as the action without changing layout. A clipping ancestor (an
// overflow scroller) clips the outsets that reach past it. DOM order, focus order and identities
// stay the caller's; hidden elements take no space. A press context (createPressContext) clamps
// the press areas of neighbouring groups, and of a group and a form row, toward each other.

export const ACTION_GROUP_CLASS = "ui-action-group";
export const ACTION_CLASS = "ui-action";
export const ACTION_MIDDLE_CLASS = "ui-action-middle";
export const ACTION_MEASURING_ATTRIBUTE = "data-ui-action-measuring";
export const ACTION_PROJECTED_ATTRIBUTE = "data-ui-action-projected";

const BOX = ["x", "y", "width", "height"] as const;
const SIDES = ["top", "right", "bottom", "left"] as const;
const PROPERTIES = [
  ...BOX.map((field) => `--ui-action-${field}`),
  ...SIDES.map((side) => `--ui-action-outset-${side}`),
];

export interface DomAction {
  // A direct child of the group element. Its hidden attribute hides the action.
  readonly element: HTMLElement;
  readonly role: ButtonRole;
  // The face's size in whole base px, from data or measure().
  readonly size: ButtonSize;
  readonly locked?: boolean;
}

// The pure context less text placement. The footer's middle slot is a direct child the game
// supplies, such as a pager. Without project the DOM places in base px from the group's corner.
// With project, origin is the group's corner in the game's units and the arrangement is in the
// projection's space, written in whole CSS px from the group's projected corner (group.x and
// group.y), where the game places the element. origin takes project.
export type DomActionGroupContext = Omit<
  ActionGroupContext<HTMLElement>,
  "middle" | "placeText"
> & {
  readonly middle?: { readonly element: HTMLElement; readonly size: ButtonSize };
};

// The pure grid context less text placement, with origin and project as for a group.
export type DomActionGridContext = Omit<ActionGridContext<HTMLElement>, "placeText">;

export interface ActionGroupView {
  readonly element: HTMLElement;
  // Places the actions and returns the arrangement keyed by element. Throws, before any change,
  // on invalid input or an element that is not a direct child.
  arrange(
    context: DomActionGroupContext,
    actions: readonly DomAction[],
  ): ActionArrangement<HTMLElement>;
  // Places the actions in rows of columns (arrangeActionGrid), as arrange does.
  arrangeGrid(
    context: DomActionGridContext,
    actions: readonly DomAction[],
  ): ActionGridArrangement<HTMLElement>;
  // Each element's natural face size in whole base px, rounded up, measured at max-content with
  // the group's placement suspended. Measure after fonts load and labels change.
  measure(elements: readonly HTMLElement[]): ButtonSize[];
  // Removes the group's marks from the actions it placed. The elements stay where they are.
  dispose(): void;
}

function clear(element: HTMLElement): void {
  element.classList.remove(ACTION_CLASS, ACTION_MIDDLE_CLASS);
  for (const name of PROPERTIES) {
    element.style.removeProperty(name);
  }
}

// A rect's properties from the group's corner: (0, 0) unprojected, its projected corner otherwise.
function box(rect: Rect, corner: { readonly x: number; readonly y: number }) {
  const local = { ...rect, x: rect.x - corner.x, y: rect.y - corner.y };
  return Object.fromEntries(BOX.map((field) => [`--ui-action-${field}`, local[field]]));
}

type Arranged = ActionArrangement<HTMLElement> | ActionGridArrangement<HTMLElement>;

function writeOutsets(arrangement: Arranged): void {
  for (const action of arrangement.actions) {
    if (!action.hidden) {
      writeLayoutProperties(
        Object.fromEntries(
          SIDES.map((side) => [`--ui-action-outset-${side}`, action.outset[side]]),
        ),
        action.key,
      );
    }
  }
}

// What a press context needs of a group: its own last arrangement, whether it is in a
// projection's space, and its context.
interface GroupState {
  arranged?: Arranged;
  context?: PressContext;
  disposed?: true;
  projected?: boolean;
}

// By the group's element, so a view that wraps a group (a modal frame's footer) is the group.
const groupStates = new WeakMap<HTMLElement, GroupState>();

function checkOrigin(context: { readonly origin?: unknown; readonly project?: unknown }): void {
  if (context.origin !== undefined && context.project === undefined) {
    throw new RangeError("An action group's origin takes a projection");
  }
}

export function createActionGroup(
  document: Document,
  options: { readonly className?: string } = {},
): ActionGroupView {
  const element = document.createElement("div");
  element.className = options.className ?? "";
  element.classList.add(ACTION_GROUP_CLASS);
  const marked = new Set<HTMLElement>();
  let disposed = false;
  const assertLive = () => {
    if (disposed) {
      throw new Error("Action group has been disposed");
    }
  };
  const state: GroupState = {};
  const children = (actions: readonly DomAction[], middle?: HTMLElement) => {
    for (const child of [...actions.map((action) => action.element), middle]) {
      if (child !== undefined && child.parentElement !== element) {
        throw new RangeError("Actions and the middle slot must be direct children of the group");
      }
    }
    return actions.map((action) => ({
      hidden: action.element.hidden !== false,
      key: action.element,
      role: action.role,
      size: action.size,
      ...(action.locked === undefined ? {} : { locked: action.locked }),
    }));
  };
  const place = (
    arrangement: Arranged,
    actions: readonly DomAction[],
    projected: boolean,
    middle?: { readonly element: HTMLElement },
  ) => {
    const corner = arrangement.group;
    const current = new Set(actions.map((action) => action.element));
    if (middle !== undefined) {
      current.add(middle.element);
    }
    for (const previous of marked) {
      if (!current.has(previous)) {
        clear(previous);
        marked.delete(previous);
      }
    }
    writeLayoutProperties(
      {
        "--ui-action-group-height": arrangement.group.height,
        "--ui-action-group-width": arrangement.group.width,
      },
      element,
    );
    element.setAttribute("data-ui-action-axis", arrangement.axis);
    element.setAttribute(
      "data-ui-action-variant",
      "variant" in arrangement ? arrangement.variant : "group",
    );
    element.setAttribute("data-ui-action-gap", arrangement.gap.name);
    element.toggleAttribute(ACTION_PROJECTED_ATTRIBUTE, projected);
    for (const action of arrangement.actions) {
      const child = action.key;
      marked.add(child);
      child.classList.add(ACTION_CLASS);
      if (action.hidden) {
        for (const name of PROPERTIES) {
          child.style.removeProperty(name);
        }
        continue;
      }
      writeLayoutProperties(
        {
          ...box(action.face, corner),
          ...Object.fromEntries(
            SIDES.map((side) => [`--ui-action-outset-${side}`, action.outset[side]]),
          ),
        },
        child,
      );
    }
    if (middle !== undefined && "middle" in arrangement && arrangement.middle !== undefined) {
      marked.add(middle.element);
      middle.element.classList.add(ACTION_MIDDLE_CLASS);
      writeLayoutProperties(box(arrangement.middle, corner), middle.element);
    }
    state.arranged = arrangement;
    state.projected = projected;
    state.context?.apply();
  };
  const view: ActionGroupView = {
    arrange(context, actions) {
      assertLive();
      checkOrigin(context);
      const { middle, ...rest } = context;
      const items = children(actions, middle?.element);
      const arrangement = arrangeActions(
        { ...rest, ...(middle === undefined ? {} : { middle: middle.size }) },
        items,
      );
      place(arrangement, actions, context.project !== undefined, middle);
      return arrangement;
    },
    arrangeGrid(context, actions) {
      assertLive();
      checkOrigin(context);
      const arrangement = arrangeActionGrid(context, children(actions));
      place(arrangement, actions, context.project !== undefined);
      return arrangement;
    },
    dispose() {
      if (disposed) {
        return;
      }
      state.context?.remove(view);
      state.disposed = true;
      delete state.arranged;
      disposed = true;
      for (const child of marked) {
        clear(child);
      }
      marked.clear();
    },
    element,
    measure(elements) {
      assertLive();
      const unit = readUnit(element);
      element.setAttribute(ACTION_MEASURING_ATTRIBUTE, "");
      try {
        return elements.map((child) => {
          const rect = child.getBoundingClientRect();
          // A rounding allowance keeps an exact length from rounding up a whole unit.
          const whole = (length: number) => Math.max(0, Math.ceil(length / unit - 1e-6));
          return { height: whole(rect.height), width: whole(rect.width) };
        });
      } finally {
        element.removeAttribute(ACTION_MEASURING_ATTRIBUTE);
      }
    },
  };
  groupStates.set(element, state);
  return view;
}

// Shared press clamping for neighbouring members: action groups and elements whose box is their
// own press target, such as form rows. apply() measures where each shown member is under root, in
// whole base px at root's --ui-unit, and writes each group's press outsets clamped toward the
// other members' faces and boxes (separatePressAreas), so their press areas meet without overlap
// and no member needs a stacking order or an inset. It measures each member at its layout
// position: the box as drawn less the CSS translate of the member and of each ancestor below root,
// so a refusal shake or press shift that is playing moves no clamp. Apply after layout. A member
// group's arrange() and arrangeGrid() apply it again; apply after anything else moves a member.
// With projected groups the members share the projection's space instead: each group is as
// arranged, each element its placed form row box (createFormRows place), nothing is measured, and
// every group must be projected with the same projection.
export interface PressContext {
  // Adds a group, or an element that is its own press target. A view that wraps a group, such as
  // a modal frame's footer, is that group. Throws on a group already in another context or one
  // disposed.
  add(member: ActionGroupView | HTMLElement): void;
  // Removes a member; a group's outsets return to its own.
  remove(member: ActionGroupView | HTMLElement): void;
  apply(): void;
  // Removes every member.
  dispose(): void;
}

// The computed CSS translate of element in px, x then y. A percentage is of its layout box; a
// value other than a length or percentage counts as 0.
function translateOf(element: HTMLElement): readonly [number, number] {
  const value =
    element.ownerDocument.defaultView?.getComputedStyle(element).getPropertyValue("translate") ??
    "";
  const [x = "0", y = "0"] = value.trim() === "none" ? [] : value.trim().split(/\s+/);
  const length = (token: string, size: number) => {
    const number = Number.parseFloat(token);
    if (!Number.isFinite(number)) {
      return 0;
    }
    return token.endsWith("%") ? (number * size) / 100 : number;
  };
  return [length(x, element.offsetWidth), length(y, element.offsetHeight)];
}

export function createPressContext(root: HTMLElement): PressContext {
  // Each member's element: a group's, or the element that is its own press target.
  const members = new Map<HTMLElement, GroupState | undefined>();
  const elementOf = (member: ActionGroupView | HTMLElement) =>
    "arrange" in member ? member.element : member;
  const shown = (element: HTMLElement) =>
    element.isConnected && element.closest("[hidden]") === null;
  // Projected groups are already in the projection's one space, and a placed form row takes its
  // placed box, so nothing is measured.
  const applyProjected = () => {
    const placed = [...members].flatMap(([element, state]): PressMember<HTMLElement>[] => {
      if (!shown(element)) {
        return [];
      }
      if (state === undefined) {
        const box = placedBoxes.get(element);
        return box === undefined ? [] : [box];
      }
      if (state.arranged === undefined) {
        return [];
      }
      if (state.projected !== true) {
        throw new RangeError("A press context's groups are all projected or none");
      }
      return [state.arranged];
    });
    for (const member of separatePressAreas(placed)) {
      if ("actions" in member) {
        writeOutsets(member as Arranged);
      }
    }
  };
  const context: PressContext = {
    add(member) {
      const element = elementOf(member);
      const state = groupStates.get(element);
      if ("arrange" in member) {
        if (state === undefined || state.disposed === true) {
          throw new Error("Not a live action group");
        }
        if (state.context !== undefined && state.context !== context) {
          throw new RangeError("An action group belongs to one press context");
        }
        state.context = context;
      }
      members.set(element, "arrange" in member ? state : undefined);
    },
    apply() {
      const groups = [...members.values()].filter((state) => state?.arranged !== undefined);
      if (groups.some((state) => state!.projected === true)) {
        applyProjected();
        return;
      }
      const unit = readUnit(root);
      const origin = root.getBoundingClientRect();
      // The layout box: as drawn, less each translate from element up to root's children.
      const measure = (element: HTMLElement): Rect => {
        const rect = element.getBoundingClientRect();
        let left = rect.left - origin.left;
        let top = rect.top - origin.top;
        for (let node: HTMLElement | null = element; node !== null && node !== root;) {
          const [x, y] = translateOf(node);
          left -= x;
          top -= y;
          node = node.parentElement;
        }
        const x = Math.round(left / unit);
        const y = Math.round(top / unit);
        return {
          height: Math.round((top + rect.height) / unit) - y,
          width: Math.round((left + rect.width) / unit) - x,
          x,
          y,
        };
      };
      const placed = [...members].flatMap(([element, state]): PressMember<HTMLElement>[] => {
        if (!shown(element)) {
          return [];
        }
        if (state === undefined) {
          return [measure(element)];
        }
        if (state.arranged === undefined) {
          return [];
        }
        const { x, y } = measure(element);
        const move = (rect: Rect): Rect => ({ ...rect, x: rect.x + x, y: rect.y + y });
        const actions = state.arranged.actions.map((action) =>
          action.hidden
            ? action
            : { ...action, face: move(action.face), press: move(action.press) },
        );
        return [{ ...state.arranged, actions } as Arranged];
      });
      for (const member of separatePressAreas(placed)) {
        if ("actions" in member) {
          writeOutsets(member as Arranged);
        }
      }
    },
    dispose() {
      for (const element of [...members.keys()]) {
        context.remove(element);
      }
    },
    remove(member) {
      const element = elementOf(member);
      if (!members.has(element)) {
        return;
      }
      const state = members.get(element);
      members.delete(element);
      if (state !== undefined) {
        delete state.context;
        if (state.arranged !== undefined) {
          writeOutsets(state.arranged);
        }
      }
    },
  };
  return context;
}
