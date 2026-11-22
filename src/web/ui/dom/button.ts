import type { HoldRule } from "../../../input/hold.ts";
import type { ButtonMetrics, ButtonRole } from "../../../ui/buttonLayout.ts";
import {
  type ControlAvailability,
  type ControlPresentation,
  controlPresentation,
} from "../../../ui/controlPresentation.ts";
import type { HoldAction } from "../../input/dom/holdActions.ts";
import {
  type ButtonFrameContext,
  type ButtonGroupContext,
  setButtonFrame,
  setButtonRole,
  setButtonSize,
} from "./buttonLayout.ts";
import { createNativeButton } from "./nativeButton.ts";

export type ButtonContent =
  | { readonly kind: "text"; readonly label: string }
  | { readonly kind: "icon"; readonly name: string; readonly icon?: Element };

export interface ButtonAppearance {
  readonly className?: string;
  readonly face?: { readonly className?: string };
  readonly contentClassName?: string;
  readonly role?: ButtonRole;
  readonly layout?:
    | "caller"
    | {
        readonly size?: {
          readonly tokens: Readonly<Record<string, ButtonMetrics>>;
          readonly selection: string | ButtonGroupContext;
        };
        readonly frame?: ButtonFrameContext;
      };
}

export interface ButtonState {
  readonly availability?:
    ControlAvailability | { readonly kind: "disabled" } | { readonly kind: "pointer-refusal" };
  readonly selected?: boolean;
  readonly toggled?: boolean;
}

type ButtonAction = Pick<HoldAction, "activate" | "hold" | "identity">;

export interface ButtonOptions {
  readonly content: ButtonContent;
  readonly appearance?: ButtonAppearance;
  readonly rule: HoldRule;
  // Read the current semantic action at dispatch. Change identity when repurposing the button.
  readonly getAction: (element: HTMLButtonElement) => ButtonAction | null;
  // The initial read receives the detached button. Refresh after later state changes.
  readonly getState?: (element: HTMLButtonElement) => ButtonState;
  readonly reason?: HTMLElement;
  readonly onUnavailable?: (reason: string) => void;
  // Only a pointer-owned action or a native pointer click may give this feedback.
  readonly onPointerRefusal?: () => void;
}

export interface ButtonView {
  readonly element: HTMLButtonElement;
  readonly face: HTMLElement;
  setContent(content: ButtonContent): void;
  refresh(): void;
  setPressed(pressed: boolean): void;
  // Return this from the caller's existing root resolver. Null excludes the button.
  holdAction(): HoldAction | null;
  dispose(): void;
}

function updateContent(content: ButtonContent, slot: HTMLElement, element: HTMLButtonElement) {
  const name = content.kind === "text" ? content.label : content.name;
  if (name.trim() === "") {
    throw new RangeError("A standard button requires a nonempty accessible name");
  }
  if (content.kind === "text") {
    element.removeAttribute("aria-label");
    slot.removeAttribute("aria-hidden");
    slot.classList.add("ui-control-label");
    slot.textContent = content.label;
  } else {
    element.setAttribute("aria-label", content.name);
    slot.setAttribute("aria-hidden", "true");
    slot.classList.remove("ui-control-label");
    slot.replaceChildren(...(content.icon === undefined ? [] : [content.icon]));
  }
}

