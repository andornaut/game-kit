import {
  type ActionArrangement,
  type ActionGroupContext,
  arrangeActions,
} from "../../../ui/actionGroup.ts";
import type { ButtonRole, ButtonSize } from "../../../ui/buttonLayout.ts";
import { writeLayoutProperties } from "./layoutProperties.ts";
import { readUnit } from "./viewUnits.ts";

// The HTML action group (actionGroup.css): the group element holds the game's action elements as
// direct children and places each one by the pure arrangement, in base px times --ui-unit. Layout
// boxes equal the faces. Each action's press area is its ::before, outset by the arranged press
// outsets, so it takes presses as the action without changing layout. A clipping ancestor (an
// overflow scroller) clips the outsets that reach past it. DOM order, focus order and identities
// stay the caller's; hidden elements take no space.

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

export interface ActionGroupView {
  readonly element: HTMLElement;
  // Places the actions and returns the arrangement keyed by element. Throws, before any change,
  // on invalid input or an element that is not a direct child.
  arrange(
    context: DomActionGroupContext,
    actions: readonly DomAction[],
  ): ActionArrangement<HTMLElement>;
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
  return {
    arrange(context, actions) {
      assertLive();
      const { middle, ...rest } = context;
      for (const child of [...actions.map((action) => action.element), middle?.element]) {
        if (child !== undefined && child.parentElement !== element) {
          throw new RangeError("Actions and the middle slot must be direct children of the group");
        }
      }
      const arrangement = arrangeActions(
        { ...rest, ...(middle === undefined ? {} : { middle: middle.size }) },
        actions.map((action) => ({
          hidden: action.element.hidden !== false,
          key: action.element,
          role: action.role,
          size: action.size,
          ...(action.locked === undefined ? {} : { locked: action.locked }),
        })),
      );
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
      element.setAttribute("data-ui-action-variant", arrangement.variant);
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
      if (middle !== undefined && arrangement.middle !== undefined) {
        marked.add(middle.element);
        middle.element.classList.add(ACTION_MIDDLE_CLASS);
        writeLayoutProperties(box(arrangement.middle), middle.element);
      }
      return arrangement;
    },
    dispose() {
      if (disposed) {
        return;
      }
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
}
