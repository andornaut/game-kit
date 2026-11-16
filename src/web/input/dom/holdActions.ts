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
  // Compared with Object.is; undefined uses the element as the logical identity.
  readonly identity?: unknown;
}

export interface HoldActionsOptions {
  readonly guard: PressGuard;
  // Resolve both a descendant event target and the original control itself. Return null to opt out.
  readonly resolve: (target: EventTarget | null) => HoldAction | null;
}

export interface PointerReleaseHoldActionsOptions extends HoldActionsOptions {
  readonly activation: "pointer-release";
  readonly pointerTarget?: HTMLElement | Document;
  // Physical acceptance at down, move, up and timer dispatch using the latest pointer event.
  // Must agree with resolve(originalElement) on both element and logical identity.
  readonly resolvePointer: (event: PointerEvent) => HoldAction | null;
  readonly onPressChange?: (action: HoldAction | null) => void;
}

export interface HoldActionsBinding {
  (): void;
  // Cancel logical ownership while retaining only its matching release suppression.
  cancel(): void;
}

export type HoldActionBinding = (
  action: Readonly<Pick<HoldAction, "element" | "available" | "activate">>,
) => () => void;

interface Gesture {
  readonly element: HTMLElement;
  readonly pointerId: number;
  readonly identity: unknown;
  latest: PointerEvent;
  readonly accepted: () => boolean;
  press: HoldPress;
  timer: number | undefined;
  showing: boolean;
}

interface Release {
  readonly element: HTMLElement;
  readonly pointerId: number;
}

