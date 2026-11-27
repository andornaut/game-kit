// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";

import { createModalInputGate } from "../../../../input/modalInput.ts";
import { bindHoldActions } from "../../../input/dom/holdActions.ts";
import { createModalLayer, focusTargets } from "../dialogs/modalLayer.ts";
import { guardClicks } from "../domPress.ts";
import { REFUSAL_ATTRIBUTES } from "../refusalCue.ts";
import { type ButtonState, createButton } from "./button.ts";

const rule = { holdMs: 100, slopPx: 5 };

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

it("passes the actual button to initial state reads and admitted actions", () => {
  const activate = vi.fn();
  const getAction = vi.fn((element: HTMLButtonElement) => ({
    activate: () => activate(element),
  }));
  const getState = vi.fn((element: HTMLButtonElement): ButtonState => ({
    selected: element?.isConnected === false,
  }));
  const view = createButton(document, {
    content: { kind: "text", label: "Open" },
    getAction,
    getState,
    rule,
  });
  const { element } = view;
  expect(getState).toHaveBeenCalledOnce();
  expect(getState.mock.calls[0]?.[0]).toBe(element);
  expect(element.hasAttribute("data-ui-selected")).toBe(true);
  expect(view.holdAction()).toBeNull();
  expect(getAction).not.toHaveBeenCalled();

  const root = document.createElement("div");
  root.inert = true;
  root.append(element);
  document.body.append(root);
  element.click();
  expect(getAction).not.toHaveBeenCalled();

  root.inert = false;
  element.click();
  view.holdAction()!.activate();
  expect(getAction.mock.calls.map(([target]) => target === element)).toEqual([true, true, true]);
  expect(activate).toHaveBeenCalledTimes(2);
  view.dispose();
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

it("skips pointer refusal in the modal focus order and restores the caller's tab state", () => {
  let state: ButtonState = {};
  const activate = vi.fn();
  const refuse = vi.fn();
  const onUnavailable = vi.fn();
  const root = document.createElement("div");
  const dialog = document.createElement("section");
  const before = document.createElement("button");
  const after = document.createElement("button");
  const reason = document.createElement("span");
  const view = createButton(document, {
    content: { kind: "icon", name: "Previous" },
    getAction: () => ({ activate }),
    getState: () => state,
    onPointerRefusal: refuse,
    onUnavailable,
    reason,
    rule,
  });
  const { element } = view;
  dialog.append(before, element, after, reason);
  root.append(dialog);
  document.body.append(root);
  const modal = createModalLayer(root);
  const close = modal.open({ focus: before, isolation: "dialog" }, dialog);
  const key = (element: Element, key: string) =>
    element.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }));
  try {
    state = { availability: { kind: "unavailable", reason: "Need a key" } };
    view.refresh();
    expect(focusTargets(dialog)).toEqual([before, element, after]);
    state = { availability: { kind: "pointer-refusal" } };
    view.refresh();
    expect(element.hidden).toBe(false);
    expect(element.disabled).toBe(false);
    expect(element.getAttribute("aria-disabled")).toBe("true");
    expect(element.getAttribute("aria-description")).toBeNull();
    expect(reason.hidden).toBe(true);
    expect(reason.textContent).toBe("");
    expect(element.tabIndex).toBe(-1);
    expect(focusTargets(dialog)).toEqual([before, after]);
    key(before, "Tab");
    expect(document.activeElement).toBe(after);
    element.focus();
    key(element, "Enter");
    element.click();
    expect(refuse).not.toHaveBeenCalled();
    expect(onUnavailable).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();

    state = {};
    view.refresh();
    expect(element.getAttribute("tabindex")).toBeNull();
    expect(element.getAttribute("aria-disabled")).toBeNull();
    expect(focusTargets(dialog)).toEqual([before, element, after]);
    element.tabIndex = 4;
    state = { availability: { kind: "pointer-refusal" } };
    view.refresh();
    expect(element.tabIndex).toBe(-1);
    state = {};
    view.refresh();
    expect(element.tabIndex).toBe(4);
    state = { availability: { kind: "pointer-refusal" } };
    view.refresh();
    view.dispose();
    expect(element.tabIndex).toBe(4);
  } finally {
    close();
    modal.dispose();
    view.dispose();
  }
});

