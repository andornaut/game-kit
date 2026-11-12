// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { trackInputModality } from "./focusModality.ts";
import { createModalLayer, type ModalLayer } from "./modalLayer.ts";

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
