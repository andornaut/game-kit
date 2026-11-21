// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { trackInputModality } from "./focusModality.ts";
import { createModalLayer, type ModalLayer, type ModalOptions } from "./modalLayer.ts";

// A UI root with a HUD layer (holding the opener) and a card layer (holding a dialog with three
// buttons, the middle one hidden away and a fourth at tabindex -1).
function page() {
  const root = document.createElement("div");
  const hud = document.createElement("div");
  const opener = document.createElement("button");
  hud.append(opener);
  const cards = document.createElement("div");
  const dialog = document.createElement("section");
  dialog.setAttribute("role", "dialog");
  const [first, hidden, last, skipped] = ["first", "hidden", "last", "skipped"].map((name) => {
    const button = document.createElement("button");
    button.textContent = name;
    return button;
  }) as [HTMLButtonElement, HTMLButtonElement, HTMLButtonElement, HTMLButtonElement];
  hidden.hidden = true;
  skipped.tabIndex = -1;
  dialog.append(first, hidden, last, skipped);
  cards.append(dialog);
  root.append(hud, cards);
  document.body.append(root);
  return { cards, dialog, first, hud, last, opener, root };
}

const key = (key: string, options: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, ...options });
  (document.activeElement ?? document.body).dispatchEvent(event);
  return event;
};

let layer: ModalLayer;
let parts: ReturnType<typeof page>;

beforeEach(() => {
  parts = page();
  layer = createModalLayer(parts.root);
  parts.opener.focus();
});

afterEach(() => {
  layer.dispose();
  trackInputModality(document)();
  parts.root.remove();
  vi.restoreAllMocks();
});

function sharedScene() {
  const parent = document.createElement("button");
  const backdrop = document.createElement("div");
  const outside = document.createElement("button");
  backdrop.append(parts.dialog, outside);
  parts.cards.append(parts.hud, parent, backdrop);
  parts.opener.focus();
  return { backdrop, outside, parent };
}

