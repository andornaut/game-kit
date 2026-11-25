import type { HoldRule } from "../../../input/hold.ts";
import type {
  ActionArrangement,
  ActionGapSelection,
  ActionPress,
} from "../../../ui/actionGroup.ts";
import { PAGER_GAP, type PagerPart, type PagerSizes, type PagerState } from "../../../ui/pager.ts";
import { type ActionGroupView, createActionGroup } from "./actionGroup.ts";
import { type ButtonAppearance, type ButtonView, createButton } from "./button.ts";
import { type RefusalCue, refuse } from "./refusalCue.ts";

// The HTML pager (pager.css with actionGroup.css): an action group holding Previous, the page
// count and Next, each a direct child in that focus order. Previous and Next are standard buttons
// (button.ts) in the game's appearance; the count is player text, shown as text or as decorative
// dots that take no focus or presses, and announced politely. An unavailable step is a disabled
// button, or with a refusal cue a pointer refusal: out of the Tab order, playing the cue on a
// press. The group element can be a footer group's middle slot.

export const PAGER_CLASS = "ui-pager";
export const PAGER_COUNT_CLASS = "ui-pager-count";
export const PAGER_COUNT_TEXT_CLASS = "ui-pager-count-text";
export const PAGER_DOTS_CLASS = "ui-pager-dots";
export const PAGER_DOT_CLASS = "ui-pager-dot";
export const PAGER_CURRENT_ATTRIBUTE = "data-ui-current";

export interface PagerOptions {
  // Player text.
  readonly labels: { readonly next: string; readonly previous: string };
  // The game's appearance for both buttons: its skin classes and layout. Their role is secondary.
  readonly appearance?: Omit<ButtonAppearance, "role">;
  readonly rule: HoldRule;
  // The current page and page count, read on each refresh and before each step.
  readonly state: () => PagerState;
  // The count's player text for state, such as "2 / 5". With dots it is read, not shown.
  readonly countText: (state: PagerState) => string;
  // Shows the count as one decorative dot per page.
  readonly dots?: boolean;
  // Moves one page; the game refreshes the pager after showing it.
  readonly step: (direction: -1 | 1) => void;
  // A caller guard, such as readiness or a modal scope: false blocks both steps.
  readonly active?: () => boolean;
  // Plays the cue on a pointer press of an unavailable step instead of disabling it.
  readonly refusal?: { readonly cue: RefusalCue; readonly reducedMotion: () => boolean };
  readonly className?: string;
}

export interface PagerArrangeContext {
  readonly width: number;
  readonly gap?: ActionGapSelection;
  readonly press?: ActionPress;
  // Each part's face in whole base px; measured when omitted.
  readonly sizes?: PagerSizes;
}

export interface PagerView {
  // The action group element: place it, or pass it as a footer's middle slot.
  readonly element: HTMLElement;
  readonly group: ActionGroupView;
  readonly count: HTMLElement;
  readonly next: ButtonView;
  readonly previous: ButtonView;
  // Reads the state and updates the count, the dots and both buttons.
  refresh(): void;
  // Each part's natural face in whole base px.
  measure(): PagerSizes;
  arrange(context: PagerArrangeContext): ActionArrangement<HTMLElement>;
  dispose(): void;
}

export function createPager(document: Document, options: PagerOptions): PagerView {
  const group = createActionGroup(document, {
    className: `${options.className ?? ""} ${PAGER_CLASS}`.trim(),
  });
  const count = document.createElement("p");
  count.className = PAGER_COUNT_CLASS;
  count.setAttribute("aria-live", "polite");
  const text = document.createElement("span");
  text.className = PAGER_COUNT_TEXT_CLASS;
  const dots = document.createElement("span");
  dots.className = PAGER_DOTS_CLASS;
  dots.setAttribute("aria-hidden", "true");
  count.append(text);
  if (options.dots === true) {
    count.toggleAttribute("data-ui-pager-dots", true);
    count.append(dots);
  }
  const step = (direction: -1 | 1): ButtonView => {
    const available = () => {
      const state = options.state();
      return direction < 0 ? state.previous : state.next;
    };
    const identity = { direction };
    const button: ButtonView = createButton(document, {
      appearance: { ...options.appearance, role: "secondary" },
      content: {
        kind: "text",
        label: direction < 0 ? options.labels.previous : options.labels.next,
      },
      getAction: () =>
        options.active?.() === false ? null : { activate: () => options.step(direction), identity },
      getState: () => ({
        availability: {
          kind: available() ? "available" : options.refusal ? "pointer-refusal" : "disabled",
        },
      }),
      ...(options.refusal === undefined
        ? {}
        : {
            onPointerRefusal: () =>
              refuse(options.refusal!.cue, options.refusal!.reducedMotion(), button.element),
          }),
      rule: options.rule,
    });
    button.face.querySelector<HTMLElement>("span")?.setAttribute("data-ui-refusal-label", "");
    return button;
  };
  const previous = step(-1);
  const next = step(1);
  group.element.append(previous.element, count, next.element);
  const refresh = () => {
    const state = options.state();
    const words = options.countText(state);
    if (text.textContent !== words) {
      text.textContent = words;
    }
    if (options.dots === true) {
      const shown = [...dots.children];
      while (shown.length < state.pages) {
        const dot = document.createElement("span");
        dot.className = PAGER_DOT_CLASS;
        dots.append(dot);
        shown.push(dot);
      }
      shown.splice(state.pages).forEach((dot) => dot.remove());
      shown.forEach((dot, index) =>
        dot.toggleAttribute(PAGER_CURRENT_ATTRIBUTE, index === state.page),
      );
    }
    previous.refresh();
    next.refresh();
  };
  refresh();
  const measure = (): PagerSizes => {
    const [previousSize, countSize, nextSize] = group.measure([
      previous.element,
      count,
      next.element,
    ]);
    return { count: countSize!, next: nextSize!, previous: previousSize! };
  };
  return {
    arrange(context) {
      const sizes = context.sizes ?? measure();
      const parts: readonly [PagerPart, HTMLElement][] = [
        ["previous", previous.element],
        ["count", count],
        ["next", next.element],
      ];
      return group.arrange(
        {
          axis: "row",
          gap: context.gap ?? PAGER_GAP,
          width: context.width,
          ...(context.press === undefined ? {} : { press: context.press }),
        },
        parts.map(([part, element]) => ({ element, role: "secondary", size: sizes[part] })),
      );
    },
    count,
    dispose() {
      previous.dispose();
      next.dispose();
      group.dispose();
    },
    element: group.element,
    group,
    measure,
    next,
    previous,
    refresh,
  };
}