it("contains native pointer refusal when the current action is out of scope", () => {
  const activate = vi.fn();
  const refuse = vi.fn();
  let inScope = true;
  const view = createButton(document, {
    content: { kind: "text", label: "Next" },
    getAction: () => (inScope ? { activate } : null),
    getState: () => ({ availability: { kind: "pointer-refusal" } }),
    onPointerRefusal: refuse,
    rule,
  });
  document.body.append(view.element);
  const click = () =>
    view.element.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }),
    );
  try {
    const held = view.holdAction()!;
    inScope = false;
    expect(view.holdAction()).toBeNull();
    expect(held.available()).toBe(false);
    held.activate();
    expect(click()).toBe(false);
    expect(refuse).not.toHaveBeenCalled();

    inScope = true;
    view.element.click();
    expect(refuse).not.toHaveBeenCalled();
    expect(click()).toBe(false);
    expect(refuse).toHaveBeenCalledOnce();
    expect(activate).not.toHaveBeenCalled();
  } finally {
    view.dispose();
  }
});

it.each(["native-click", "pointer-release"] as const)(
  "dispatches one pointer refusal with the root binding in %s mode",
  (mode) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const gate = createModalInputGate();
    let drawnMs: number | null = -1000;
    const guard = { gate, tapGuard: { drawnMs: () => drawnMs, guardMs: 0 } };
    const activate = vi.fn();
    const hold = vi.fn();
    const refuse = vi.fn();
    const identity = Symbol("pager action");
    const root = document.createElement("div");
    let state: ButtonState = {};
    const view = createButton(document, {
      content: { kind: "text", label: "Next" },
      getAction: () => ({ activate, hold, identity }),
      getState: () => state,
      onPointerRefusal: refuse,
      rule,
    });
    root.append(view.element);
    document.body.append(root);
    const resolve = (target: EventTarget | null) =>
      target instanceof Node && view.element.contains(target) ? view.holdAction() : null;
    const stop = bindHoldActions(
      mode === "pointer-release"
        ? { activation: mode, guard, resolve, resolvePointer: (event) => resolve(event.target) }
        : { guard, resolve },
      root,
    );
    const stopClicks = guardClicks(guard, root);
    const send = (type: string, pointerType: "mouse" | "touch", detail = 0) =>
      view.face.firstElementChild!.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          detail,
          isPrimary: true,
          pointerId: 4,
          pointerType,
        }),
      );
    try {
      expect(view.holdAction()?.identity).toBe(identity);
      state = { availability: { kind: "pointer-refusal" } };
      expect(view.holdAction()?.identity).toBe(identity);
      send("pointerdown", "mouse");
      send("pointerup", "mouse");
      expect(refuse).toHaveBeenCalledTimes(mode === "pointer-release" ? 1 : 0);
      expect(send("click", "mouse", 1)).toBe(false);
      expect(refuse).toHaveBeenCalledOnce();
      send("pointerdown", "touch");
      vi.advanceTimersByTime(100);
      expect(refuse).toHaveBeenCalledTimes(2);
      send("pointerup", "touch");
      vi.advanceTimersByTime(0);
      expect(send("click", "touch", 1)).toBe(false);
      view.element.click();
      expect(refuse).toHaveBeenCalledTimes(2);
      expect(activate).not.toHaveBeenCalled();
      expect(hold).not.toHaveBeenCalled();

      send("pointerdown", "touch");
      const blocked = gate.open();
      vi.advanceTimersByTime(100);
      blocked.close();
      send("pointerup", "touch");
      expect(send("click", "touch", 1)).toBe(false);
      drawnMs = null;
      send("pointerdown", "mouse");
      send("pointerup", "mouse");
      expect(send("click", "mouse", 1)).toBe(false);
      expect(refuse).toHaveBeenCalledTimes(2);

      drawnMs = -1000;
      state = {};
      view.refresh();
      view.element.click();
      expect(activate).toHaveBeenCalledOnce();
      state = { availability: { kind: "pointer-refusal" } };
      const stale = view.holdAction()!;
      view.dispose();
      stale.activate();
      stale.hold?.();
      view.element.click();
      expect(refuse).toHaveBeenCalledTimes(2);
      expect(activate).toHaveBeenCalledOnce();
    } finally {
      stop();
      stopClicks();
      view.dispose();
    }
  },
);

const OPEN_LABEL = '<span class="ui-control-label">Open</span>';