describe("createModalLayer dialog isolation", () => {
  it("keeps same-scene content in place but refuses outside pointer, mouse and programmatic activation", async () => {
    const { backdrop, outside, parent } = sharedScene();
    const nodes = [parts.hud, parent, outside];
    const styles = nodes.map((node) => node.style.cssText);
    const parents = nodes.map((node) => node.parentElement);
    const blocked = vi.fn();
    const delegated = vi.fn();
    const cleanup = vi.fn();
    const events = ["pointerdown", "pointerup", "mousedown", "mouseup", "click"];
    for (const node of nodes) {
      for (const type of events) {
        node.addEventListener(type, blocked);
      }
      node.addEventListener("pointercancel", cleanup);
      node.addEventListener("lostpointercapture", cleanup);
    }
    parts.cards.addEventListener("click", delegated);
    layer.open({ backdrop, focus: parts.first, isolation: "dialog" }, parts.dialog);
    for (const node of nodes) {
      expect(node.closest("[inert]")).not.toBeNull();
      for (const type of events) {
        const event = type.startsWith("pointer")
          ? new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1 })
          : new MouseEvent(type, { bubbles: true, cancelable: true });
        expect(node.dispatchEvent(event)).toBe(false);
      }
      node.click();
      node.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true }));
      node.dispatchEvent(new PointerEvent("lostpointercapture", { bubbles: true }));
    }
    expect(blocked).not.toHaveBeenCalled();
    expect(delegated).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledTimes(6);
    expect(nodes.map((node) => node.style.cssText)).toEqual(styles);
    expect(nodes.map((node) => node.parentElement)).toEqual(parents);
    expect(nodes.every((node) => node.isConnected && !node.hidden)).toBe(true);
    parts.first.click();
    expect(delegated).toHaveBeenCalledOnce();
    const inserted = document.createElement("button");
    inserted.addEventListener("click", blocked);
    parts.cards.append(inserted);
    expect(inserted.inert).toBe(false);
    inserted.click();
    expect(blocked).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(inserted.inert).toBe(true));
    parts.first.remove();
    await vi.waitFor(() => expect(document.activeElement).toBe(parts.dialog));
  });

  it("admits exactly the caller backdrop, including ancestor, sibling and root backdrops", () => {
    const { backdrop, outside, parent } = sharedScene();
    for (const chosen of [backdrop, parent, parts.root]) {
      const dismiss = vi.fn();
      const onClick = (event: Event) => {
        if (event.target === chosen) {
          dismiss();
        }
      };
      chosen.addEventListener("click", onClick);
      const shut = layer.open({ backdrop: chosen, isolation: "dialog" }, parts.dialog);
      outside.click();
      parts.cards.click();
      parts.first.click();
      expect(dismiss).not.toHaveBeenCalled();
      chosen.click();
      expect(dismiss).toHaveBeenCalledOnce();
      shut();
      chosen.removeEventListener("click", onClick);
    }
  });

  it("contains strict mandatory and dialog-root keys without actions while retaining legacy semantics", () => {
    const bubble = vi.fn();
    const click = vi.fn();
    const types = ["keydown", "keypress", "keyup"] as const;
    for (const type of types) {
      window.addEventListener(type, bubble);
    }
    parts.first.addEventListener("click", click);
    try {
      const shut = layer.open({ isolation: "dialog" }, parts.dialog);
      for (const name of ["Escape", "p", "P", "Enter", " "]) {
        for (const type of types) {
          const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, key: name });
          parts.dialog.dispatchEvent(event);
          expect(event.defaultPrevented).toBe(true);
        }
      }
      expect(layer.back()).toBe(true);
      expect(bubble).not.toHaveBeenCalled();
      expect(click).not.toHaveBeenCalled();
      parts.first.focus();
      key("Enter");
      key("Enter", { repeat: true });
      expect(click).toHaveBeenCalledOnce();
      parts.opener.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }),
      );
      expect(click).toHaveBeenCalledOnce();
      parts.opener.focus();
      expect(document.activeElement).toBe(parts.first);
      const input = document.createElement("input");
      parts.dialog.append(input);
      input.focus();
      expect(key("x").defaultPrevented).toBe(false);
      expect(bubble).toHaveBeenCalledOnce();
      shut();
      for (const options of [{}, { isolation: "layer" as const }]) {
        const close = layer.open(options, parts.dialog);
        expect(key("Escape").defaultPrevented).toBe(false);
        expect(key("Enter").defaultPrevented).toBe(false);
        close();
      }
    } finally {
      for (const type of types) {
        window.removeEventListener(type, bubble);
      }
    }
  });

  it("stops later same-root action listeners even when a modal callback pops the stack", () => {
    const activate = vi.fn();
    const leaked = vi.fn();
    parts.first.addEventListener("click", activate);
    parts.root.addEventListener("keydown", leaked);
    let shut = layer.open({ focus: parts.first, isolation: "dialog" }, parts.dialog);
    key("Enter");
    expect(activate).toHaveBeenCalledOnce();
    expect(leaked).not.toHaveBeenCalled();
    shut();
    const dismiss = vi.fn(() => shut());
    shut = layer.open({ close: dismiss, isolation: "dialog" }, parts.dialog);
    key("Escape");
    expect(dismiss).toHaveBeenCalledOnce();
    expect(leaked).not.toHaveBeenCalled();
    expect(layer.back()).toBe(false);
  });

  it("contains mapped neutral-target keys after disabled focus falls to body without inventing actions", () => {
    const activate = vi.fn();
    const leaked = vi.fn();
    const types = ["keydown", "keypress", "keyup"] as const;
    for (const type of types) {
      window.addEventListener(type, leaked);
    }
    parts.first.addEventListener("click", activate);
    layer.open({ focus: parts.first, isolation: "dialog" }, parts.dialog);
    parts.first.disabled = true;
    parts.first.remove();
    expect(document.activeElement).toBe(document.body);
    try {
      for (const target of [document.body, document.documentElement, document]) {
        for (const name of ["Enter", " ", "Escape", "p"]) {
          for (const type of types) {
            const event = new KeyboardEvent(type, {
              bubbles: true,
              cancelable: true,
              key: name,
              repeat: true,
            });
            target.dispatchEvent(event);
            expect(event.defaultPrevented).toBe(true);
          }
        }
      }
      expect(layer.back()).toBe(true);
      expect(activate).not.toHaveBeenCalled();
      expect(leaked).not.toHaveBeenCalled();
      const other = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "x" });
      document.body.dispatchEvent(other);
      expect(other.defaultPrevented).toBe(false);
      expect(leaked).toHaveBeenCalledOnce();
      const editor = document.createElement("input");
      document.body.append(editor);
      const editorKey = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
      });
      editor.dispatchEvent(editorKey);
      editor.remove();
      expect(editorKey.defaultPrevented).toBe(false);
      expect(leaked).toHaveBeenCalledTimes(2);
    } finally {
      for (const type of types) {
        window.removeEventListener(type, leaked);
      }
    }
  });

  it("recovers strict navigation after backdrop blur without activating or dismissing", () => {
    const backdrop = document.createElement("div");
    parts.root.append(backdrop);
    const activate = vi.fn();
    const dismiss = vi.fn();
    parts.dialog.addEventListener("click", activate);
    for (const root of [parts.root, document.body]) {
      layer.dispose();
      layer = createModalLayer(root);
      layer.open({ backdrop, close: dismiss, isolation: "dialog" }, parts.dialog);
      const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
      expect(backdrop.dispatchEvent(press)).toBe(true);

      for (const [target, name, shiftKey, expected] of [
        [document.body, "Tab", false, parts.first],
        [document.body, "Tab", true, parts.last],
        [document.documentElement, "ArrowDown", false, parts.first],
        [document, "ArrowLeft", false, parts.last],
      ] as const) {
        parts.dialog.focus();
        // Happy DOM does not perform the backdrop press's native focus change.
        parts.dialog.blur();
        expect(document.activeElement).toBe(document.body);
        expect(key("Enter").defaultPrevented).toBe(true);
        expect(key("Escape").defaultPrevented).toBe(true);
        for (const type of ["keypress", "keyup"]) {
          expect(
            target.dispatchEvent(
              new KeyboardEvent(type, { bubbles: true, cancelable: true, key: name }),
            ),
          ).toBe(false);
          expect(document.activeElement).toBe(document.body);
        }
        expect(
          target.dispatchEvent(
            new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: name, shiftKey }),
          ),
        ).toBe(false);
        expect(document.activeElement).toBe(expected);
      }

      const tabOnBody = () =>
        document.body.dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Tab" }),
        );
      expect(tabOnBody()).toBe(false);
      expect(document.activeElement).toBe(parts.last);
      parts.last.blur();
      backdrop.hidden = true;
      expect(tabOnBody()).toBe(false);
      expect(document.activeElement).toBe(document.body);
      backdrop.hidden = false;
      expect(parts.dialog.getAttribute("aria-modal")).toBe("true");
    }
    expect(activate).not.toHaveBeenCalled();
    expect(dismiss).not.toHaveBeenCalled();
  });

  it("snapshots strict options and restores nested inert ownership and exact focus", () => {
    const { backdrop, parent } = sharedScene();
    parent.inert = true;
    const options: {
      backdrop: HTMLElement;
      focus: HTMLElement;
      isolation: "dialog";
      live: HTMLElement[];
    } = {
      backdrop,
      focus: parts.first,
      isolation: "dialog",
      live: [],
    };
    const lower = layer.open(options, parts.dialog);
    options.live.push(parts.hud);
    const inner = document.createElement("section");
    const innerButton = document.createElement("button");
    inner.append(innerButton);
    parts.dialog.append(inner);
    const upper = layer.open({ focus: innerButton, isolation: "dialog" }, inner);
    expect(parts.first.inert).toBe(true);
    expect(document.activeElement).toBe(innerButton);
    upper();
    expect(parts.first.inert).toBe(false);
    expect(document.activeElement).toBe(parts.first);
    expect(parts.hud.inert).toBe(true);
    expect(parent.inert).toBe(true);
    lower();
    expect(parent.inert).toBe(true);
    expect(parts.hud.inert).toBe(false);
    expect(document.activeElement).toBe(parts.opener);
  });

  it("switches strict and legacy tops and closes lower entries without moving the top focus", () => {
    sharedScene();
    const lower = layer.open({ focus: parts.first, isolation: "dialog" }, parts.dialog);
    const otherLayer = document.createElement("div");
    const otherDialog = document.createElement("section");
    const otherButton = document.createElement("button");
    const sibling = document.createElement("button");
    otherDialog.append(otherButton);
    otherLayer.append(otherDialog, sibling);
    parts.root.append(otherLayer);
    const click = vi.fn();
    sibling.addEventListener("click", click);
    const legacy = layer.open({ focus: otherButton }, otherDialog);
    sibling.click();
    expect(click).toHaveBeenCalledOnce();
    legacy();
    expect(document.activeElement).toBe(parts.first);
    expect(parts.hud.inert).toBe(true);
    const strict = layer.open({ focus: otherButton, isolation: "dialog" }, otherDialog);
    expect(sibling.inert).toBe(true);
    lower();
    expect(document.activeElement).toBe(otherButton);
    strict();
    strict();
    expect(parts.cards.inert).toBe(false);
  });

  it("rejects invalid strict opens atomically without changing the active modal", () => {
    const { backdrop, parent } = sharedScene();
    const detached = document.createElement("section");
    const foreign = document.implementation.createHTMLDocument().body;
    const lower = layer.open({ focus: parts.first, isolation: "dialog" }, parts.dialog);
    const candidate = document.createElement("section");
    const inside = document.createElement("button");
    candidate.append(inside);
    parts.dialog.append(candidate);
    for (const [options, dialog] of [
      [{ isolation: "other" }, candidate],
      [{ backdrop }, candidate],
      [{ isolation: "dialog", live: [parent] }, candidate],
      [{ isolation: "dialog" }, parts.root],
      [{ isolation: "dialog" }, detached],
      [{ isolation: "dialog" }, foreign],
      [{ backdrop: inside, isolation: "dialog" }, candidate],
      [{ backdrop: candidate, isolation: "dialog" }, candidate],
      [{ backdrop: document.body, isolation: "dialog" }, candidate],
      [{ focus: parent, isolation: "dialog" }, candidate],
      [{ isolation: "dialog" }, parts.dialog],
      [{ isolation: "dialog" }, parts.cards],
    ] as const) {
      const html = parts.root.outerHTML;
      const active = document.activeElement;
      expect(() => layer.open(options as ModalOptions, dialog)).toThrow(RangeError);
      expect(parts.root.outerHTML).toBe(html);
      expect(document.activeElement).toBe(active);
    }
    lower();
    parts.cards.inert = true;
    const html = parts.root.outerHTML;
    expect(() => layer.open({ isolation: "dialog" }, parts.dialog)).toThrow(RangeError);
    expect(parts.root.outerHTML).toBe(html);
    parts.cards.inert = false;
    layer.dispose();
    expect(() => layer.open({ isolation: "dialog" }, parts.dialog)).toThrow(RangeError);
  });

  it("fails closed for moved backdrops and detachment, and never refreshes closed or disposed entries", async () => {
    const { backdrop, parent } = sharedScene();
    const dismiss = vi.fn();
    backdrop.addEventListener("click", dismiss);
    const close = layer.open({ backdrop, isolation: "dialog" }, parts.dialog);
    parts.cards.append(parts.dialog);
    parts.dialog.append(backdrop);
    backdrop.click();
    expect(dismiss).not.toHaveBeenCalled();
    parts.dialog.remove();
    close();
    expect(parent.inert).toBe(false);
    const stale = document.createElement("button");
    parts.cards.append(stale);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(stale.inert).toBe(false);
    parts.cards.append(parts.dialog);
    const shut = layer.open({ isolation: "dialog" }, parts.dialog);
    const beforeDispose = document.createElement("button");
    parts.cards.append(beforeDispose);
    layer.dispose();
    shut();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    expect([stale.inert, beforeDispose.inert, parent.inert]).toEqual([false, false, false]);
  });

  it("does not focus a stale restore target when its callback reenters the stack", () => {
    const { parent } = sharedScene();
    const replacement = document.createElement("section");
    const button = document.createElement("button");
    replacement.append(button);
    parts.cards.append(replacement);
    const restore = vi.fn(() => {
      layer.open({ focus: button, isolation: "dialog" }, replacement);
      return parent;
    });
    const close = layer.open({ isolation: "dialog", restore }, parts.dialog);
    parts.opener.remove();
    const focus = vi.spyOn(parent, "focus");
    close();
    expect(restore).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(button);
    expect(focus).not.toHaveBeenCalled();
  });

  it("keeps reentrant focus on the new top and does not replay a captured key into it", () => {
    sharedScene();
    const replacement = document.createElement("section");
    const button = document.createElement("button");
    replacement.append(button);
    parts.cards.append(replacement);
    let closeUpper: (() => void) | undefined;
    const openUpper = () => {
      closeUpper = layer.open({ focus: button, isolation: "dialog" }, replacement);
    };
    parts.first.addEventListener("focus", openUpper, { once: true });
    layer.open({ focus: parts.first, isolation: "dialog" }, parts.dialog);
    expect(document.activeElement).toBe(button);
    closeUpper?.();
    expect(document.activeElement).toBe(parts.first);
    const click = vi.fn();
    button.addEventListener("click", click);
    parts.first.addEventListener("keydown", openUpper, { once: true });
    const bubble = vi.fn();
    window.addEventListener("keydown", bubble);
    try {
      key("Enter");
      expect(document.activeElement).toBe(button);
      expect(click).not.toHaveBeenCalled();
      expect(bubble).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", bubble);
    }
  });
});

