// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";

import { createModalInputGate } from "../../../input/modalInput.ts";
import { bindHoldActions } from "../../input/dom/holdActions.ts";
import { type ButtonState, createButton } from "./button.ts";

const rule = { holdMs: 100, slopPx: 5 };

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

it("keeps the native element, face and focus when changing named content and presentation", () => {
  let state: ButtonState = { selected: true, toggled: false };
  const view = createButton(document, {
    appearance: {
      className: "skin",
      face: { className: "face" },
      layout: {
        frame: { faceInsets: { bottom: 4, left: 0, right: 0, top: 0 } },
        size: {
          selection: "standard",
          tokens: { standard: { height: 8, minWidth: 10, paddingX: 1, paddingY: 1 } },
        },
      },
      role: "navigation",
    },
    content: { kind: "text", label: "Open" },
    getAction: () => ({ activate: vi.fn() }),
    getState: () => state,
    rule,
  });
  const { element, face } = view;
  document.body.append(element);
  element.focus();
  expect(element.type).toBe("button");
  expect(element.textContent).toBe("Open");
  expect(element.getAttribute("aria-label")).toBeNull();
  expect(element.dataset.uiButtonRole).toBe("navigation");
  expect(element.classList.contains("skin")).toBe(true);
  expect(face.classList.contains("ui-control-button")).toBe(true);
  expect(face.style.getPropertyValue("--ui-button-face-bottom")).toBe("4");
  expect(face.dataset.uiSize).toBe("standard");
  expect(element.hasAttribute("data-ui-selected")).toBe(true);
  expect(element.getAttribute("aria-pressed")).toBe("false");

  const icon = document.createElement("img");
  view.setContent({ icon, kind: "icon", name: "Close" });
  expect(element.getAttribute("aria-label")).toBe("Close");
  expect(icon.parentElement?.getAttribute("aria-hidden")).toBe("true");
  expect(document.activeElement).toBe(element);
  expect(element.firstElementChild).toBe(face);
  expect(() => view.setContent({ kind: "icon", name: " " })).toThrow(RangeError);
  expect(element.getAttribute("aria-label")).toBe("Close");
  view.setContent({ kind: "text", label: "Resume" });
  expect(element.getAttribute("aria-label")).toBeNull();
  expect(element.textContent).toBe("Resume");

  state = { toggled: true };
  view.refresh();
  view.setPressed(true);
  expect(element.hasAttribute("data-ui-selected")).toBe(false);
  expect(element.hasAttribute("data-ui-pressed")).toBe(true);
  expect(element.getAttribute("aria-pressed")).toBe("true");
  view.dispose();
  expect(element.hasAttribute("data-ui-pressed")).toBe(false);
  expect(view.holdAction()).toBeNull();
});

it("rechecks native disabled, visible refusal, omission and inherited isolation at invocation", () => {
  let state: ButtonState = {};
  const activate = vi.fn();
  const onUnavailable = vi.fn();
  const root = document.createElement("div");
  const reason = document.createElement("p");
  const view = createButton(document, {
    content: { kind: "text", label: "Open" },
    getAction: () => ({ activate }),
    getState: () => state,
    onUnavailable,
    reason,
    rule,
  });
  root.append(view.element, reason);
  document.body.append(root);
  view.element.focus();
  state = { availability: { kind: "unavailable", reason: "Need a key" } };
  view.element.click();
  expect(activate).not.toHaveBeenCalled();
  expect(onUnavailable).toHaveBeenLastCalledWith("Need a key");
  expect(view.element.disabled).toBe(false);
  expect(document.activeElement).toBe(view.element);
  expect(view.element.getAttribute("aria-disabled")).toBe("true");
  expect(view.element.getAttribute("aria-description")).toBe("Need a key");
  expect(reason.textContent).toBe("Need a key");
  view.holdAction()!.hold!();
  expect(onUnavailable).toHaveBeenCalledTimes(2);

  state = { availability: { kind: "disabled" } };
  view.refresh();
  expect(view.element.disabled).toBe(true);
  expect(view.element.getAttribute("aria-disabled")).toBeNull();
  expect(view.holdAction()).toBeNull();
  state = { availability: { kind: "omitted" } };
  view.refresh();
  expect(view.element.hidden).toBe(true);
  expect(reason.hidden).toBe(true);
  state = {};
  view.refresh();
  root.inert = true;
  view.element.click();
  expect(view.holdAction()).toBeNull();
  expect(activate).not.toHaveBeenCalled();
  root.inert = false;
  view.element.click();
  expect(activate).toHaveBeenCalledOnce();
  view.dispose();
});

