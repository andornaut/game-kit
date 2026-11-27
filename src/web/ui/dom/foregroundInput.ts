import { capturePressGuard, type PressGuard } from "../../../input/index.ts";
import { foregroundKeyAction, stepFocus } from "../../../ui/focusKeys.ts";
import type { HoldAction } from "../../input/dom/index.ts";
import { focusTarget, recordInputModality, trackInputModality } from "./focusModality.ts";

export type ForegroundAction = Readonly<Pick<HoldAction, "element" | "available" | "activate">> & {
  // Supply a stable logical identity when resolve recreates the activation closure.
  readonly identity?: unknown;
  // A native button already wired to the same action through its guarded click handler.
  readonly native?: true;
};

export interface ForegroundSurface {
  readonly root: HTMLElement;
  // Layer order is page, modal, recovery, crash. Later registrations win within a layer.
  readonly layer?: "page" | "modal" | "recovery" | "crash";
  readonly guard?: PressGuard;
  // Override visibility-based participation, for example while an isolated modal is invalid.
  readonly active?: () => boolean;
  // A foreground surface can block input while its actions are unready.
  readonly ready?: () => boolean;
  // Let Escape go below an actionless, ready and unblocked surface. Other keys stay scoped.
  readonly escape?: "pass-through";
  readonly targets?: () => readonly HTMLElement[];
  // Explicitly preserves a caller control's native or target-owned key handling.
  readonly preserveKey?: (event: KeyboardEvent) => boolean;
  // Modal Tab trap in its existing order. Pages leave Tab to the browser.
  readonly tabTargets?: () => readonly HTMLElement[];
  // Resolve admitted actions from focused controls or pointer targets at dispatch.
  readonly resolve?: (target: EventTarget) => ForegroundAction | null | undefined;
  // Only supply a dialogue's existing Skip action.
  readonly skip?: () => ForegroundAction | null | undefined;
  readonly dismiss?: () => ForegroundAction | null | undefined;
}

export interface ForegroundInputOptions {
  // Read the game's currently available Pause/Menu entry only when there is no foreground.
  readonly gameEscape?: () => (() => void) | undefined;
}

export interface ForegroundInput {
  // Remove the registration on close. The router keeps ownership of an in-flight press.
  register(surface: ForegroundSurface): () => void;
  dispose(): void;
}

const PRIORITY = { crash: 3, modal: 1, page: 0, recovery: 2 };
const FOCUSABLE =
  'a[href], button, input, select, textarea, summary, [contenteditable]:not([contenteditable="false"]), [tabindex]';
const UNAVAILABLE = '[hidden], [inert], [data-ui-pending], [aria-disabled="true" i]';
const KEY_EVENTS = ["keydown", "keypress", "keyup"] as const;
const SECONDARY_SLOP_PX = 8;
const always = () => true;

interface OwnedKey {
  readonly surface?: ForegroundSurface;
  readonly check: () => boolean;
  native?: ForegroundAction;
}

interface SecondaryPress {
  readonly down: PointerEvent;
  readonly action: ForegroundAction;
  readonly surface: ForegroundSurface;
  readonly check: () => boolean;
  cancelled: boolean;
  menuHandled: boolean;
}

interface SecondaryRelease {
  readonly up: PointerEvent;
  readonly target: Node | undefined;
  menuPending: boolean;
  auxPending: boolean;
}

function sameAction(captured: ForegroundAction, current: ForegroundAction | undefined): boolean {
  if (current?.element !== captured.element) {
    return false;
  }
  const identity = (action: ForegroundAction) =>
    action.identity === undefined ? action.activate : action.identity;
  return Object.is(identity(captured), identity(current));
}

function modified(event: KeyboardEvent | MouseEvent): boolean {
  return (
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    (event.shiftKey && (!("key" in event) || event.key !== "Tab"))
  );
}

function consume(event: Event): void {
  event.preventDefault();
  event.stopImmediatePropagation();
}

function visible(element: HTMLElement, view: Window): boolean {
  if (!element.isConnected || element.closest("[hidden], [inert]") !== null) {
    return false;
  }
  const visibility = view.getComputedStyle(element).visibility;
  if (visibility === "hidden" || visibility === "collapse") {
    return false;
  }
  for (let node: HTMLElement | null = element; node !== null; node = node.parentElement) {
    const parent: HTMLElement | null = node.parentElement;
    if (
      (parent?.matches("details:not([open])") &&
        node !== parent.querySelector(":scope > summary")) ||
      view.getComputedStyle(node).display === "none"
    ) {
      return false;
    }
  }
  return true;
}