// Each state as 0.86.1 renders it for a caller that does not pass refusal: the markup, the hold
// action's fields with and without feedback callbacks, and what a key and a pointer click call.
it.each([
  ["available", {}, "", ["activate"]],
  [
    "selected and untoggled",
    { selected: true, toggled: false },
    ' data-ui-selected="" aria-pressed="false"',
    ["activate"],
  ],
  ["disabled", { availability: { kind: "disabled" } }, ' disabled=""', null],
  [
    "pointer refusal",
    { availability: { kind: "pointer-refusal" } },
    ' tabindex="-1" aria-disabled="true"',
    ["pointer"],
  ],
  [
    "unavailable",
    { availability: { kind: "unavailable", reason: "Need a key" } },
    ' aria-disabled="true" aria-description="Need a key"',
    ["unavailable"],
  ],
  ["omitted", { availability: { kind: "omitted" } }, ' hidden=""', null],
] as const)("keeps the %s state unchanged without refusal", (_name, state, attributes, calls) => {
  const classes = "ui-standard-button ui-button-face ui-control-button";
  const markup = `<button type="button" class="${classes}"${attributes}>${OPEN_LABEL}</button>`;
  const fields = ["activate", "available", "element", "hold", "identity", "rule"];
  for (const feedback of [false, true]) {
    const log: string[] = [];
    const reason = document.createElement("p");
    const view = createButton(document, {
      content: { kind: "text", label: "Open" },
      getAction: () => ({ activate: () => log.push("activate") }),
      getState: () => state as ButtonState,
      rule,
      ...(feedback
        ? {
            onPointerRefusal: () => log.push("pointer"),
            onUnavailable: () => log.push("unavailable"),
            reason,
          }
        : {}),
    });
    document.body.append(view.element, reason);
    try {
      view.refresh();
      expect(view.element.outerHTML).toBe(markup);
      const hold = view.holdAction();
      const dispatches = calls !== null && (feedback || calls[0] === "activate") ? calls : null;
      expect(hold === null ? null : Object.keys(hold).sort()).toEqual(
        dispatches === null ? null : feedback ? [...fields, "ownAriaDisabled"].sort() : fields,
      );
      view.element.click();
      view.element.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }),
      );
      const keyed = dispatches?.[0] === "pointer" ? [] : (dispatches ?? []);
      expect(log).toEqual([...keyed, ...(dispatches ?? [])]);
      if (feedback) {
        expect(reason.outerHTML).toBe(
          attributes.includes("Need a key") ? "<p>Need a key</p>" : '<p hidden=""></p>',
        );
      }
    } finally {
      view.dispose();
      reason.remove();
    }
  }
});

// A refused button in a dialog between two others, refusing through refuse.
function refusedFixture(options: {
  readonly getAction?: () => { readonly activate: () => void } | null;
  readonly getState?: () => ButtonState;
  readonly reducedMotion?: () => boolean;
}) {
  const refuse = vi.fn();
  const root = document.createElement("div");
  const dialog = document.createElement("section");
  const before = document.createElement("button");
  const after = document.createElement("button");
  const reason = document.createElement("span");
  const view = createButton(document, {
    content: { kind: "text", label: "Fetch" },
    getAction: options.getAction ?? (() => ({ activate: vi.fn() })),
    getState: options.getState ?? (() => ({ availability: { kind: "refused" } })),
    reason,
    refusal: { reducedMotion: options.reducedMotion ?? (() => false), refuse },
    rule,
  });
  dialog.append(before, view.element, after, reason);
  root.append(dialog);
  document.body.append(root);
  const modal = createModalLayer(root);
  const close = modal.open({ focus: before, isolation: "dialog" }, dialog);
  const key = (type: "keydown" | "keyup", key: string) =>
    document.activeElement!.dispatchEvent(
      new KeyboardEvent(type, { bubbles: true, cancelable: true, key }),
    );
  const dispose = () => {
    close();
    modal.dispose();
    view.dispose();
  };
  return { after, before, dialog, dispose, key, reason, refuse, view };
}

