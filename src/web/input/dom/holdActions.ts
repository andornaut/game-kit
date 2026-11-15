import {
  type HoldPress,
  type HoldRule,
  moveHold,
  startHold,
  tickHold,
} from "../../../input/hold.ts";
import { guardPassed } from "../../../input/tapGuard.ts";
import type { PressGuard } from "../../ui/dom/domPress.ts";

export interface HoldAction {
  readonly element: HTMLElement;
  readonly rule: HoldRule;
  readonly available: () => boolean;
  readonly activate: () => void;
  readonly hold?: () => void;
}

export interface HoldActionsOptions {
  readonly guard: PressGuard;
  // Resolve both a descendant event target and the original control itself. Return null to opt out.
  readonly resolve: (target: EventTarget | null) => HoldAction | null;
}

interface Gesture {
  readonly element: HTMLElement;
  readonly pointerId: number;
  readonly accepted: () => boolean;
  press: HoldPress;
  timer: number | undefined;
}

interface Release {
  readonly element: HTMLElement;
  readonly pointerId: number;
}

// Adds hold dispatch only. Existing click handlers continue to own taps, keys and accessibility.
// Register before root capture-click actions; descendant actions are suppressed in capture.
export function bindHoldActions(options: HoldActionsOptions, root: HTMLElement): () => void {
  const document = root.ownerDocument;
  const view = document.defaultView;
  if (view === null) {
    throw new Error("Hold actions require a document window");
  }
  let active: Gesture | undefined;
  let released: Release | undefined;
  let releaseTimer: number | undefined;
  let downRevision = 0;
  let disposed = false;
  const now = () => view.performance.now();
  const inside = (element: HTMLElement, target: EventTarget | null) =>
    target instanceof view.Node && element.contains(target);
  const passes = () => {
    const { tapGuard } = options.guard;
    return tapGuard === undefined || guardPassed(tapGuard.guardMs, tapGuard.drawnMs(), now());
  };
  const enabled = (element: HTMLElement) => {
    if (!root.isConnected || !element.isConnected || !root.contains(element)) {
      return false;
    }
    if (element.matches(":disabled")) {
      return false;
    }
    for (
      let ancestor: HTMLElement | null = element;
      ancestor !== null;
      ancestor = ancestor.parentElement
    ) {
      if (ancestor.getAttribute("aria-disabled")?.toLowerCase() === "true" || ancestor.inert) {
        return false;
      }
    }
    return true;
  };
  const clearRelease = () => {
    released = undefined;
    view.clearTimeout(releaseTimer);
    releaseTimer = undefined;
  };
  const cancel = () => {
    view.clearTimeout(active?.timer);
    active = undefined;
  };
  const current = (gesture: Gesture): HoldAction | null => {
    if (
      !gesture.accepted() ||
      !options.guard.gate.accepts() ||
      !passes() ||
      !enabled(gesture.element)
    ) {
      return null;
    }
    const action = options.resolve(gesture.element);
    return action?.element === gesture.element && action.available() ? action : null;
  };
  const fire = (gesture: Gesture) => {
    const action = current(gesture);
    if (action === null) {
      cancel();
      return;
    }
    const step = tickHold(now(), gesture.press);
    gesture.press = step.press;
    if (step.fire) {
      view.clearTimeout(gesture.timer);
      gesture.timer = undefined;
      // Mark held before calling user code, including synchronous disposal or DOM replacement.
      (action.hold ?? action.activate)();
    }
  };
  const arm = (gesture: Gesture) => {
    const remaining = Math.max(0, gesture.press.rule.holdMs - (now() - gesture.press.startedMs));
    gesture.timer = view.setTimeout(() => {
      if (active !== gesture || disposed) {
        return;
      }
      fire(gesture);
      if (active === gesture && gesture.press.state === "holding") {
        arm(gesture);
      }
    }, remaining);
  };
  const onAnyDown = () => {
    downRevision += 1;
    clearRelease();
  };
  const onDown = (event: PointerEvent) => {
    if (active !== undefined || !event.isPrimary || event.button !== 0 || !passes()) {
      return;
    }
    const action = options.resolve(event.target);
    if (
      action === null ||
      !inside(action.element, event.target) ||
      !enabled(action.element) ||
      !action.available()
    ) {
      return;
    }
    const { holdMs, slopPx } = action.rule;
    if (!Number.isFinite(holdMs) || holdMs < 0 || Number.isNaN(slopPx) || slopPx < 0) {
      throw new Error("Hold duration must be finite and nonnegative; slop must be nonnegative");
    }
    const gesture: Gesture = {
      accepted: options.guard.gate.capture(),
      element: action.element,
      pointerId: event.pointerId,
      press: startHold(action.rule, { x: event.clientX, y: event.clientY }, now()),
      timer: undefined,
    };
    if (!gesture.accepted()) {
      return;
    }
    active = gesture;
    arm(gesture);
  };
  const travel = (event: PointerEvent) => {
    const gesture = active;
    if (
      gesture === undefined ||
      gesture.pointerId !== event.pointerId ||
      gesture.press.state === "held"
    ) {
      return;
    }
    gesture.press = moveHold({ x: event.clientX, y: event.clientY }, gesture.press);
    if (gesture.press.state === "moved" || !inside(gesture.element, event.target)) {
      cancel();
    }
  };
  const onEnd = (event: PointerEvent) => {
    const gesture = active;
    if (gesture === undefined || gesture.pointerId !== event.pointerId) {
      return;
    }
    if (event.type === "pointerup") {
      travel(event);
      const revision = downRevision;
      if (active === gesture && gesture.press.state === "holding") {
        fire(gesture);
      }
      if (!disposed && revision === downRevision && gesture.press.state === "held") {
        clearRelease();
        released = { element: gesture.element, pointerId: gesture.pointerId };
        // A release witness cannot consume a later task's click, even when no click follows up.
        releaseTimer = view.setTimeout(clearRelease, 0);
      }
    }
    if (active === gesture) {
      cancel();
    }
  };
  const onLeave = (event: PointerEvent) => {
    const gesture = active;
    if (
      gesture === undefined ||
      gesture.pointerId !== event.pointerId ||
      gesture.press.state === "held"
    ) {
      return;
    }
    if (
      (event.type === "pointerleave" &&
        (event.target === gesture.element || event.target === root)) ||
      (event.type === "pointerout" &&
        inside(gesture.element, event.target) &&
        !inside(gesture.element, event.relatedTarget))
    ) {
      cancel();
    }
  };
  const onLostCapture = (event: PointerEvent) => {
    if (active?.pointerId === event.pointerId && active.press.state !== "held") {
      cancel();
    }
  };
  const onClick = (event: MouseEvent) => {
    if (event.detail === 0 || released === undefined || !inside(released.element, event.target)) {
      return;
    }
    if ("pointerId" in event && event.pointerId !== released.pointerId) {
      return;
    }
    clearRelease();
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const reset = () => {
    cancel();
    clearRelease();
  };
  document.addEventListener("pointerdown", onAnyDown, true);
  root.addEventListener("pointerdown", onDown, true);
  document.addEventListener("pointermove", travel, true);
  document.addEventListener("pointerup", onEnd, true);
  document.addEventListener("pointercancel", onEnd, true);
  root.addEventListener("pointerleave", onLeave, true);
  root.addEventListener("pointerout", onLeave, true);
  document.addEventListener("lostpointercapture", onLostCapture, true);
  root.addEventListener("click", onClick, true);
  view.addEventListener("blur", reset);
  return () => {
    if (disposed) {
      return;
    }
    disposed = true;
    reset();
    document.removeEventListener("pointerdown", onAnyDown, true);
    root.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("pointermove", travel, true);
    document.removeEventListener("pointerup", onEnd, true);
    document.removeEventListener("pointercancel", onEnd, true);
    root.removeEventListener("pointerleave", onLeave, true);
    root.removeEventListener("pointerout", onLeave, true);
    document.removeEventListener("lostpointercapture", onLostCapture, true);
    root.removeEventListener("click", onClick, true);
    view.removeEventListener("blur", reset);
  };
}
