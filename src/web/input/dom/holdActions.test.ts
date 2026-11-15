// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { createModalInputGate } from "../../../input/modalInput.ts";
import { guardClicks } from "../../ui/dom/domPress.ts";
import { bindHoldActions, type HoldAction } from "./holdActions.ts";

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
