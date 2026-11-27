// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import { createModalInputGate } from "../../../input/modalInput.ts";
import { mountLoadingFailure } from "../../progress/dom/loadingFailure.ts";
import { createButton } from "./controls/button.ts";
import { createModalLayer } from "./dialogs/modalLayer.ts";
import { trackInputModality } from "./focusModality.ts";
import { bindForegroundInput } from "./foregroundInput.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    cleanup();
  }
  trackInputModality(document)();
  document.body.replaceChildren();
  vi.useRealTimers();
});

function key(
  value: string,
  init: KeyboardEventInit = {},
  type = "keydown",
  target = document.activeElement ?? document.body,
) {
  const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, key: value, ...init });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

function pointer(type: string, target: Element, init: PointerEventInit = {}, timeStamp?: number) {
  const event = new PointerEvent(type, {
    bubbles: true,
    button: 2,
    cancelable: true,
    clientX: 30,
    clientY: 20,
    isPrimary: true,
    pointerId: 1,
    pointerType: "mouse",
    ...init,
  });
  if (timeStamp !== undefined) {
    Object.defineProperty(event, "timeStamp", { value: timeStamp });
  }
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

function fixture() {
  const gameEscape = vi.fn();
  const input = bindForegroundInput({ gameEscape: () => gameEscape }, document);
  cleanups.push(input.dispose);
  const root = document.createElement("main");
  document.body.append(root);
  return { gameEscape, input, root };
}

function control(root: HTMLElement, activate = vi.fn(), available = () => true) {
  const element = document.createElement("button");
  root.append(element);
  return { activate, available, element };
}

describe("foreground input", () => {
  it("navigates a page and uses one guarded factory action per press before document capture", () => {
    const { input, root } = fixture();
    const act = vi.fn();
    const delegatedClick = vi.fn();
    const world = vi.fn();
    let id = 0;
    let available = true;
    const button = createButton(document, {
      content: { kind: "text", label: "Use" },
      getAction: () => ({ activate: act, identity: id }),
      getState: () => ({ availability: { kind: available ? "available" : "disabled" } }),
      rule: { holdMs: 500, slopPx: 10 },
    });
    const previous = control(root);
    root.append(button.element);
    const resolve = (target: EventTarget) =>
      button.element.contains(target as Node) ? button.foregroundAction() : null;
    input.register({ resolve, root });
    root.addEventListener("click", delegatedClick);
    document.addEventListener("keydown", world, true);
    cleanups.push(() => document.removeEventListener("keydown", world, true));

    previous.element.focus();
    for (const [forward, reverse] of [
      ["d", "a"],
      ["j", "k"],
      ["s", "w"],
      ["l", "h"],
      ["ArrowRight", "ArrowLeft"],
    ]) {
      expect(key(forward!)).toBe(true);
      expect(document.activeElement).toBe(button.element);
      expect(key(reverse!)).toBe(true);
      expect(document.activeElement).toBe(previous.element);
    }
    expect(key("Tab")).toBe(false);
    button.element.focus();
    world.mockClear();
    for (const press of ["e", "f"]) {
      expect(key(press)).toBe(true);
      expect(key(press, { repeat: true })).toBe(true);
      expect(key(press, {}, "keypress")).toBe(true);
      expect(key(press, {}, "keyup")).toBe(true);
    }
    for (const press of ["Enter", " "]) {
      expect(key(press)).toBe(false);
      expect(key(press, { repeat: true })).toBe(true);
      expect(key(press, {}, "keypress")).toBe(false);
      expect(key(press, {}, "keyup")).toBe(false);
    }
    expect(act).toHaveBeenCalledTimes(2);
    expect(world).not.toHaveBeenCalled();
    expect(delegatedClick).not.toHaveBeenCalled();

    const stale = button.foregroundAction()!;
    id += 1;
    expect(stale.available()).toBe(false);
    stale.activate();
    available = false;
    expect(key("e")).toBe(true);
    expect(act).toHaveBeenCalledTimes(2);
    expect(pointer("pointerdown", button.element)).toBe(false);
    button.dispose();
  });

  it("routes neutral Escape through top Skip, blocking choice, caller X and game entry", () => {
    const { gameEscape, input, root } = fixture();
    const page = document.createElement("section");
    const stack = document.createElement("div");
    const dialog = document.createElement("article");
    const choice = document.createElement("article");
    root.append(page, stack);
    stack.append(dialog, choice);
    const stageX = control(
      page,
      vi.fn(() => stopPage()),
    );
    const stopPage = input.register({ dismiss: () => stageX, root: page });
    stageX.element.focus();
    const layer = createModalLayer(root, input);
    cleanups.push(layer.dispose);
    const x = control(
      dialog,
      vi.fn(() => closeDialog()),
    );
    const skip = control(
      dialog,
      vi.fn(() => closeDialog()),
    );
    const closeDialog = layer.open(
      {
        focus: skip.element,
        foreground: { dismiss: () => x, skip: () => skip },
        isolation: "dialog",
      },
      dialog,
    );
    const closeChoice = layer.open({ isolation: "dialog" }, choice);
    const escape = (init?: KeyboardEventInit, type?: string) =>
      key("Escape", { code: "Escape", ...init }, type);
    const world = vi.fn();
    document.addEventListener("keydown", world, true);
    cleanups.push(() => document.removeEventListener("keydown", world, true));

    expect(escape()).toBe(true);
    expect(skip.activate).not.toHaveBeenCalled();
    expect(x.activate).not.toHaveBeenCalled();
    expect(gameEscape).not.toHaveBeenCalled();
    expect(escape({}, "keyup")).toBe(true);
    closeChoice();
    skip.element.blur();
    expect(document.activeElement).toBe(document.body);
    expect(escape()).toBe(true);
    expect(skip.activate).toHaveBeenCalledOnce();
    expect(x.activate).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(stageX.element);
    expect(escape({ repeat: true })).toBe(true);
    expect(escape({}, "keyup")).toBe(true);
    expect(stageX.activate).not.toHaveBeenCalled();
    expect(escape()).toBe(true);
    expect(stageX.activate).toHaveBeenCalledOnce();
    expect(escape({ repeat: true })).toBe(true);
    expect(escape({}, "keyup")).toBe(true);
    expect(gameEscape).not.toHaveBeenCalled();
    expect(escape()).toBe(true);
    expect(gameEscape).toHaveBeenCalledOnce();
    expect(world).not.toHaveBeenCalled();
  });

  it("falls back from an unavailable Skip and rechecks a captured modal guard before dispatch", () => {
    const { input, root } = fixture();
    const modal = createModalInputGate();
    const gate = modal.open();
    let drawn: number | null = null;
    const skip = control(root);
    const dismiss = control(root);
    skip.element.hidden = true;
    const stop = input.register({
      dismiss: () => dismiss,
      guard: { gate, tapGuard: { drawnMs: () => drawn, guardMs: 0 } },
      root,
      skip: () => skip,
    });
    expect(key("Escape")).toBe(true);
    expect(dismiss.activate).not.toHaveBeenCalled();
    drawn = 0;
    expect(key("Escape", { repeat: true })).toBe(true);
    expect(dismiss.activate).not.toHaveBeenCalled();
    key("Escape", {}, "keyup");
    expect(key("Escape")).toBe(true);
    expect(dismiss.activate).toHaveBeenCalledOnce();
    key("Escape", {}, "keyup");
    stop();

    const action = control(root, vi.fn(), () => {
      modal.open().close();
      return true;
    });
    input.register({ guard: { gate }, resolve: () => action, root });
    action.element.focus();
    expect(key("Enter")).toBe(true);
    expect(action.activate).not.toHaveBeenCalled();
  });

  it("keeps editor, composition, modifiers, slider defaults and a modal's Tab path", () => {
    const { input, root } = fixture();
    const dialog = document.createElement("article");
    root.append(dialog);
    const first = control(dialog);
    const editor = document.createElement("input");
    const slider = document.createElement("div");
    slider.tabIndex = 0;
    slider.setAttribute("role", "slider");
    slider.addEventListener("keydown", (event) => {
      if (event.key === "ArrowRight") {
        event.preventDefault();
      }
    });
    dialog.append(editor, slider);
    const layer = createModalLayer(root, input);
    cleanups.push(layer.dispose);
    const close = vi.fn();
    layer.open({ close, focus: first.element, isolation: "dialog" }, dialog);

    expect(key("Tab")).toBe(true);
    expect(document.activeElement).toBe(editor);
    expect(key("Escape")).toBe(false);
    expect(key("e")).toBe(false);
    expect(close).not.toHaveBeenCalled();
    expect(key("Tab")).toBe(true);
    expect(document.activeElement).toBe(slider);
    expect(key("ArrowRight")).toBe(true);
    expect(document.activeElement).toBe(slider);
    expect(key("w", { isComposing: true })).toBe(false);
    expect(key("w", { ctrlKey: true })).toBe(false);
    expect(key("Tab", { shiftKey: true })).toBe(true);
    expect(document.activeElement).toBe(editor);
  });

  it("owns only eligible secondary gestures, including release on a removed action", () => {
    const { input, root } = fixture();
    const bottom = control(root);
    const panel = document.createElement("section");
    root.append(panel);
    const action = control(
      panel,
      vi.fn(() => {
        stop();
        panel.remove();
      }),
    );
    const icon = document.createElement("span");
    action.element.append(icon);
    const disabled = control(panel);
    disabled.element.disabled = true;
    const stop = input.register({
      layer: "modal",
      resolve: (target) =>
        [action, disabled].find(({ element }) => element.contains(target as Node)),
      root: panel,
    });
    input.register({ resolve: () => bottom, root });

    expect(pointer("pointerdown", bottom.element)).toBe(false);
    expect(pointer("contextmenu", bottom.element)).toBe(false);
    expect(pointer("pointerdown", disabled.element)).toBe(false);
    expect(pointer("contextmenu", disabled.element)).toBe(false);
    expect(pointer("pointerdown", icon, { button: 0 })).toBe(false);
    expect(pointer("pointerdown", icon, { pointerType: "touch" })).toBe(false);
    expect(pointer("pointerdown", icon, { isPrimary: false })).toBe(false);
    expect(pointer("pointerdown", icon, { shiftKey: true })).toBe(false);
    expect(pointer("contextmenu", icon, { shiftKey: true })).toBe(false);
    expect(pointer("pointerdown", icon)).toBe(false);
    expect(pointer("contextmenu", icon)).toBe(true);
    expect(action.activate).not.toHaveBeenCalled();
    expect(pointer("pointerup", icon, {}, 100)).toBe(true);
    expect(action.activate).toHaveBeenCalledOnce();
    expect(pointer("auxclick", bottom.element, { pointerId: 2 }, 100)).toBe(false);
    expect(pointer("auxclick", bottom.element, {}, 100)).toBe(true);
    expect(pointer("contextmenu", bottom.element, {}, 100)).toBe(false);
    expect(bottom.activate).not.toHaveBeenCalled();
    expect(disabled.activate).not.toHaveBeenCalled();
  });

  it("cancels secondary release after cancel, drag, guard revision or same-element replacement", () => {
    const { input, root } = fixture();
    const first = control(root);
    const second = { ...first, activate: vi.fn() };
    const modal = createModalInputGate();
    const gate = modal.open();
    let current = first;
    input.register({ guard: { gate }, resolve: () => current, root });
    const { element } = first;
    const breakGesture = [
      () => pointer("pointercancel", element),
      () => pointer("pointermove", element, { buttons: 2, clientX: 45 }),
      () => pointer("pointermove", element, { buttons: 3 }),
      () => {
        current = second;
      },
      () => modal.open().close(),
      () => {
        const overlay = document.createElement("section");
        root.append(overlay);
        input.register({ layer: "modal", root: overlay })();
      },
    ];
    for (const interrupt of breakGesture) {
      current = first;
      pointer("pointerdown", element);
      interrupt();
      expect(pointer("pointerup", element, {}, 200)).toBe(false);
      expect(pointer("contextmenu", element, {}, 200)).toBe(false);
    }
    expect(first.activate).not.toHaveBeenCalled();
    expect(second.activate).not.toHaveBeenCalled();
  });

  it("matches a late MouseEvent menu by release time and target, and expires missing native events", () => {
    vi.useFakeTimers();
    const { input, root } = fixture();
    const action = control(root);
    const other = control(root);
    input.register({ resolve: () => action, root });
    const menu = (target: Element, timeStamp: number) => {
      const event = new MouseEvent("contextmenu", {
        bubbles: true,
        button: 2,
        cancelable: true,
        clientX: 30,
        clientY: 20,
      });
      Object.defineProperty(event, "timeStamp", { value: timeStamp });
      return !target.dispatchEvent(event);
    };
    pointer("pointerdown", action.element);
    expect(pointer("pointerup", action.element, {}, 300)).toBe(true);
    expect(menu(other.element, 300)).toBe(false);
    expect(menu(action.element, 301)).toBe(false);
    expect(menu(action.element, 300)).toBe(true);
    expect(menu(action.element, 300)).toBe(false);

    pointer("pointerdown", action.element);
    expect(pointer("pointerup", action.element, {}, 400)).toBe(true);
    vi.runOnlyPendingTimers();
    expect(menu(action.element, 400)).toBe(false);
    expect(pointer("auxclick", action.element, {}, 400)).toBe(false);
    expect(action.activate).toHaveBeenCalledTimes(2);
  });

  it("cancels a native Space release when the resolver replaces the action on the same button", () => {
    const { input, root } = fixture();
    const first = { ...control(root), native: true as const };
    const second = { ...first, activate: vi.fn() };
    let current = first;
    input.register({ resolve: () => current, root });
    first.element.focus();
    expect(key(" ")).toBe(false);
    current = second;
    expect(key(" ", {}, "keyup")).toBe(true);
    expect(key(" ")).toBe(false);
    expect(key(" ", {}, "keyup")).toBe(false);
  });

  it("lets only Escape pass through a ready transparent surface", () => {
    const { gameEscape, input, root } = fixture();
    const dismiss = control(root);
    const stopLower = input.register({ dismiss: () => dismiss, root });
    const upper = document.createElement("div");
    root.append(upper);
    let ready = true;
    input.register({ escape: "pass-through", ready: () => ready, root: upper });
    dismiss.element.focus();
    expect(key("e")).toBe(true);
    expect(dismiss.activate).not.toHaveBeenCalled();
    expect(key("Escape")).toBe(true);
    expect(dismiss.activate).toHaveBeenCalledOnce();
    stopLower();
    ready = false;
    expect(key("Escape")).toBe(true);
    expect(gameEscape).not.toHaveBeenCalled();
    ready = true;
    expect(key("Escape")).toBe(true);
    expect(gameEscape).toHaveBeenCalledOnce();
    expect(key("Escape", { repeat: true })).toBe(true);
    expect(key("Escape", {}, "keyup")).toBe(true);
    expect(gameEscape).toHaveBeenCalledOnce();
  });

  it("keeps a Retry press owned across busy disable, a new attempt, disposal and focus return", async () => {
    const { input, root } = fixture();
    const opener = control(root);
    input.register({ resolve: () => opener, root });
    let finish!: () => void;
    const onRetry = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const view = mountLoadingFailure({ foregroundInput: input, onRetry }, root);
    const failed = { attempt: 1, error: undefined, kind: "failed" } as const;
    view.update(failed);
    const retry = view.element.querySelector("button")!;
    retry.focus();
    expect(key("e")).toBe(true);
    expect(onRetry).toHaveBeenCalledOnce();
    expect(retry.disabled).toBe(true);
    expect(pointer("pointerdown", retry)).toBe(false);
    view.update({ ...failed, attempt: 2 });
    expect(retry.disabled).toBe(true);
    finish();
    await Promise.resolve();
    expect(retry.disabled).toBe(false);
    view.dispose();
    opener.element.focus();
    expect(key("e", { repeat: true })).toBe(true);
    expect(key("e", {}, "keyup")).toBe(true);
    expect(opener.activate).not.toHaveBeenCalled();
    expect(key("e")).toBe(true);
    expect(opener.activate).toHaveBeenCalledOnce();
  });
});