describe("createModalLayer", () => {
  it("marks the card modal, makes the other layers inert and focuses the card", () => {
    layer.open({}, parts.dialog);
    expect(parts.dialog.getAttribute("aria-modal")).toBe("true");
    expect([parts.hud.inert, parts.cards.inert]).toEqual([true, false]);
    expect(document.activeElement).toBe(parts.dialog);
  });

  it("focuses the default action where one is given", () => {
    layer.open({ focus: parts.last }, parts.dialog);
    expect(document.activeElement).toBe(parts.last);
  });

  it("steps the focus through the card's reachable controls, wrapping round", () => {
    layer.open({}, parts.dialog);
    const focused = ["Tab", "Tab", "Tab", "ArrowUp"].map((name) => {
      key(name);
      return document.activeElement;
    });
    expect(focused).toEqual([parts.first, parts.last, parts.first, parts.last]);
    key("Tab", { shiftKey: true });
    expect(document.activeElement).toBe(parts.first);
  });

  it("clicks the focused control once per press and keeps the key from the page", () => {
    const click = vi.fn();
    parts.first.addEventListener("click", click);
    const onWindow = vi.fn();
    window.addEventListener("keydown", onWindow);
    layer.open({ focus: parts.first }, parts.dialog);
    const press = key("Enter");
    key("Enter", { repeat: true });
    key(" ");
    window.removeEventListener("keydown", onWindow);
    expect([click.mock.calls.length, press.defaultPrevented, onWindow.mock.calls.length]).toEqual([
      2,
      true,
      0,
    ]);
  });

  it("closes a closeable card on Escape, P and back, and not one that cannot close", () => {
    const close = vi.fn();
    const shut = layer.open({ close }, parts.dialog);
    key("Escape");
    key("p");
    expect(layer.back()).toBe(true);
    expect(close).toHaveBeenCalledTimes(3);
    shut();
    layer.open({}, parts.dialog);
    expect([key("Escape").defaultPrevented, layer.back()]).toEqual([false, true]);
  });

  it("reports back with no card open as not taken", () => {
    expect(layer.back()).toBe(false);
  });

  it("restores the layers and the focus on close", () => {
    const close = layer.open({}, parts.dialog);
    close();
    close();
    expect([parts.hud.inert, parts.dialog.hasAttribute("aria-modal")]).toEqual([false, false]);
    expect(document.activeElement).toBe(parts.opener);
  });

  it("focuses the restore target when the opener has gone", () => {
    const fallback = document.createElement("button");
    parts.cards.append(fallback);
    const close = layer.open({ restore: () => fallback }, parts.dialog);
    parts.opener.remove();
    close();
    expect(document.activeElement).toBe(fallback);
  });

  it("returns the focus to the card below when the top card closes", () => {
    const top = document.createElement("div");
    const sheet = document.createElement("section");
    const ok = document.createElement("button");
    sheet.append(ok);
    top.append(sheet);
    parts.root.append(top);
    layer.open({ focus: parts.first }, parts.dialog);
    const close = layer.open({ focus: ok }, sheet);
    expect([parts.cards.inert, parts.hud.inert, top.inert]).toEqual([true, true, false]);
    close();
    expect([parts.cards.inert, parts.hud.inert, top.inert]).toEqual([false, true, true]);
    expect(document.activeElement).toBe(parts.first);
  });

  it("keeps the focus in the top card", () => {
    layer.open({ focus: parts.first }, parts.dialog);
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    expect(document.activeElement).toBe(parts.first);
    outside.remove();
  });

  it("leaves a layer the game made inert inert", () => {
    parts.hud.inert = true;
    layer.open({}, parts.dialog)();
    expect(parts.hud.inert).toBe(true);
  });
});

