// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { createModalInputGate } from "../../../input/modalInput.ts";
import { guardClicks } from "../../ui/dom/domPress.ts";
import { bindHoldActions, type HoldAction, type HoldActionsOptions } from "./holdActions.ts";

function pointer(type: string, target: EventTarget, init: PointerEventInit = {}) {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: 8,
    clientY: 8,
    isPrimary: true,
    pointerId: 4,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

function click(target: EventTarget, pointerId?: number, detail = 1) {
  const init = { bubbles: true, cancelable: true, detail };
  const event =
    pointerId === undefined
      ? new MouseEvent("click", init)
      : new PointerEvent("click", { ...init, pointerId });
  target.dispatchEvent(event);
  return event;
}

let root: HTMLElement;
let button: HTMLButtonElement;
let child: HTMLElement;
let action: HoldAction;
let enabled: boolean;
let optedIn: boolean;
let drawnMs: number | null;
let stop: () => void;
let stopGuard: () => void;
let original: ReturnType<typeof vi.fn<() => void>>;
let gate: ReturnType<typeof createModalInputGate>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  root = document.createElement("div");
  button = document.createElement("button");
  child = document.createElement("span");
  button.append(child);
  root.append(button);
  document.body.append(root);
  enabled = true;
  optedIn = true;
  drawnMs = -1000;
  gate = createModalInputGate();
  original = vi.fn();
  button.addEventListener("click", () => original());
  action = {
    activate: original,
    available: () => enabled,
    element: button,
    rule: { holdMs: 100, slopPx: 5 },
  };
  const guard = { gate, tapGuard: { drawnMs: () => drawnMs, guardMs: 50 } };
  stopGuard = guardClicks(guard, root);
  stop = bindHoldActions(
    {
      guard,
      resolve: (target) =>
        optedIn && target instanceof Node && button.contains(target) ? action : null,
    },
    root,
  );
});

afterEach(() => {
  stop();
  stopGuard();
  root.remove();
  vi.useRealTimers();
});

it("dispatches the current original action once during hold and suppresses only its pointer release", () => {
  stopGuard();
  const old = original;
  pointer("pointerdown", child);
  original = vi.fn();
  action = { ...action, activate: original };
  vi.advanceTimersByTime(100);
  vi.advanceTimersByTime(200);
  expect(old).not.toHaveBeenCalled();
  expect(original).toHaveBeenCalledOnce();
  pointer("lostpointercapture", child);
  pointer("pointerup", child);
  expect(click(child, 99).defaultPrevented).toBe(false);
  expect(original).toHaveBeenCalledTimes(2);
  expect(click(child, 4).defaultPrevented).toBe(true);
  expect(original).toHaveBeenCalledTimes(2);
  pointer("pointerdown", child);
  pointer("pointerup", child);
  click(child, 4);
  expect(original).toHaveBeenCalledTimes(3);
});

it("keeps native taps and keyboard activation and uses a current explicit hold override", () => {
  pointer("pointerdown", button);
  vi.advanceTimersByTime(20);
  pointer("pointerup", button);
  click(button, 4);
  expect(original).toHaveBeenCalledOnce();
  pointer("pointerdown", button);
  const hold = vi.fn();
  action = { ...action, hold };
  vi.advanceTimersByTime(100);
  expect(hold).toHaveBeenCalledOnce();
  pointer("pointerup", button);
  click(button, undefined, 0);
  expect(original).toHaveBeenCalledTimes(2);
  expect(click(button).defaultPrevented).toBe(true);
  expect(original).toHaveBeenCalledTimes(2);
});

it("handles an elapsed threshold at pointerup without relying on the timer being delivered", () => {
  pointer("pointerdown", child);
  vi.spyOn(window.performance, "now").mockReturnValue(120);
  pointer("pointerup", child);
  click(child);
  expect(original).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(200);
  expect(original).toHaveBeenCalledOnce();
  vi.restoreAllMocks();
});

it.each(["drag", "leave", "cancel", "lostcapture", "blur"] as const)(
  "cancels a pending hold on %s without taking over ordinary input",
  (reason) => {
    pointer("pointerdown", child);
    if (reason === "drag") {
      pointer("pointermove", child, { clientX: 30 });
    }
    if (reason === "leave") {
      pointer("pointerout", child, { relatedTarget: document.body });
    }
    if (reason === "cancel") {
      pointer("pointercancel", child);
    }
    if (reason === "lostcapture") {
      pointer("lostpointercapture", child);
    }
    if (reason === "blur") {
      window.dispatchEvent(new Event("blur"));
    }
    vi.advanceTimersByTime(150);
    expect(original).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  },
);