// Text and icon content are decorative DOM inside one native action. Keep form and continuous
// controls on their own paths. The caller owns placement, skin and the delegated root guard.
export function createButton(document: Document, options: ButtonOptions): ButtonView {
  const { appearance, rule } = options;
  const { holdMs, slopPx } = rule;
  if (!Number.isFinite(holdMs) || holdMs < 0 || Number.isNaN(slopPx) || slopPx < 0) {
    throw new RangeError("Hold duration must be finite and nonnegative; slop must be nonnegative");
  }
  const element = createNativeButton(document);
  element.className = appearance?.className ?? "";
  element.classList.add("ui-standard-button");
  const face = appearance?.face === undefined ? element : document.createElement("span");
  if (face !== element) {
    face.className = appearance?.face?.className ?? "";
    element.append(face);
  }
  face.classList.add("ui-button-face");
  const slot = document.createElement("span");
  slot.className = appearance?.contentClassName ?? "";
  face.append(slot);
  updateContent(options.content, slot, element);
  if (appearance?.layout !== "caller") {
    face.classList.add("ui-control-button");
    const { frame, size } = appearance?.layout ?? {};
    if (size !== undefined) {
      setButtonSize(size.tokens, size.selection, face);
    }
    if (frame !== undefined) {
      setButtonFrame(frame, face);
    }
  }
  if (appearance?.role !== undefined) {
    setButtonRole(appearance.role, element);
  }
  let disposed = false;
  let previousTabIndex: string | null | undefined;
  const syncTabIndex = (pointerRefusal: boolean) => {
    const tabIndex = element.getAttribute("tabindex");
    if (pointerRefusal) {
      if (previousTabIndex === undefined || tabIndex !== "-1") {
        previousTabIndex = tabIndex;
        element.tabIndex = -1;
      }
    } else if (previousTabIndex !== undefined) {
      if (tabIndex === "-1") {
        if (previousTabIndex === null) {
          element.removeAttribute("tabindex");
        } else {
          element.setAttribute("tabindex", previousTabIndex);
        }
      }
      previousTabIndex = undefined;
    }
  };
  const refresh = (): ControlPresentation & { readonly pointerRefusal: boolean } => {
    const {
      availability = { kind: "available" },
      selected,
      toggled,
    } = options.getState?.(element) ?? {};
    const disabled = availability.kind === "disabled";
    const pointerRefusal = availability.kind === "pointer-refusal";
    const state: ControlPresentation =
      disabled || pointerRefusal
        ? { executable: false, visible: true }
        : controlPresentation(availability);
    element.hidden = !state.visible;
    element.disabled = disabled;
    syncTabIndex(pointerRefusal);
    element.toggleAttribute("data-ui-selected", selected === true);
    if (toggled === undefined) {
      element.removeAttribute("aria-pressed");
    } else {
      element.setAttribute("aria-pressed", String(toggled));
    }
    if (pointerRefusal || state.reason !== undefined) {
      element.setAttribute("aria-disabled", "true");
    } else {
      element.removeAttribute("aria-disabled");
    }
    if (state.reason === undefined) {
      element.removeAttribute("aria-description");
    } else {
      element.setAttribute("aria-description", state.reason);
    }
    const reason = options.reason;
    if (reason !== undefined) {
      const text = state.reason ?? "";
      if (reason.textContent !== text) {
        reason.textContent = text;
      }
      reason.hidden = state.reason === undefined;
    }
    return { ...state, pointerRefusal };
  };
  const admitted = () =>
    !disposed &&
    element.isConnected &&
    !element.matches(":disabled") &&
    element.closest("[inert], [hidden]") === null &&
    !element.parentElement?.closest('[aria-disabled="true" i]');
  const identity = (action: ButtonAction) =>
    action.identity === undefined ? element : action.identity;
  const current = () => {
    const state = refresh();
    if (!admitted()) {
      return null;
    }
    const action = options.getAction(element);
    return disposed ? null : { ...state, action };
  };
  const sameAction = (expected: unknown) => {
    const state = disposed ? null : current();
    if (state === null || state.action === null || !Object.is(identity(state.action), expected)) {
      return null;
    }
    return state;
  };
  type Current = NonNullable<ReturnType<typeof current>>;
  const canDispatch = (state: Current) =>
    state.executable ||
    (state.pointerRefusal
      ? options.onPointerRefusal !== undefined
      : state.reason !== undefined && options.onUnavailable !== undefined);
  const dispatch = (hold: boolean, pointer: boolean, state: Current) => {
    if (state.pointerRefusal) {
      if (pointer && state.action !== null) {
        options.onPointerRefusal?.();
      }
    } else if (!state.executable && state.reason !== undefined) {
      options.onUnavailable?.(state.reason);
    } else if (state.executable && state.action !== null) {
      (hold ? (state.action.hold ?? state.action.activate) : state.action.activate)();
    }
  };
  const stopClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const onClick = (event: MouseEvent) => {
    let state: ReturnType<typeof current>;
    try {
      state = current();
    } catch (error) {
      stopClick(event);
      throw error;
    }
    if (state?.executable !== true || state.action === null) {
      stopClick(event);
    }
    if (state !== null) {
      dispatch(false, event.detail > 0, state);
    }
  };
  refresh();
  element.addEventListener("click", onClick, true);
  return {
    dispose() {
      disposed = true;
      syncTabIndex(false);
      element.removeAttribute("data-ui-pressed");
      element.removeEventListener("click", onClick, true);
    },
    element,
    face,
    holdAction() {
      if (disposed) {
        return null;
      }
      const state = current();
      if (state === null || state.action === null || !canDispatch(state)) {
        return null;
      }
      const feedback =
        options.onUnavailable !== undefined || options.onPointerRefusal !== undefined;
      const expected = identity(state.action);
      const invoke = (hold: boolean) => {
        const next = sameAction(expected);
        if (next !== null) {
          dispatch(hold, true, next);
        }
      };
      return {
        activate: () => invoke(false),
        available: () => {
          const next = sameAction(expected);
          return next !== null && canDispatch(next);
        },
        element,
        hold: () => invoke(true),
        identity: expected,
        ...(feedback ? { ownAriaDisabled: "refusal-feedback" as const } : {}),
        rule,
      };
    },
    refresh() {
      if (!disposed) {
        refresh();
      }
    },
    setContent(content) {
      if (!disposed) {
        updateContent(content, slot, element);
      }
    },
    setPressed(pressed) {
      if (!disposed) {
        element.toggleAttribute("data-ui-pressed", pressed);
      }
    },
  };
}