it("keeps a refused button focusable and in the Tab order with no description", () => {
  let state: ButtonState = { availability: { kind: "refused" } };
  const { after, before, dialog, dispose, key, reason, refuse, view } = refusedFixture({
    getState: () => state,
  });
  const { element } = view;
  try {
    expect(focusTargets(dialog)).toEqual([before, element, after]);
    key("keydown", "Tab");
    expect(document.activeElement).toBe(element);
    expect(element.disabled).toBe(false);
    expect(element.hasAttribute("tabindex")).toBe(false);
    expect(element.hasAttribute("aria-describedby")).toBe(false);
    expect(element.hasAttribute("aria-description")).toBe(false);
    expect(reason.hidden).toBe(true);
    expect(reason.textContent).toBe("");
    expect(element.getAttribute("aria-disabled")).toBe("true");
    view.refresh();
    view.refresh();
    expect(element.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(element);

    state = {};
    view.refresh();
    expect(element.hasAttribute("aria-disabled")).toBe(false);
    element.tabIndex = 4;
    state = { availability: { kind: "pointer-refusal" } };
    view.refresh();
    expect(element.tabIndex).toBe(-1);
    state = { availability: { kind: "refused" } };
    view.refresh();
    expect(element.tabIndex).toBe(4);
    expect(element.getAttribute("aria-disabled")).toBe("true");
    expect(refuse).not.toHaveBeenCalled();
  } finally {
    dispose();
  }
});

it.each([
  ["Enter", "Enter"],
  ["Space", " "],
])("refuses %s through the caller's refuse, under the current action", (_name, name) => {
  let reduced = false;
  let inScope = true;
  const activate = vi.fn();
  const { dispose, key, refuse, view } = refusedFixture({
    getAction: () => (inScope ? { activate } : null),
    reducedMotion: () => reduced,
  });
  try {
    view.element.focus();
    key("keydown", name);
    key("keyup", name);
    expect(refuse.mock.calls).toEqual([[false, view.element]]);
    reduced = true;
    key("keydown", name);
    key("keyup", name);
    expect(refuse.mock.calls).toEqual([
      [false, view.element],
      [true, view.element],
    ]);
    inScope = false;
    key("keydown", name);
    expect(refuse).toHaveBeenCalledTimes(2);
    expect(activate).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(view.element);
  } finally {
    dispose();
  }
});

it.each(["native-click", "pointer-release"] as const)(
  "refuses each pointer press and hold once in %s mode",
  (mode) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const guard = { gate: createModalInputGate() };
    const activate = vi.fn();
    const hold = vi.fn();
    const refuse = vi.fn();
    const root = document.createElement("div");
    const view = createButton(document, {
      content: { kind: "text", label: "Fetch" },
      getAction: () => ({ activate, hold }),
      getState: () => ({ availability: { kind: "refused" } }),
      refusal: { reducedMotion: () => false, refuse },
      rule,
    });
    root.append(view.element);
    document.body.append(root);
    const resolve = (target: EventTarget | null) =>
      target instanceof Node && view.element.contains(target) ? view.holdAction() : null;
    const stop = bindHoldActions(
      mode === "pointer-release"
        ? { activation: mode, guard, resolve, resolvePointer: (event) => resolve(event.target) }
        : { guard, resolve },
      root,
    );
    const stopClicks = guardClicks(guard, root);
    const send = (type: string, pointerType: "mouse" | "touch", detail = 0) =>
      view.face.firstElementChild!.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          detail,
          isPrimary: true,
          pointerId: 4,
          pointerType,
        }),
      );
    try {
      expect(view.holdAction()?.ownAriaDisabled).toBe("refusal-feedback");
      send("pointerdown", "mouse");
      send("pointerup", "mouse");
      expect(refuse).toHaveBeenCalledTimes(mode === "pointer-release" ? 1 : 0);
      expect(send("click", "mouse", 1)).toBe(false);
      expect(refuse).toHaveBeenCalledOnce();
      send("pointerdown", "touch");
      vi.advanceTimersByTime(100);
      expect(refuse).toHaveBeenCalledTimes(2);
      send("pointerup", "touch");
      vi.advanceTimersByTime(0);
      expect(send("click", "touch", 1)).toBe(false);
      expect(refuse.mock.calls).toEqual([
        [false, view.element],
        [false, view.element],
      ]);
      expect(activate).not.toHaveBeenCalled();
      expect(hold).not.toHaveBeenCalled();
    } finally {
      stop();
      stopClicks();
      view.dispose();
    }
  },
);

it("plays the kit cue by default and refuses silently without a refusal", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const activate = vi.fn();
  const options = {
    content: { kind: "text", label: "Fetch" },
    getAction: () => ({ activate }),
    getState: (): ButtonState => ({ availability: { kind: "refused" } }),
    rule,
  } as const;
  const cued = createButton(document, {
    ...options,
    refusal: { cue: { shake: 2, stepMs: 50, steps: 4 }, reducedMotion: () => true },
  });
  const silent = createButton(document, options);
  document.body.append(cued.element, silent.element);
  try {
    cued.element.click();
    expect(cued.element.hasAttribute(REFUSAL_ATTRIBUTES.red)).toBe(true);
    vi.advanceTimersByTime(100);
    cued.element.click();
    vi.advanceTimersByTime(100);
    expect(cued.element.hasAttribute(REFUSAL_ATTRIBUTES.red)).toBe(false);

    expect(silent.holdAction()).toBeNull();
    expect(
      silent.element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })),
    ).toBe(false);
    expect(silent.element.getAttribute("aria-disabled")).toBe("true");
    expect(silent.element.hasAttribute(REFUSAL_ATTRIBUTES.red)).toBe(false);
    expect(activate).not.toHaveBeenCalled();
  } finally {
    cued.dispose();
    silent.dispose();
  }
});