it.each(["disabled", "aria-disabled", "unavailable", "detached", "replaced"] as const)(
  "revalidates a %s control immediately before dispatch",
  (reason) => {
    pointer("pointerdown", child);
    if (reason === "disabled") {
      button.disabled = true;
    }
    if (reason === "aria-disabled") {
      root.setAttribute("aria-disabled", "true");
    }
    if (reason === "unavailable") {
      enabled = false;
    }
    if (reason === "detached") {
      button.remove();
    }
    if (reason === "replaced") {
      action = { ...action, element: document.createElement("button") };
    }
    vi.advanceTimersByTime(100);
    expect(original).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  },
);

it("preserves the captured modal revision and checks the current tap guard", () => {
  pointer("pointerdown", child);
  gate.open().close();
  vi.advanceTimersByTime(100);
  expect(original).not.toHaveBeenCalled();
  pointer("pointerup", child);
  click(child, 4);
  expect(original).not.toHaveBeenCalled();
  pointer("pointerdown", child);
  drawnMs = null;
  vi.advanceTimersByTime(100);
  expect(original).not.toHaveBeenCalled();
});

it("never consumes another control or a later task's MouseEvent click, and new downs clear the witness", () => {
  stopGuard();
  const other = document.createElement("button");
  root.append(other);
  const otherAction = vi.fn();
  other.addEventListener("click", otherAction);
  pointer("pointerdown", child);
  vi.advanceTimersByTime(100);
  pointer("pointerup", child);
  click(other);
  expect(otherAction).toHaveBeenCalledOnce();
  click(button, undefined, 0);
  expect(original).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(0);
  click(child);
  expect(original).toHaveBeenCalledTimes(3);
  pointer("pointerdown", child);
  vi.advanceTimersByTime(100);
  pointer("pointerup", child);
  pointer("pointerdown", other);
  pointer("pointerup", other);
  click(child);
  expect(original).toHaveBeenCalledTimes(5);
});