// One stable router per game document, installed before the game's window capture handlers.
export function bindForegroundInput(
  options: ForegroundInputOptions,
  document: Document,
): ForegroundInput {
  const view = document.defaultView;
  if (view === null) {
    throw new Error("Foreground input requires a document window");
  }
  const surfaces = new Set<ForegroundSurface>();
  const ownedKeys = new Map<string, OwnedKey>();
  let disposed = false;
  let secondary: SecondaryPress | undefined;
  let released: SecondaryRelease | undefined;
  let releaseTimer: number | undefined;
  trackInputModality(document);

  const top = (passed?: ReadonlySet<ForegroundSurface>) => {
    let best: ForegroundSurface | undefined;
    let priority = -1;
    for (const surface of surfaces) {
      const rank = PRIORITY[surface.layer ?? "page"];
      if (
        rank >= priority &&
        !passed?.has(surface) &&
        (surface.active?.() ?? visible(surface.root, view))
      ) {
        best = surface;
        priority = rank;
      }
    }
    return best;
  };
  const ready = (surface: ForegroundSurface) =>
    visible(surface.root, view) && surface.ready?.() !== false;
  const capture = (surface: ForegroundSurface, event: Event) =>
    surface.guard === undefined ? always : capturePressGuard(surface.guard, event.timeStamp);
  const inside = (surface: ForegroundSurface, node: unknown): node is Node =>
    node instanceof view.Node && surface.root.contains(node);
  const enabled = (element: HTMLElement) =>
    visible(element, view) &&
    !element.matches(":disabled") &&
    element.closest(UNAVAILABLE) === null;
  const action = (
    surface: ForegroundSurface,
    candidate: ForegroundAction | null | undefined,
    passed?: ReadonlySet<ForegroundSurface>,
  ) =>
    candidate != null &&
    inside(surface, candidate.element) &&
    enabled(candidate.element) &&
    candidate.available() &&
    top(passed) === surface &&
    ready(surface) &&
    inside(surface, candidate.element) &&
    enabled(candidate.element)
      ? candidate
      : undefined;
  const targetAction = (surface: ForegroundSurface, target: Node) => {
    const candidate = surface.resolve?.(target);
    return candidate != null && candidate.element.contains(target)
      ? action(surface, candidate)
      : undefined;
  };
  const native = (surface: ForegroundSurface | undefined, event: KeyboardEvent) => {
    const target = event.composedPath()[0];
    if (!(target instanceof view.Element)) {
      return false;
    }
    const dialog = target.closest("dialog[open]");
    if (dialog !== null && !dialog.contains(surface?.root ?? null)) {
      return true;
    }
    if (event.key === "Tab") {
      return false;
    }
    return (
      target.closest(
        'input, select, textarea, [contenteditable]:not([contenteditable="false"]), [role="textbox"]',
      ) !== null ||
      (event.key.startsWith("Arrow") && target.closest('[role="slider"]') !== null) ||
      ((event.key === "Enter" || event.key === " " || event.key === "Spacebar") &&
        target.closest("summary, a[href]") !== null)
    );
  };
  const step = (surface: ForegroundSurface, direction: "next" | "previous", tab: boolean) => {
    const active = document.activeElement;
    const candidates = tab
      ? (surface.tabTargets?.() ?? [])
      : (surface.targets?.() ?? Array.from(surface.root.querySelectorAll<HTMLElement>(FOCUSABLE)));
    const targets = candidates.filter(
      (element) =>
        (tab || inside(surface, element)) &&
        (element.tabIndex >= 0 || element.matches("summary:not([tabindex])")) &&
        !element.matches(":disabled") &&
        element.closest("[data-ui-pending]") === null &&
        visible(element, view),
    );
    const next = stepFocus(
      targets,
      targets.find((target) => target === active),
      direction,
    );
    if (next !== undefined && top() === surface && ready(surface)) {
      focusTarget(next);
    }
  };
  const nativePhase = (held: OwnedKey, event: KeyboardEvent) => {
    const { check, native, surface } = held;
    if (
      native === undefined ||
      surface === undefined ||
      event.repeat ||
      event.isComposing ||
      modified(event) ||
      native.element !== document.activeElement ||
      native.element !== event.composedPath()[0] ||
      top() !== surface ||
      !check() ||
      !native.available()
    ) {
      return false;
    }
    const current = targetAction(surface, native.element);
    return (
      current?.native === true &&
      sameAction(native, current) &&
      held.native === native &&
      native.element === document.activeElement &&
      check()
    );
  };

  const escape = (event: KeyboardEvent, id: string) => {
    const passed = new Set<ForegroundSurface>();
    const own = () => {
      ownedKeys.set(id, { check: always });
      recordInputModality(document, "keyboard");
      consume(event);
    };
    let surface = top(passed);
    while (surface !== undefined) {
      const check = capture(surface, event);
      if (event.repeat || !ready(surface) || !check()) {
        own();
        return;
      }
      const skip = action(surface, surface.skip?.(), passed);
      const admitted =
        top(passed) === surface
          ? (skip ?? action(surface, surface.dismiss?.(), passed))
          : undefined;
      if (
        admitted !== undefined ||
        surface.escape !== "pass-through" ||
        top(passed) !== surface ||
        !check()
      ) {
        own();
        if (admitted !== undefined && top(passed) === surface && check()) {
          admitted.activate();
        }
        return;
      }
      passed.add(surface);
      surface = top(passed);
    }
    const fallback = !event.repeat ? options.gameEscape?.() : undefined;
    if (fallback !== undefined) {
      own();
      fallback();
    }
  };

  const onKey = (event: KeyboardEvent) => {
    const key = event.key === "Spacebar" ? " " : event.key.toLowerCase();
    const id = event.code && event.code !== "Unidentified" ? event.code : key;
    const held = ownedKeys.get(id);
    if (event.type !== "keydown") {
      if (held !== undefined) {
        if (event.type === "keyup") {
          ownedKeys.delete(id);
        }
        if (nativePhase(held, event)) {
          event.stopImmediatePropagation();
        } else {
          if (!event.repeat) {
            delete held.native;
          }
          consume(event);
        }
      }
      return;
    }
    const input = foregroundKeyAction(event.key, event.shiftKey);
    const tab = event.key === "Tab";
    if (event.repeat && held !== undefined) {
      consume(event);
      const { surface } = held;
      if (
        surface !== undefined &&
        !event.isComposing &&
        !modified(event) &&
        (input === "next" || input === "previous") &&
        top() === surface &&
        ready(surface) &&
        held.check()
      ) {
        step(surface, input, tab);
      }
      return;
    }
    ownedKeys.delete(id);
    if (
      input === undefined ||
      event.defaultPrevented ||
      event.isComposing ||
      event.keyCode === 229 ||
      modified(event)
    ) {
      return;
    }
    const surface = top();
    if (native(surface, event) || surface?.preserveKey?.(event) === true) {
      return;
    }
    if (input === "close") {
      escape(event, id);
      return;
    }
    if (surface === undefined) {
      return;
    }
    if (tab && surface.tabTargets === undefined) {
      return;
    }

    recordInputModality(document, "keyboard");
    event.stopImmediatePropagation();
    if (event.repeat) {
      event.preventDefault();
      ownedKeys.set(id, { check: () => false });
      return;
    }
    const check = capture(surface, event);
    const press: OwnedKey = { check, surface };
    ownedKeys.set(id, press);
    if (!ready(surface) || !check()) {
      event.preventDefault();
      return;
    }
    if (input === "press") {
      const active = document.activeElement;
      const target = event.composedPath()[0];
      const admitted =
        inside(surface, active) && inside(surface, target)
          ? targetAction(surface, active)
          : undefined;
      if (
        admitted?.native === true &&
        admitted.element instanceof view.HTMLButtonElement &&
        admitted.element === active &&
        active === document.activeElement &&
        admitted.element === target &&
        (key === "enter" || key === " ") &&
        check()
      ) {
        press.native = admitted;
        return;
      }
      event.preventDefault();
      if (check()) {
        admitted?.activate();
      }
      return;
    }
    event.preventDefault();
    step(surface, input, tab);
  };

  const clearRelease = () => {
    view.clearTimeout(releaseTimer);
    releaseTimer = undefined;
    released = undefined;
  };
  const samePointer = (origin: PointerEvent, event: PointerEvent) =>
    origin.pointerId === event.pointerId && origin.pointerType === event.pointerType;
  const travelled = (origin: PointerEvent, event: MouseEvent) =>
    Math.hypot(event.clientX - origin.clientX, event.clientY - origin.clientY);
  const eventNode = (event: Event) => {
    const target = event.composedPath()[0];
    return target instanceof view.Node ? target : undefined;
  };
  const currentSecondary = (press: SecondaryPress, target: Node | undefined) => {
    const { action: captured, check, surface } = press;
    if (
      press.cancelled ||
      target === undefined ||
      !inside(surface, target) ||
      top() !== surface ||
      !ready(surface) ||
      !check() ||
      !captured.available()
    ) {
      return undefined;
    }
    const current = targetAction(surface, target);
    return sameAction(captured, current) && !press.cancelled && check() ? current : undefined;
  };
  const onPointerDown = (event: PointerEvent) => {
    clearRelease();
    const secondaryButton =
      event.button === 2 && (event.pointerType === "mouse" || event.pointerType === "pen");
    if (secondaryButton || (secondary !== undefined && samePointer(secondary.down, event))) {
      secondary = undefined;
    }
    if (!secondaryButton || !event.isPrimary || event.defaultPrevented || modified(event)) {
      return;
    }
    const surface = top();
    const target = eventNode(event);
    if (
      surface === undefined ||
      !ready(surface) ||
      !inside(surface, target) ||
      (target instanceof view.Element &&
        target.closest('input, select, textarea, [contenteditable]:not([contenteditable="false"])'))
    ) {
      return;
    }
    const check = capture(surface, event);
    const admitted = check() ? targetAction(surface, target) : undefined;
    if (admitted !== undefined && check()) {
      secondary = {
        action: admitted,
        cancelled: false,
        check,
        down: event,
        menuHandled: false,
        surface,
      };
      recordInputModality(document, "pointer");
      event.stopImmediatePropagation();
    }
  };
  const onPointerMove = (event: PointerEvent) => {
    const press = secondary;
    if (
      press !== undefined &&
      samePointer(press.down, event) &&
      (event.buttons !== 2 ||
        travelled(press.down, event) > SECONDARY_SLOP_PX ||
        top() !== press.surface ||
        !press.check())
    ) {
      press.cancelled = true;
    }
  };
  const onDragStart = () => {
    if (secondary !== undefined) {
      secondary.cancelled = true;
    }
  };
  const onPointerEnd = (event: PointerEvent) => {
    const press = secondary;
    if (press === undefined || !samePointer(press.down, event)) {
      return;
    }
    if (event.type !== "pointerup") {
      secondary = undefined;
      return;
    }
    if (event.button !== 2) {
      secondary = undefined;
      return;
    }
    const target = eventNode(event);
    // Pen may implicitly capture the pointer. Use the physical hit for a trusted release.
    const hit = event.isTrusted ? document.elementFromPoint(event.clientX, event.clientY) : target;
    const admitted =
      event.defaultPrevented || modified(event) || travelled(press.down, event) > SECONDARY_SLOP_PX
        ? undefined
        : currentSecondary(press, hit ?? undefined);
    secondary = undefined;
    event.stopImmediatePropagation();
    released = {
      auxPending: true,
      menuPending: admitted !== undefined && !press.menuHandled,
      target,
      up: event,
    };
    releaseTimer = view.setTimeout(clearRelease, 0);
    if (admitted !== undefined) {
      event.preventDefault();
      admitted.activate();
    }
  };
  const matchesMouse = (origin: PointerEvent, event: MouseEvent, target: Node | undefined) =>
    travelled(origin, event) === 0 &&
    (event instanceof view.PointerEvent
      ? samePointer(origin, event)
      : target !== undefined && eventNode(event) === target);
  const onSecondaryMouse = (event: MouseEvent) => {
    const press = secondary;
    if (event.button !== 2 || modified(event)) {
      if (press !== undefined && event.type === "mousedown" && (event.buttons & 2) !== 0) {
        press.cancelled = true;
      }
      return;
    }
    if (press !== undefined && event.type === "mouseup") {
      // A chord can release button 2 without pointerup. Let the other button's own events through.
      secondary = undefined;
      return;
    }
    if (press !== undefined && (event.type === "mousedown" || event.type === "contextmenu")) {
      const target = eventNode(event);
      if (
        travelled(press.down, event) <= SECONDARY_SLOP_PX &&
        (event instanceof view.PointerEvent
          ? samePointer(press.down, event)
          : event.buttons === 2 && target !== undefined && press.action.element.contains(target))
      ) {
        if (event.type === "mousedown") {
          event.stopImmediatePropagation();
        } else if (
          !event.defaultPrevented &&
          event.cancelable &&
          !press.menuHandled &&
          currentSecondary(press, target) !== undefined
        ) {
          // Some browsers dispatch the menu before pointerup. Reserve it now and commit only on up.
          press.menuHandled = true;
          consume(event);
        } else if (!press.menuHandled) {
          press.cancelled = true;
        }
      }
      return;
    }
    const release = released;
    // Chromium gives synchronously generated mouse events the pointerup timestamp. The fallback
    // also requires the original event target when it has no pointer identity.
    if (
      release === undefined ||
      event.timeStamp !== release.up.timeStamp ||
      !matchesMouse(release.up, event, release.target)
    ) {
      return;
    }
    if (event.type === "contextmenu" && release.menuPending) {
      release.menuPending = false;
      consume(event);
    } else if (event.type === "auxclick" && release.auxPending) {
      release.auxPending = false;
      consume(event);
    } else if (event.type === "mouseup") {
      event.stopImmediatePropagation();
    }
  };
  const clear = () => {
    ownedKeys.clear();
    secondary = undefined;
    clearRelease();
  };
  const invalidateNative = () => {
    for (const key of ownedKeys.values()) {
      delete key.native;
    }
  };
  const invalidateCovered = () => {
    if (secondary === undefined && ownedKeys.size === 0) {
      return;
    }
    const surface = top();
    if (secondary !== undefined && secondary.surface !== surface) {
      secondary.cancelled = true;
    }
    for (const key of ownedKeys.values()) {
      if (key.surface !== surface) {
        delete key.native;
      }
    }
  };
  const secondaryTypes = ["mousedown", "mouseup", "auxclick", "contextmenu"] as const;
  for (const type of KEY_EVENTS) {
    view.addEventListener(type, onKey, true);
  }
  for (const type of secondaryTypes) {
    view.addEventListener(type, onSecondaryMouse, true);
  }
  view.addEventListener("pointerdown", onPointerDown, true);
  view.addEventListener("pointermove", onPointerMove, true);
  view.addEventListener("pointerup", onPointerEnd, true);
  view.addEventListener("pointercancel", onPointerEnd, true);
  view.addEventListener("lostpointercapture", onPointerEnd, true);
  view.addEventListener("dragstart", onDragStart, true);
  view.addEventListener("focusin", invalidateNative, true);
  view.addEventListener("blur", clear);

  return {
    dispose() {
      disposed = true;
      surfaces.clear();
      clear();
      for (const type of KEY_EVENTS) {
        view.removeEventListener(type, onKey, true);
      }
      for (const type of secondaryTypes) {
        view.removeEventListener(type, onSecondaryMouse, true);
      }
      view.removeEventListener("pointerdown", onPointerDown, true);
      view.removeEventListener("pointermove", onPointerMove, true);
      view.removeEventListener("pointerup", onPointerEnd, true);
      view.removeEventListener("pointercancel", onPointerEnd, true);
      view.removeEventListener("lostpointercapture", onPointerEnd, true);
      view.removeEventListener("dragstart", onDragStart, true);
      view.removeEventListener("focusin", invalidateNative, true);
      view.removeEventListener("blur", clear);
    },
    register(surface) {
      if (disposed || surface.root.ownerDocument !== document || surfaces.has(surface)) {
        throw new RangeError("Foreground surface requires its document's active router");
      }
      surfaces.add(surface);
      invalidateCovered();
      let registered = true;
      return () => {
        if (registered) {
          registered = false;
          surfaces.delete(surface);
          invalidateCovered();
        }
      };
    },
  };
}