// Default mode adds holds to caller-owned native activation. Pointer-release mode also owns taps.
// Register before root capture-click actions; descendant actions are suppressed in capture.
export function bindHoldActions(
  options: HoldActionsOptions | PointerReleaseHoldActionsOptions,
  root: HTMLElement,
): HoldActionsBinding {
  const document = root.ownerDocument;
  const view = document.defaultView;
  if (view === null) {
    throw new Error("Hold actions require a document window");
  }
  const releaseOptions = "activation" in options ? options : undefined;
  if (
    releaseOptions !== undefined &&
    (releaseOptions.activation !== "pointer-release" ||
      typeof releaseOptions.resolvePointer !== "function")
  ) {
    throw new RangeError("Unknown hold action activation mode");
  }
  const pointerTarget =
    releaseOptions?.pointerTarget === undefined ? root : releaseOptions.pointerTarget;
  if (
    pointerTarget !== document &&
    (!(pointerTarget instanceof view.HTMLElement) ||
      pointerTarget.ownerDocument !== document ||
      !root.contains(pointerTarget))
  ) {
    throw new RangeError(
      "Hold pointer target must be the owner document or an element within root",
    );
  }
  let active: Gesture | undefined;
  let released: Release | undefined;
  let invalidatedRelease: Release | undefined;
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
    if (
      (releaseOptions !== undefined && document.hidden) ||
      !root.isConnected ||
      !element.isConnected ||
      !root.contains(element)
    ) {
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
  const cancel = (followRelease = false) => {
    const previous = active;
    view.clearTimeout(previous?.timer);
    active = undefined;
    if (previous === undefined) {
      return;
    }
    previous.timer = undefined;
    if (releaseOptions !== undefined && followRelease) {
      // Keep only the followed release, so a canceled custom gesture cannot fall through to click.
      previous.press = { ...previous.press, state: "moved" };
      active = previous;
    }
    if (previous.showing) {
      previous.showing = false;
      releaseOptions?.onPressChange?.(null);
    }
  };
  const identity = (action: HoldAction) =>
    action.identity === undefined ? action.element : action.identity;
  const same = (gesture: Gesture, action: HoldAction | null) =>
    action !== null &&
    action.element === gesture.element &&
    Object.is(identity(action), gesture.identity);
  const physical = (gesture: Gesture) => {
    if (releaseOptions === undefined) {
      return true;
    }
    const action = releaseOptions.resolvePointer(gesture.latest);
    return same(gesture, action) && action!.available();
  };
  const current = (gesture: Gesture): HoldAction | null => {
    if (
      disposed ||
      !gesture.accepted() ||
      !options.guard.gate.accepts() ||
      !passes() ||
      !enabled(gesture.element) ||
      !physical(gesture)
    ) {
      return null;
    }
    const action = options.resolve(gesture.element);
    return same(gesture, action) && action!.available() ? action : null;
  };
  const fire = (gesture: Gesture) => {
    const action = current(gesture);
    if (action === null || disposed || active !== gesture) {
      if (active === gesture) {
        cancel(true);
      }
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
  const invalidate = () => {
    if (disposed) {
      return;
    }
    if (active !== undefined) {
      invalidatedRelease = { element: active.element, pointerId: active.pointerId };
    }
    cancel();
  };
  const rememberRelease = (release: Release) => {
    clearRelease();
    released = release;
    releaseTimer = view.setTimeout(clearRelease, 0);
  };
  const onAnyDown = (event: PointerEvent) => {
    if (invalidatedRelease?.pointerId === event.pointerId) {
      invalidatedRelease = undefined;
    }
    if (
      releaseOptions !== undefined &&
      active?.press.state === "moved" &&
      event.isPrimary &&
      event.button === 0
    ) {
      cancel();
    }
    downRevision += 1;
    clearRelease();
  };
  const onDown = (event: PointerEvent) => {
    if (disposed || active !== undefined || !event.isPrimary || event.button !== 0 || !passes()) {
      return;
    }
    const action =
      releaseOptions === undefined
        ? options.resolve(event.target)
        : releaseOptions.resolvePointer(event);
    if (
      action === null ||
      (releaseOptions === undefined && !inside(action.element, event.target)) ||
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
      identity: identity(action),
      latest: event,
      pointerId: event.pointerId,
      press: startHold(action.rule, { x: event.clientX, y: event.clientY }, now()),
      showing: releaseOptions !== undefined,
      timer: undefined,
    };
    if (!gesture.accepted()) {
      return;
    }
    active = gesture;
    if (releaseOptions !== undefined) {
      try {
        releaseOptions.onPressChange?.(action);
      } catch (error) {
        cancel();
        throw error;
      }
      if (disposed || active !== gesture) {
        return;
      }
      if (current(gesture) === null) {
        cancel(true);
        return;
      }
    }
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
    gesture.latest = event;
    gesture.press = moveHold({ x: event.clientX, y: event.clientY }, gesture.press);
    if (
      gesture.press.state === "moved" ||
      (releaseOptions === undefined ? !inside(gesture.element, event.target) : !physical(gesture))
    ) {
      cancel(true);
    }
  };
  const onEnd = (event: PointerEvent) => {
    if (invalidatedRelease?.pointerId === event.pointerId) {
      const witness = invalidatedRelease;
      invalidatedRelease = undefined;
      if (event.type === "pointerup") {
        rememberRelease(witness);
      }
    }
    const gesture = active;
    if (gesture === undefined || gesture.pointerId !== event.pointerId) {
      return;
    }
    let tap = false;
    const revision = downRevision;
    if (event.type === "pointerup") {
      travel(event);
      if (active === gesture && gesture.press.state === "holding") {
        fire(gesture);
      }
      if (
        releaseOptions !== undefined &&
        active === gesture &&
        gesture.press.state === "holding" &&
        current(gesture) !== null
      ) {
        // Consume the release before visual callbacks or semantic dispatch can reenter.
        gesture.press = { ...gesture.press, state: "held" };
        tap = true;
      }
      if (
        !disposed &&
        revision === downRevision &&
        (gesture.press.state === "held" || releaseOptions !== undefined)
      ) {
        // A release witness cannot consume a later task's click, even when no click follows up.
        rememberRelease({ element: gesture.element, pointerId: gesture.pointerId });
      }
    }
    if (active === gesture) {
      cancel();
    }
    if (tap && !disposed && revision === downRevision) {
      const action = current(gesture);
      if (action !== null && !disposed && revision === downRevision) {
        action.activate();
      }
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
    if (releaseOptions !== undefined) {
      gesture.latest = event;
      if (!physical(gesture)) {
        cancel(true);
      }
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
      cancel(true);
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
    try {
      cancel(true);
    } finally {
      clearRelease();
    }
  };
  const onVisibility = () => {
    if (document.hidden) {
      reset();
    }
  };
  document.addEventListener("pointerdown", onAnyDown, true);
  pointerTarget.addEventListener("pointerdown", onDown as EventListener, true);
  document.addEventListener("pointermove", travel, true);
  document.addEventListener("pointerup", onEnd, true);
  document.addEventListener("pointercancel", onEnd, true);
  root.addEventListener("pointerleave", onLeave, true);
  root.addEventListener("pointerout", onLeave, true);
  document.addEventListener("lostpointercapture", onLostCapture, true);
  root.addEventListener("click", onClick, true);
  view.addEventListener("blur", reset);
  if (releaseOptions !== undefined) {
    document.addEventListener("visibilitychange", onVisibility);
  }
  const dispose = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    invalidatedRelease = undefined;
    try {
      try {
        cancel();
      } finally {
        clearRelease();
      }
    } finally {
      document.removeEventListener("pointerdown", onAnyDown, true);
      pointerTarget.removeEventListener("pointerdown", onDown as EventListener, true);
      document.removeEventListener("pointermove", travel, true);
      document.removeEventListener("pointerup", onEnd, true);
      document.removeEventListener("pointercancel", onEnd, true);
      root.removeEventListener("pointerleave", onLeave, true);
      root.removeEventListener("pointerout", onLeave, true);
      document.removeEventListener("lostpointercapture", onLostCapture, true);
      root.removeEventListener("click", onClick, true);
      view.removeEventListener("blur", reset);
      if (releaseOptions !== undefined) {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    }
  };
  return Object.assign(dispose, { cancel: invalidate });
}
