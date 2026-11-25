import type { Rect } from "../../../rect.ts";
import {
  type ActionArrangement,
  type ActionGridArrangement,
  type ActionGridContext,
  type ActionGroupContext,
  arrangeActionGrid,
  arrangeActions,
  type ButtonRole,
  type ButtonSize,
  type PressMember,
  separatePressAreas,
} from "../../../ui/index.ts";
import { writeLayoutProperties } from "./layoutProperties.ts";
import { readUnit } from "./viewUnits.ts";

// The HTML action group (actionGroup.css): the group element holds the game's action elements as
// direct children and places each one by the pure arrangement, in base px times --ui-unit. Layout
// boxes equal the faces. Each action's press area is its ::before, outset by the arranged press
// outsets, so it takes presses as the action without changing layout. A clipping ancestor (an
// overflow scroller) clips the outsets that reach past it. DOM order, focus order and identities
// stay the caller's; hidden elements take no space. A press context (createPressContext) clamps
// the press areas of neighbouring groups, and of a group and a form row, toward each other.

export const ACTION_GROUP_CLASS = "ui-action-group";
export const ACTION_CLASS = "ui-action";
export const ACTION_MIDDLE_CLASS = "ui-action-middle";
export const ACTION_MEASURING_ATTRIBUTE = "data-ui-action-measuring";

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

// The pure context less placement in other spaces: the DOM places in base px from the group's
// corner. The footer's middle slot is a direct child the game supplies, such as a pager.
export type DomActionGroupContext = Omit<
  ActionGroupContext<HTMLElement>,
  "middle" | "origin" | "placeText" | "project"
> & {
  readonly middle?: { readonly element: HTMLElement; readonly size: ButtonSize };
};

// The pure grid context less placement in other spaces.
export type DomActionGridContext = Omit<
  ActionGridContext<HTMLElement>,
  "origin" | "placeText" | "project"
>;

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

function box(rect: { height: number; width: number; x: number; y: number }) {
  return Object.fromEntries(BOX.map((field) => [`--ui-action-${field}`, rect[field]]));
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

// What a press context needs of a group: its own last arrangement and its context.
interface GroupState {
  arranged?: Arranged;
  context?: PressContext;
  disposed?: true;
}

// By the group's element, so a view that wraps a group (a modal frame's footer) is the group.
const groupStates = new WeakMap<HTMLElement, GroupState>();

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
    middle?: { readonly element: HTMLElement },
  ) => {
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
          ...box(action.face),
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
      writeLayoutProperties(box(arrangement.middle), middle.element);
    }
    state.arranged = arrangement;
    state.context?.apply();
  };
  const view: ActionGroupView = {
    arrange(context, actions) {
      assertLive();
      const { middle, ...rest } = context;
      const items = children(actions, middle?.element);
      const arrangement = arrangeActions(
        { ...rest, ...(middle === undefined ? {} : { middle: middle.size }) },
        items,
      );
      place(arrangement, actions, middle);
      return arrangement;
    },
    arrangeGrid(context, actions) {
      assertLive();
      const arrangement = arrangeActionGrid(context, children(actions));
      place(arrangement, actions);
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
// and no member needs a stacking order or an inset. It measures the boxes as drawn, so apply after
// layout. A member group's arrange() and arrangeGrid() apply it again; apply after anything else
// moves a member.
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

export function createPressContext(root: HTMLElement): PressContext {
  // Each member's element: a group's, or the element that is its own press target.
  const members = new Map<HTMLElement, GroupState | undefined>();
  const elementOf = (member: ActionGroupView | HTMLElement) =>
    "arrange" in member ? member.element : member;
  const shown = (element: HTMLElement) =>
    element.isConnected && element.closest("[hidden]") === null;
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
      const unit = readUnit(root);
      const origin = root.getBoundingClientRect();
      const measure = (element: HTMLElement): Rect => {
        const rect = element.getBoundingClientRect();
        const x = Math.round((rect.left - origin.left) / unit);
        const y = Math.round((rect.top - origin.top) / unit);
        return {
          height: Math.round((rect.bottom - origin.top) / unit) - y,
          width: Math.round((rect.right - origin.left) / unit) - x,
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