it("leaves continuous or otherwise excluded controls alone and refuses disabled starts", () => {
  optedIn = false;
  pointer("pointerdown", child);
  vi.advanceTimersByTime(150);
  pointer("pointerup", child);
  click(child, 4);
  expect(original).toHaveBeenCalledOnce();
  optedIn = true;
  button.disabled = true;
  pointer("pointerdown", child);
  vi.advanceTimersByTime(150);
  expect(original).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("allows callback-driven replacement and disposal without retaining timers or listeners", () => {
  action = {
    ...action,
    hold: () => {
      original();
      button.replaceWith(document.createElement("button"));
      stop();
    },
  };
  pointer("pointerdown", child);
  vi.advanceTimersByTime(100);
  pointer("pointerup", child);
  expect(original).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
  stop();
  root.append(button);
  pointer("pointerdown", child);
  vi.advanceTimersByTime(100);
  pointer("pointerup", child);
  click(child, 4);
  expect(original).toHaveBeenCalledTimes(2);
});

it("disposes pending gestures, release witnesses and all registered listeners", () => {
  const adds = [
    vi.spyOn(document, "addEventListener"),
    vi.spyOn(root, "addEventListener"),
    vi.spyOn(window, "addEventListener"),
  ];
  const removes = [
    vi.spyOn(document, "removeEventListener"),
    vi.spyOn(root, "removeEventListener"),
    vi.spyOn(window, "removeEventListener"),
  ];
  const dispose = bindHoldActions({ guard: { gate }, resolve: () => action }, root);
  const registered = adds.map((spy) => [...spy.mock.calls]);
  dispose();
  registered.forEach((calls, index) => {
    for (const call of calls) {
      expect(removes[index]).toHaveBeenCalledWith(...call);
    }
  });
  pointer("pointerdown", child);
  stop();
  vi.advanceTimersByTime(100);
  expect(original).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  const finish = bindHoldActions({ guard: { gate }, resolve: () => action }, root);
  pointer("pointerdown", child);
  vi.advanceTimersByTime(100);
  pointer("pointerup", child);
  expect(original).toHaveBeenCalledOnce();
  finish();
  expect(vi.getTimerCount()).toBe(0);
  vi.restoreAllMocks();
});

function bindRelease(
  extra: Partial<import("./holdActions.ts").PointerReleaseHoldActionsOptions> = {},
) {
  stop();
  stopGuard();
  stop = bindHoldActions(
    {
      activation: "pointer-release",
      guard: { gate, tapGuard: { drawnMs: () => drawnMs, guardMs: 50 } },
      resolve: (target) => (optedIn && target === button ? action : null),
      resolvePointer: (event) => (optedIn && event.clientX < 30 ? action : null),
      ...extra,
    },
    root,
  );
}

it("opts a nonprimary touch into one UI tap or hold while three outside fingers remain down", () => {
  const world = document.createElement("canvas");
  document.body.append(world);
  const worldDown = vi.fn();
  world.addEventListener("pointerdown", worldDown);
  try {
    for (const allowNonPrimaryTouch of [undefined, false, true]) {
      const activate = vi.fn();
      const hold = vi.fn();
      action = { ...action, activate, hold };
      bindRelease({
        ...(allowNonPrimaryTouch === undefined ? {} : { allowNonPrimaryTouch }),
        pointerTarget: document,
      });
      for (const pointerId of [1, 2, 3]) {
        pointer("pointerdown", world, {
          clientX: 100,
          isPrimary: pointerId === 1,
          pointerId,
          pointerType: "touch",
        });
      }
      const touch = { isPrimary: false, pointerId: 4, pointerType: "touch" };
      pointer("pointerdown", child, touch);
      pointer("pointerup", child, touch);
      expect(activate).toHaveBeenCalledTimes(allowNonPrimaryTouch === true ? 1 : 0);
      if (allowNonPrimaryTouch === true) {
        expect(click(child, 4).defaultPrevented).toBe(true);
      }
      pointer("pointerdown", child, touch);
      pointer("pointerdown", child, { ...touch, pointerId: 5 });
      pointer("pointerup", child, { ...touch, pointerId: 5 });
      vi.advanceTimersByTime(100);
      expect(hold).toHaveBeenCalledTimes(allowNonPrimaryTouch === true ? 1 : 0);
      pointer("pointerup", child, touch);
      if (allowNonPrimaryTouch === true) {
        expect(click(child, 4).defaultPrevented).toBe(true);
      }
      expect(activate).toHaveBeenCalledTimes(allowNonPrimaryTouch === true ? 1 : 0);
      for (const pointerId of [1, 2, 3]) {
        pointer("pointerup", world, {
          clientX: 100,
          isPrimary: pointerId === 1,
          pointerId,
          pointerType: "touch",
        });
      }
    }
    expect(worldDown).toHaveBeenCalledTimes(9);
    expect(original).not.toHaveBeenCalled();
  } finally {
    world.remove();
  }
});

it("releases moved or canceled nonprimary ownership for a fresh touch without admitting other pointer kinds", () => {
  const activate = vi.fn();
  action = { ...action, activate };
  bindRelease({ allowNonPrimaryTouch: true });
  const touch = { isPrimary: false, pointerId: 4, pointerType: "touch" };
  pointer("pointerdown", child, touch);
  pointer("pointermove", child, { ...touch, clientX: 20 });
  pointer("pointerdown", child, { ...touch, pointerId: 5 });
  pointer("pointerup", child, touch);
  pointer("pointerup", child, { ...touch, pointerId: 5 });
  expect(activate).toHaveBeenCalledOnce();
  expect(click(child, 5).defaultPrevented).toBe(true);
  pointer("pointerdown", child, { ...touch, pointerId: 6 });
  pointer("pointercancel", child, { ...touch, pointerId: 6 });
  pointer("pointerdown", child, { ...touch, pointerId: 7 });
  pointer("pointerup", child, { ...touch, pointerId: 7 });
  expect(activate).toHaveBeenCalledTimes(2);
  expect(click(child, 7).defaultPrevented).toBe(true);
  for (const init of [
    { button: 0, isPrimary: false, pointerType: "mouse" },
    { button: 0, isPrimary: false, pointerType: "pen" },
    { button: 2, isPrimary: true, pointerType: "mouse" },
    { button: 2, isPrimary: false, pointerType: "touch" },
  ]) {
    pointer("pointerdown", child, init);
    vi.advanceTimersByTime(100);
    pointer("pointerup", child, init);
  }
  expect(activate).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBeLessThanOrEqual(1);
});

it("keeps disabled, availability and captured modal guards on opted-in touch dispatch", () => {
  const activate = vi.fn();
  action = { ...action, activate };
  bindRelease({ allowNonPrimaryTouch: true });
  for (const reason of ["disabled", "unavailable", "modal"]) {
    const touch = { isPrimary: false, pointerId: 4, pointerType: "touch" };
    pointer("pointerdown", child, touch);
    button.disabled = reason === "disabled";
    enabled = reason !== "unavailable";
    const modal = reason === "modal" ? gate.open() : undefined;
    vi.advanceTimersByTime(100);
    pointer("pointerup", child, touch);
    expect(activate).not.toHaveBeenCalled();
    button.disabled = false;
    enabled = true;
    modal?.close();
  }
  const fresh = { isPrimary: false, pointerId: 5, pointerType: "touch" };
  pointer("pointerdown", child, fresh);
  pointer("pointerup", child, fresh);
  expect(activate).toHaveBeenCalledOnce();
});

it("snapshots the optional policy in native-click mode and validates both modes before listeners", () => {
  stop();
  stopGuard();
  const hold = vi.fn();
  action = { ...action, hold };
  const options = { allowNonPrimaryTouch: true, guard: { gate }, resolve: () => action };
  stop = bindHoldActions(options, root);
  options.allowNonPrimaryTouch = false;
  const touch = { isPrimary: false, pointerId: 4, pointerType: "touch" };
  pointer("pointerdown", child, touch);
  vi.advanceTimersByTime(100);
  pointer("pointerup", child, touch);
  expect(hold).toHaveBeenCalledOnce();
  expect(click(child, 4).defaultPrevented).toBe(true);
  expect(click(child, undefined, 0).defaultPrevented).toBe(false);
  expect(original).toHaveBeenCalledOnce();
  stop();
  stop = bindHoldActions(options, root);
  pointer("pointerdown", child, touch);
  vi.advanceTimersByTime(100);
  pointer("pointerup", child, touch);
  expect(hold).toHaveBeenCalledOnce();
  pointer("pointerdown", child, { pointerType: "mouse" });
  vi.advanceTimersByTime(100);
  pointer("pointerup", child, { pointerType: "mouse" });
  expect(hold).toHaveBeenCalledTimes(2);
  stop();
  const adds = [
    vi.spyOn(root, "addEventListener"),
    vi.spyOn(document, "addEventListener"),
    vi.spyOn(window, "addEventListener"),
  ];
  try {
    for (const invalid of [null, 0, 1, "true"]) {
      for (const release of [false, true]) {
        const bad = {
          ...options,
          allowNonPrimaryTouch: invalid,
          ...(release ? { activation: "pointer-release", resolvePointer: () => action } : {}),
        };
        expect(() => bindHoldActions(bad as unknown as HoldActionsOptions, root)).toThrow(
          RangeError,
        );
      }
    }
    for (const add of adds) {
      expect(add).not.toHaveBeenCalled();
    }
  } finally {
    for (const add of adds) {
      add.mockRestore();
    }
  }
});

it("owns short releases and holds once while preserving native keyboard and unrelated clicks", () => {
  bindRelease();
  pointer("pointerdown", child);
  pointer("pointerup", child);
  expect(original).toHaveBeenCalledOnce();
  expect(click(child, 4).defaultPrevented).toBe(true);
  expect(original).toHaveBeenCalledOnce();
  expect(click(child, undefined, 0).defaultPrevented).toBe(false);
  expect(original).toHaveBeenCalledTimes(2);
  pointer("pointerdown", child);
  vi.advanceTimersByTime(100);
  pointer("pointerup", child);
  expect(original).toHaveBeenCalledTimes(3);
  expect(click(child, 99).defaultPrevented).toBe(false);
  expect(original).toHaveBeenCalledTimes(4);
  expect(click(child, 4).defaultPrevented).toBe(true);
  expect(original).toHaveBeenCalledTimes(4);
  const other = document.createElement("button");
  root.append(other);
  expect(click(other, 4).defaultPrevented).toBe(false);
});

it("observes pass-through coordinates without intercepting canvas pointers or compatibility clicks", () => {
  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  root.style.pointerEvents = "none";
  const down = vi.fn(),
    up = vi.fn(),
    nativeClick = vi.fn();
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("click", nativeClick);
  const capture = vi.fn();
  Object.assign(canvas, { releasePointerCapture: capture, setPointerCapture: capture });
  const show = vi.fn();
  bindRelease({ onPressChange: show, pointerTarget: document });
  try {
    expect(pointer("pointerdown", canvas).defaultPrevented).toBe(false);
    // A second finger cannot replace the followed logical action.
    pointer("pointerdown", canvas, { isPrimary: false, pointerId: 9 });
    pointer("pointerup", canvas, { pointerId: 9 });
    vi.advanceTimersByTime(100);
    expect(original).toHaveBeenCalledOnce();
    expect(pointer("pointerup", canvas).defaultPrevented).toBe(false);
    expect(click(canvas, 4).defaultPrevented).toBe(false);
    expect(original).toHaveBeenCalledOnce();
    expect(down).toHaveBeenCalledTimes(2);
    expect(up).toHaveBeenCalledTimes(2);
    expect(nativeClick).toHaveBeenCalledOnce();
    expect(capture).not.toHaveBeenCalled();
    expect(show.mock.calls.map(([value]) => value)).toEqual([action, null]);
  } finally {
    stop();
    canvas.remove();
  }
});

it("uses current callbacks but refuses logical replacement and conflicting coordinate resolution", () => {
  const identity = {};
  action = { ...action, identity };
  bindRelease();
  pointer("pointerdown", child);
  const current = vi.fn();
  action = { ...action, activate: current };
  vi.advanceTimersByTime(100);
  expect(current).toHaveBeenCalledOnce();
  expect(original).not.toHaveBeenCalled();
  pointer("pointerup", child);
  pointer("pointerdown", child);
  action = { ...action, identity: {} };
  vi.advanceTimersByTime(100);
  pointer("pointerup", child);
  expect(current).toHaveBeenCalledOnce();
  action = { ...action, identity: NaN };
  bindRelease();
  pointer("pointerdown", child);
  action = { ...action, identity: NaN };
  pointer("pointerup", child);
  expect(current).toHaveBeenCalledTimes(2);
  bindRelease({ resolve: () => ({ ...action, identity: "different" }) });
  pointer("pointerdown", child);
  vi.advanceTimersByTime(100);
  pointer("pointerup", child);
  expect(current).toHaveBeenCalledTimes(2);
});

it("cancels physical exit, drag, stale guard and hidden-page gestures and clears visuals", () => {
  const show = vi.fn();
  action = { ...action, rule: { holdMs: 100, slopPx: Infinity } };
  bindRelease({ onPressChange: show });
  pointer("pointerdown", child);
  pointer("pointerout", child, { clientX: 40, relatedTarget: document.body });
  pointer("pointerup", child);
  expect(click(child, 4).defaultPrevented).toBe(true);
  action = { ...action, rule: { holdMs: 100, slopPx: 5 } };
  pointer("pointerdown", child);
  pointer("pointermove", child, { clientX: 20 });
  pointer("pointerup", child);
  pointer("pointerdown", child);
  gate.open().close();
  vi.advanceTimersByTime(100);
  pointer("pointerup", child);
  pointer("pointerdown", child);
  enabled = false;
  pointer("pointerup", child);
  enabled = true;
  pointer("pointerdown", child);
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  document.dispatchEvent(new Event("visibilitychange"));
  hidden.mockRestore();
  vi.advanceTimersByTime(100);
  pointer("pointerup", child);
  expect(original).not.toHaveBeenCalled();
  expect(show.mock.calls.filter(([value]) => value === null)).toHaveLength(5);
  vi.runOnlyPendingTimers();
  expect(vi.getTimerCount()).toBe(0);
});

it("handles visual disposal, replacement and release reentrancy before semantic dispatch", () => {
  bindRelease({
    onPressChange: (value) => {
      if (value !== null) {
        stop();
      }
    },
  });
  pointer("pointerdown", child);
  vi.advanceTimersByTime(100);
  pointer("pointerup", child);
  expect(original).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  bindRelease({
    onPressChange: (value) => {
      if (value !== null) {
        button.remove();
      }
    },
  });
  pointer("pointerdown", child);
  expect(vi.getTimerCount()).toBe(0);
  root.append(button);
  bindRelease({
    onPressChange: (value) => {
      if (value === null) {
        stop();
      }
    },
  });
  pointer("pointerdown", child);
  pointer("pointerup", child);
  expect(original).not.toHaveBeenCalled();
});

it("does not dispatch an old release after its visual cleanup starts a fresh gesture", () => {
  let reentered = false;
  bindRelease({
    onPressChange: (value) => {
      if (value === null && !reentered) {
        reentered = true;
        pointer("pointerdown", child);
      }
    },
  });
  pointer("pointerdown", child);
  pointer("pointerup", child);
  expect(original).not.toHaveBeenCalled();
  pointer("pointerup", child);
  expect(original).toHaveBeenCalledOnce();
  expect(click(child, 4).defaultPrevented).toBe(true);
  expect(original).toHaveBeenCalledOnce();
});

it("validates pointer scope before listeners and disposes every opt-in listener despite visual errors", () => {
  const add = vi.spyOn(document, "addEventListener");
  expect(() =>
    bindHoldActions(
      {
        activation: "pointer-release",
        guard: { gate },
        pointerTarget: document.body,
        resolve: () => action,
        resolvePointer: () => action,
      },
      root,
    ),
  ).toThrow(RangeError);
  expect(add).not.toHaveBeenCalled();
  add.mockRestore();
  const added = vi.spyOn(document, "addEventListener");
  const removed = vi.spyOn(document, "removeEventListener");
  bindRelease({
    onPressChange: (value) => {
      if (value === null) {
        throw new Error("visual gone");
      }
    },
    pointerTarget: document,
  });
  const registered = [...added.mock.calls];
  pointer("pointerdown", child);
  expect(stop).toThrow("visual gone");
  for (const call of registered) {
    expect(removed).toHaveBeenCalledWith(...call);
  }
  expect(vi.getTimerCount()).toBe(0);
  vi.restoreAllMocks();
});

it("invalidates synchronously across modal changes without losing the held release or blocking fresh presses", () => {
  stop();
  stopGuard();
  const show = vi.fn();
  let opened: ReturnType<typeof gate.open> | undefined;
  action = {
    ...action,
    activate: () => {
      original();
      opened = gate.open();
    },
  };
  const binding = bindHoldActions(
    {
      activation: "pointer-release",
      guard: { gate },
      onPressChange: show,
      resolve: (target) => (target === button ? action : null),
      resolvePointer: () => action,
    },
    root,
  );
  stop = binding;
  const stopClicks = guardClicks({ gate }, root);
  const underlying = document.createElement("button");
  const underneath = vi.fn();
  underlying.addEventListener("click", underneath);
  root.append(underlying);
  // The real modal subscription calls cancel immediately during subscription setup.
  const unsubscribe = gate.subscribe(binding.cancel);
  try {
    pointer("pointerdown", child);
    vi.advanceTimersByTime(60);
    const interrupt = gate.open();
    expect(show.mock.calls.at(-1)).toEqual([null]);
    expect(vi.getTimerCount()).toBe(0);
    interrupt.close();
    pointer("pointerup", child);
    expect(click(child, 4).defaultPrevented).toBe(true);
    expect(original).not.toHaveBeenCalled();
    pointer("pointerdown", child);
    vi.advanceTimersByTime(100);
    expect(original).toHaveBeenCalledOnce();
    expect(show.mock.calls.at(-1)).toEqual([null]);
    expect(vi.getTimerCount()).toBe(0);
    opened!.close();
    pointer("pointerup", underlying);
    expect(click(underlying, 4).defaultPrevented).toBe(true);
    expect(underneath).not.toHaveBeenCalled();
    expect(click(child, 4).defaultPrevented).toBe(true);
    expect(original).toHaveBeenCalledOnce();
    action = { ...action, activate: original };
    pointer("pointerdown", child);
    pointer("pointerup", child);
    expect(click(child, 4).defaultPrevented).toBe(true);
    expect(original).toHaveBeenCalledTimes(2);
    expect(show.mock.calls.map(([value]) => value === null)).toEqual([
      false,
      true,
      false,
      true,
      false,
      true,
    ]);
    binding();
    const calls = show.mock.calls.length;
    binding.cancel();
    expect(show).toHaveBeenCalledTimes(calls);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    unsubscribe();
    stopClicks();
    binding();
  }
});