describe("createModalLayer focus rings", () => {
  const HIDDEN_RING = { focusVisible: false, preventScroll: true };
  const pointerdown = () =>
    parts.opener.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 }));

  it("hides the ring on the card it opens after a press", () => {
    const focus = vi.spyOn(parts.last, "focus");
    pointerdown();
    layer.open({ focus: parts.last }, parts.dialog);
    expect(focus).toHaveBeenCalledExactlyOnceWith(HIDDEN_RING);
  });

  it("shows the ring on the card it opens after a key, as the layer tracks from creation", () => {
    const focus = vi.spyOn(parts.last, "focus");
    key("Shift");
    layer.open({ focus: parts.last }, parts.dialog);
    expect(focus).toHaveBeenCalledExactlyOnceWith();
  });

  it("shows the ring on the controls the keys step to", () => {
    const focus = vi.spyOn(parts.first, "focus");
    pointerdown();
    layer.open({}, parts.dialog);
    key("Tab");
    expect(focus).toHaveBeenCalledExactlyOnceWith();
  });

  it("returns the focus to the opener and the restore target by modality", () => {
    const opener = vi.spyOn(parts.opener, "focus");
    pointerdown();
    layer.open({}, parts.dialog)();
    expect(opener).toHaveBeenLastCalledWith(HIDDEN_RING);
    const fallback = document.createElement("button");
    parts.cards.append(fallback);
    const restore = vi.spyOn(fallback, "focus");
    const close = layer.open({ restore: () => fallback }, parts.dialog);
    parts.opener.remove();
    key("Shift");
    close();
    expect(restore).toHaveBeenCalledExactlyOnceWith();
  });
});