it("shares one live click and hold action under the existing root binding", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const first = vi.fn();
  const replacement = vi.fn();
  const explicitHold = vi.fn();
  let action = { activate: first, hold: undefined as (() => void) | undefined, identity: 1 };
  const root = document.createElement("div");
  const view = createButton(document, {
    appearance: { layout: "caller" },
    content: { kind: "icon", name: "Mute" },
    getAction: () => ({
      activate: action.activate,
      ...(action.hold ? { hold: action.hold } : {}),
      identity: action.identity,
    }),
    rule,
  });
  root.append(view.element);
  document.body.append(root);
  const stop = bindHoldActions(
    {
      guard: { gate: createModalInputGate() },
      resolve: (target) =>
        target instanceof Node && view.element.contains(target) ? view.holdAction() : null,
    },
    root,
  );
  const send = (type: string, detail = 0) => {
    const event = new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      detail,
      isPrimary: true,
      pointerId: 4,
      pointerType: "mouse",
    });
    view.element.firstElementChild!.dispatchEvent(event);
    return event;
  };
  try {
    send("pointerdown");
    action = { ...action, activate: replacement };
    vi.advanceTimersByTime(100);
    send("pointerup");
    expect(send("click", 1).defaultPrevented).toBe(true);
    expect(replacement).toHaveBeenCalledOnce();
    view.element.click();
    expect(replacement).toHaveBeenCalledTimes(2);

    send("pointerdown");
    action = { ...action, hold: explicitHold };
    vi.advanceTimersByTime(100);
    send("pointerup");
    expect(send("click", 1).defaultPrevented).toBe(true);
    expect(explicitHold).toHaveBeenCalledOnce();
    send("pointerdown");
    action = { activate: first, hold: undefined, identity: 2 };
    vi.advanceTimersByTime(100);
    send("pointercancel");
    expect(first).not.toHaveBeenCalled();
    expect(replacement).toHaveBeenCalledTimes(2);
    const stale = view.holdAction()!;
    view.dispose();
    stale.activate();
    view.element.click();
    expect(first).not.toHaveBeenCalled();
  } finally {
    stop();
    view.dispose();
  }
});

it("lets the pointer-release root own short taps and momentary styling", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const activate = vi.fn();
  const root = document.createElement("div");
  const view = createButton(document, {
    content: { kind: "text", label: "Cancel" },
    getAction: () => ({ activate }),
    getState: () => ({ toggled: true }),
    rule,
  });
  root.append(view.element);
  document.body.append(root);
  const resolve = (target: EventTarget | null) =>
    target instanceof Node && view.element.contains(target) ? view.holdAction() : null;
  const stop = bindHoldActions(
    {
      activation: "pointer-release",
      guard: { gate: createModalInputGate() },
      onPressChange: (action) => view.setPressed(action !== null),
      resolve,
      resolvePointer: (event) => resolve(event.target),
    },
    root,
  );
  const send = (type: string, detail = 0) =>
    view.element.dispatchEvent(
      new PointerEvent(type, { bubbles: true, cancelable: true, detail, isPrimary: true }),
    );
  try {
    send("pointerdown");
    expect(view.element.hasAttribute("data-ui-pressed")).toBe(true);
    expect(view.element.getAttribute("aria-pressed")).toBe("true");
    send("pointerup");
    expect(send("click", 1)).toBe(false);
    expect(activate).toHaveBeenCalledOnce();
    expect(view.element.hasAttribute("data-ui-pressed")).toBe(false);
    send("pointerdown");
    send("pointercancel");
    expect(view.element.hasAttribute("data-ui-pressed")).toBe(false);
    expect(activate).toHaveBeenCalledOnce();
  } finally {
    stop();
    view.dispose();
  }
});