describe("createModalLayer with live elements", () => {
  // The HUD layer also holds a pause button and a skill row of two buttons, which stays live
  // under the card.
  let pause: HTMLButtonElement;
  let row: HTMLDivElement;
  let skills: HTMLButtonElement[];

  beforeEach(() => {
    pause = document.createElement("button");
    row = document.createElement("div");
    skills = [document.createElement("button"), document.createElement("button")];
    row.append(...skills);
    parts.hud.append(pause, row);
  });

  it("makes the siblings along the path to a live element inert, and clears them on close", () => {
    const close = layer.open({ live: [row] }, parts.dialog);
    const marks = () => [parts.hud, row, parts.opener, pause, parts.cards].map((el) => el.inert);
    expect(marks()).toEqual([false, false, true, true, false]);
    close();
    expect(marks()).toEqual([false, false, false, false, false]);
  });

  it("steps the focus from the card's controls through the live ones and clicks there", () => {
    const click = vi.fn();
    skills[1]!.addEventListener("click", click);
    layer.open({ focus: parts.first, live: [row] }, parts.dialog);
    const focused = ["Tab", "Tab", "Tab", "Tab"].map((name) => {
      key(name);
      return document.activeElement;
    });
    expect(focused).toEqual([parts.last, skills[0], skills[1], parts.first]);
    key("ArrowLeft");
    key("Enter");
    expect(click).toHaveBeenCalledOnce();
  });

  it("lets the focus rest on a live element", () => {
    layer.open({ live: [row] }, parts.dialog);
    skills[0]!.focus();
    expect(document.activeElement).toBe(skills[0]);
  });

  it("takes a live element that is itself a control into the focus order", () => {
    layer.open({ focus: parts.last, live: [skills[1]!] }, parts.dialog);
    key("Tab");
    expect([document.activeElement, skills[0]!.inert]).toEqual([skills[1], true]);
  });

  it("makes a live element inert under a card opened over its own", () => {
    const top = document.createElement("div");
    const sheet = document.createElement("section");
    top.append(sheet);
    parts.root.append(top);
    layer.open({ live: [row] }, parts.dialog);
    skills[0]!.focus();
    const close = layer.open({}, sheet);
    const marks = () => [parts.hud, row, pause, parts.cards].map((el) => el.inert);
    expect(marks()).toEqual([true, false, false, true]);
    close();
    expect(marks()).toEqual([false, false, true, false]);
    expect(document.activeElement).toBe(skills[0]);
  });

  it("leaves an element the game made inert inert", () => {
    pause.inert = true;
    layer.open({ live: [row] }, parts.dialog)();
    expect(pause.inert).toBe(true);
  });
});
