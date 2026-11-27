// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createModalInputGate } from "../../../../input/modalInput.ts";
import { trackInputModality } from "../focusModality.ts";
import {
  createModalFrame,
  MODAL_BODY_CLASS,
  MODAL_CLOSE_CLASS,
  MODAL_FOOTER_CLASS,
  MODAL_HEADER_CLASS,
  MODAL_SKIN_CLASS,
  type ModalFrameView,
} from "./modalFrame.ts";
import { createModalLayer } from "./modalLayer.ts";

const PLAIN = {
  content: { height: 540, width: 960, x: 0, y: 0 },
  families: { large: 688, medium: 500, small: 400 },
  family: "medium",
} as const;
const CONTEXT = { ...PLAIN, close: { face: { height: 24, width: 24, x: 6, y: 6 } } } as const;

const value = (element: HTMLElement, name: string) => element.style.getPropertyValue(name);

function height(element: HTMLElement, px: number): void {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({ height: px } as DOMRect);
}

// A UI root with a HUD layer holding the opener and a card layer holding the frame, its close
// control and its footer actions.
function page() {
  const root = document.createElement("div");
  const hud = document.createElement("div");
  const opener = document.createElement("button");
  hud.append(opener);
  const cards = document.createElement("div");
  root.append(hud, cards);
  document.body.append(root);
  const frame = createModalFrame(document, {
    cardClassName: "game-card",
    description: "Leave the walk?",
    id: "leave",
    skinClassName: "ui-frame",
    title: "Leave",
  });
  const close = document.createElement("button");
  close.setAttribute("aria-label", "Close");
  const stay = document.createElement("button");
  const leave = document.createElement("button");
  frame.footer.element.append(stay, leave);
  cards.append(frame.element);
  return { cards, close, frame, hud, leave, opener, root, stay };
}

function layOut(frame: ModalFrameView, parts: ReturnType<typeof page>) {
  height(frame.title, 28);
  height(frame.content, 100);
  return frame.layout(CONTEXT, {
    close: parts.close,
    footer: {
      actions: [
        { element: parts.stay, role: "secondary", size: { height: 48, width: 80 } },
        { element: parts.leave, role: "primary", size: { height: 48, width: 90 } },
      ],
    },
  });
}

afterEach(() => {
  document.body.replaceChildren();
  trackInputModality(document)();
  vi.restoreAllMocks();
});

describe("createModalFrame", () => {
  it("builds a named dialog with its skin under its parts", () => {
    const { frame } = page();
    expect(frame.card.getAttribute("role")).toBe("dialog");
    expect(frame.card.id).toBe("leave");
    expect(frame.card.getAttribute("aria-labelledby")).toBe("leave-title");
    expect(frame.title.id).toBe("leave-title");
    expect(frame.title.textContent).toBe("Leave");
    expect(frame.card.getAttribute("aria-describedby")).toBe("leave-text");
    expect(document.getElementById("leave-text")?.textContent).toBe("Leave the walk?");
    expect(frame.card.classList.contains("game-card")).toBe(true);
    expect(frame.skin.className).toBe(`${MODAL_SKIN_CLASS} ui-frame`);
    expect(frame.skin.getAttribute("aria-hidden")).toBe("true");
    expect([...frame.card.children].map((child) => child.classList[0])).toEqual([
      MODAL_SKIN_CLASS,
      MODAL_HEADER_CLASS,
      MODAL_BODY_CLASS,
      MODAL_FOOTER_CLASS,
    ]);
    expect([...frame.element.children]).toEqual([frame.backdrop, frame.card]);
    frame.setTitle("Leave now");
    expect(frame.title.textContent).toBe("Leave now");
    expect(() => createModalFrame(document, { id: "1 bad", title: "x" })).toThrow(RangeError);
    expect(
      createModalFrame(document, {
        id: "ask",
        role: "alertdialog",
        title: "Ask",
      }).card.getAttribute("role"),
    ).toBe("alertdialog");
  });

  it("places every part from the measured title, content and footer", () => {
    const parts = page();
    const { close, frame, leave, stay } = parts;
    const { footer, frame: layout } = layOut(frame, parts);
    expect(layout.card).toEqual({ height: 232, width: 500, x: 230, y: 154 });
    expect(value(frame.card, "--ui-modal-card-x")).toBe("230");
    expect(value(frame.card, "--ui-modal-card-height")).toBe("232");
    expect(value(frame.card, "--ui-modal-title-x")).toBe("50");
    expect(value(frame.card, "--ui-modal-title-y")).toBe("16");
    expect(value(frame.card, "--ui-modal-title-width")).toBe("400");
    expect(value(frame.card, "--ui-modal-body-y")).toBe("60");
    expect(value(frame.card, "--ui-modal-body-height")).toBe("100");
    expect(value(frame.card, "--ui-modal-inset-bottom")).toBe("0");
    expect(value(frame.card, "--ui-modal-footer-x")).toBe("16");
    expect(value(frame.card, "--ui-modal-footer-y")).toBe("168");
    expect(frame.card.hasAttribute("data-ui-modal-footer")).toBe(true);
    expect(footer?.variant).toBe("footer");
    expect(value(stay, "--ui-action-x")).toBe("0");
    expect(value(leave, "--ui-action-x")).toBe(String(468 - 90));
    // The close control is the card's last child, its box the face and its press area outset.
    expect(frame.card.lastElementChild).toBe(close);
    expect(close.classList.contains(MODAL_CLOSE_CLASS)).toBe(true);
    expect(value(close, "--ui-modal-close-x")).toBe("470");
    expect(value(close, "--ui-modal-close-y")).toBe("6");
    expect(value(close, "--ui-modal-close-outset-right")).toBe("12");
  });

  it("measures the content without the bottom inset it holds when there is no footer", () => {
    const { frame } = page();
    height(frame.title, 20);
    height(frame.content, 46);
    const { frame: layout } = frame.layout(PLAIN);
    expect(value(frame.card, "--ui-modal-inset-bottom")).toBe("16");
    expect(layout.body.height).toBe(46);
    expect(frame.card.hasAttribute("data-ui-modal-footer")).toBe(false);
  });

  it("refuses a close control without geometry, and geometry without one, before any change", () => {
    const parts = page();
    expect(() => parts.frame.layout(CONTEXT)).toThrow(RangeError);
    expect(() => parts.frame.layout(PLAIN, { close: parts.close })).toThrow(RangeError);
    expect(() =>
      parts.frame.layout(
        { ...CONTEXT, content: { height: 100, width: 960, x: 0, y: 0 } },
        { close: parts.close, title: { inset: 40 } },
      ),
    ).toThrow(RangeError);
    expect(parts.frame.card.getAttribute("style")).toBeNull();
    expect(parts.close.parentElement).toBeNull();
  });

  it("releases a replaced close control", () => {
    const parts = page();
    layOut(parts.frame, parts);
    const other = document.createElement("button");
    parts.frame.layout(CONTEXT, { close: other });
    expect(parts.close.parentElement).toBeNull();
    expect(parts.close.classList.contains(MODAL_CLOSE_CLASS)).toBe(false);
    expect(value(parts.close, "--ui-modal-close-x")).toBe("");
    expect(parts.frame.card.lastElementChild).toBe(other);
  });

  it("opens on the modal layer in dialog isolation and returns the focus to the opener", () => {
    const parts = page();
    const { frame, hud, opener, root, stay } = parts;
    layOut(frame, parts);
    const layer = createModalLayer(root);
    const gate = createModalInputGate();
    opener.focus();
    const dismiss = vi.fn();
    const session = frame.open({ close: dismiss, focus: stay, input: gate, layer });
    expect(frame.card.getAttribute("aria-modal")).toBe("true");
    expect(hud.hasAttribute("inert")).toBe(true);
    expect(frame.backdrop.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(stay);
    expect(session.scope?.accepts()).toBe(true);
    expect(gate.accepts()).toBe(false);
    expect(() => frame.open({ layer })).toThrow(Error);
    document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    stay.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    expect(dismiss).toHaveBeenCalledTimes(1);
    session.close();
    session.close();
    expect(frame.card.hasAttribute("aria-modal")).toBe(false);
    expect(hud.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(opener);
    expect(gate.accepts()).toBe(true);
    layer.dispose();
  });

  it("dismisses on a backdrop tap only with a close and an input gate", () => {
    const parts = page();
    layOut(parts.frame, parts);
    const layer = createModalLayer(parts.root);
    expect(() => parts.frame.open({ layer, outsideTap: { tapMaxDistance: 8 } })).toThrow(
      RangeError,
    );
    expect(parts.frame.card.hasAttribute("aria-modal")).toBe(false);
    const dismiss = vi.fn();
    const session = parts.frame.open({
      close: dismiss,
      input: createModalInputGate(),
      layer,
      outsideTap: { tapMaxDistance: 8 },
    });
    const press = (type: string) =>
      parts.frame.backdrop.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          clientX: 1,
          clientY: 1,
          isPrimary: true,
          pointerId: 1,
        }),
      );
    press("pointerdown");
    press("pointerup");
    expect(dismiss).toHaveBeenCalledTimes(1);
    session.close();
    press("pointerdown");
    press("pointerup");
    expect(dismiss).toHaveBeenCalledTimes(1);
    layer.dispose();
  });

  it("closes its session and releases its marks on dispose", () => {
    const parts = page();
    layOut(parts.frame, parts);
    const layer = createModalLayer(parts.root);
    parts.frame.open({ layer });
    parts.frame.dispose();
    parts.frame.dispose();
    expect(parts.frame.card.hasAttribute("aria-modal")).toBe(false);
    expect(parts.close.classList.contains(MODAL_CLOSE_CLASS)).toBe(false);
    expect(parts.stay.classList.contains("ui-action")).toBe(false);
    expect(() => parts.frame.layout(CONTEXT, { close: parts.close })).toThrow(Error);
    layer.dispose();
  });
});

describe("createModalFrame for pages, projection and Chibi's cards", () => {
  it("names a frame without a title by its label", () => {
    const frame = createModalFrame(document, { id: "pick", label: "Pick a stage" });
    document.body.append(frame.element);
    expect(frame.card.getAttribute("aria-label")).toBe("Pick a stage");
    expect(frame.card.hasAttribute("aria-labelledby")).toBe(false);
    expect(frame.title.hidden).toBe(true);
    expect(frame.title.id).toBe("");
    expect(() => frame.setTitle("Pick")).toThrow(Error);
    height(frame.content, 40);
    const { frame: layout } = frame.layout(PLAIN);
    // The header is the padding; the content's measured height holds the bottom inset.
    expect(layout.header.height).toBe(16);
    expect(layout.body.height).toBe(40);
    expect(() => frame.layout(PLAIN, { title: { inset: 4 } })).toThrow(RangeError);
    expect(() => createModalFrame(document, { id: "a" })).toThrow(RangeError);
    expect(() => createModalFrame(document, { id: "a", label: "A", title: "A" })).toThrow(
      RangeError,
    );
    expect(() => createModalFrame(document, { id: "a", label: " " })).toThrow(RangeError);
  });

  it("shows the footer while its group measures, before the first layout", () => {
    const { frame, stay } = page();
    stay.style.cssText = "box-sizing: border-box; width: 80px; height: 48px";
    let measuring: boolean | undefined;
    vi.spyOn(stay, "getBoundingClientRect").mockImplementation(() => {
      measuring = frame.card.hasAttribute("data-ui-modal-measuring");
      return { height: 48, width: 80 } as DOMRect;
    });
    expect(frame.footer.measure([stay])).toEqual([{ height: 48, width: 80 }]);
    expect(measuring).toBe(true);
    expect(frame.card.hasAttribute("data-ui-modal-measuring")).toBe(false);
    expect(frame.footerSlot.firstElementChild).toBe(frame.footer.element);
  });

  it("places a backdrop past the content rect, and leaves a card's parts as they were", () => {
    const parts = page();
    const { close, frame } = parts;
    layOut(frame, parts);
    // A card without the new options carries none of their marks.
    expect(frame.backdrop.getAttribute("style")).toBeNull();
    expect(frame.element.hasAttribute("data-ui-modal-projected")).toBe(false);
    expect(frame.card.hasAttribute("data-ui-modal-scroll")).toBe(false);
    expect(frame.card.getAttribute("style")).not.toMatch(/inset-(left|right)|title-height/);
    expect(value(frame.card, "--ui-modal-inset-side")).toBe("16");
    frame.layout({ ...CONTEXT, backdrop: { height: 600, width: 1100, x: -70, y: -30 } }, { close });
    expect(frame.backdrop.hasAttribute("data-ui-modal-placed")).toBe(true);
    expect(value(frame.backdrop, "--ui-modal-backdrop-x")).toBe("-70");
    expect(value(frame.backdrop, "--ui-modal-backdrop-height")).toBe("600");
    frame.layout(CONTEXT, { close });
    expect(frame.backdrop.hasAttribute("data-ui-modal-placed")).toBe(false);
    expect(value(frame.backdrop, "--ui-modal-backdrop-x")).toBe("");
  });

  it("opens a page without the modal layer, leaving covered chrome live", () => {
    const parts = page();
    const { close, frame, hud, opener, root, stay } = parts;
    const bar = document.createElement("button");
    hud.append(bar);
    height(frame.title, 28);
    height(frame.content, 100);
    const footer = {
      actions: [{ element: stay, role: "primary", size: { height: 48, width: 80 } }],
    } as const;
    frame.layout(
      { content: { height: 500, width: 960, x: 0, y: 40 }, variant: "page" },
      {
        footer,
        scroll: "game",
      },
    );
    expect(frame.backdrop.hidden).toBe(true);
    expect(frame.card.getAttribute("data-ui-modal-variant")).toBe("page");
    expect(frame.card.getAttribute("data-ui-modal-scroll")).toBe("game");
    const layer = createModalLayer(root);
    expect(() => frame.open({ layer })).toThrow(RangeError);
    expect(() => frame.open({ close: vi.fn() })).toThrow(RangeError);
    opener.focus();
    const gate = createModalInputGate();
    const session = frame.open({ focus: stay, input: gate });
    expect(frame.card.hasAttribute("aria-modal")).toBe(false);
    expect(hud.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(stay);
    expect(gate.accepts()).toBe(false);
    expect(() => frame.layout(CONTEXT, { close })).toThrow(RangeError);
    session.close();
    session.close();
    expect(document.activeElement).toBe(opener);
    expect(gate.accepts()).toBe(true);
    // Live chrome the player moved the focus to keeps it.
    const again = frame.open({ focus: stay });
    bar.focus();
    again.close();
    expect(document.activeElement).toBe(bar);
    // Laid out as a card, it has its backdrop again and opens on the layer.
    frame.layout(CONTEXT, { close });
    expect(frame.backdrop.hidden).toBe(false);
    expect(() => frame.open({})).toThrow(RangeError);
    frame.open({ layer }).close();
    layer.dispose();
  });

  it("places a projected page on the game's grid with the game's title and footer", () => {
    const frame = createModalFrame(document, { id: "shop", title: "Pet shop" });
    document.body.append(frame.element);
    const project = { x: (edge: number) => 3 * edge, y: (edge: number) => 3 * edge + 1 };
    const pageContext = {
      content: { height: 520, width: 360, x: 0, y: 40 },
      insets: { bottom: 12, side: 8 },
      variant: "page",
    } as const;
    const sizes = { body: 600, footer: { height: 48 }, title: { height: 15, inset: 24 } };
    const { frame: layout, units } = frame.layout(
      { ...pageContext, project },
      { ...sizes, scroll: "game" },
    );
    // units are the game's own rects, for placing its title ink and Back.
    expect(units.title).toEqual({ height: 15, width: 328, x: 16, y: 64 });
    expect(units.footer).toEqual({ height: 48, width: 344, x: 8, y: 500 });
    expect(layout.card).toEqual({ height: 1560, width: 1080, x: 0, y: 121 });
    expect(frame.element.hasAttribute("data-ui-modal-projected")).toBe(true);
    expect(value(frame.card, "--ui-modal-card-y")).toBe("121");
    expect(value(frame.card, "--ui-modal-title-x")).toBe("48");
    expect(value(frame.card, "--ui-modal-title-y")).toBe("72");
    expect(value(frame.card, "--ui-modal-title-height")).toBe("45");
    expect(value(frame.card, "--ui-modal-footer-y")).toBe(String(1501 - 121));
    expect(value(frame.card, "--ui-modal-inset-left")).toBe("24");
    expect(value(frame.card, "--ui-modal-inset-right")).toBe("24");
    expect(value(frame.card, "--ui-modal-inset-bottom")).toBe("0");
    expect(value(frame.card, "--ui-modal-inset-side")).toBe("");
    expect(frame.card.hasAttribute("data-ui-modal-footer")).toBe(true);
    const projected = { ...pageContext, project };
    expect(() => frame.layout(projected, { ...sizes, title: { inset: 24 } })).toThrow(RangeError);
    expect(() => frame.layout(projected, { title: sizes.title })).toThrow(RangeError);
    // The kit footer takes the frame's projection.
    expect(frame.layout(projected, { ...sizes, footer: { actions: [] } }).footer).toBeDefined();
    expect(frame.footer.element.hasAttribute("data-ui-action-projected")).toBe(true);
    // Unprojected, the measured title takes no height and the sides share one inset.
    height(frame.title, 15);
    height(frame.content, 0);
    frame.layout(pageContext, { footer: sizes.footer, title: { inset: 24 } });
    expect(frame.element.hasAttribute("data-ui-modal-projected")).toBe(false);
    expect(value(frame.card, "--ui-modal-inset-left")).toBe("");
    expect(value(frame.card, "--ui-modal-inset-side")).toBe("8");
    expect(value(frame.card, "--ui-modal-title-height")).toBe("");
  });
});

describe("modalFrame.css", () => {
  const css = readFileSync(join(import.meta.dirname, "modalFrame.css"), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );

  it.each([
    "--ui-modal-card-x",
    "--ui-modal-card-height",
    "--ui-modal-header-height",
    "--ui-modal-title-y",
    "--ui-modal-body-height",
    "--ui-modal-footer-y",
    "--ui-modal-close-x",
    "--ui-modal-close-outset-left",
    "--ui-modal-inset-bottom",
    "--ui-modal-backdrop-x",
    "--ui-modal-title-height",
  ])("reads %s at the frame's length", (name) => {
    expect(css).toContain(`var(${name}) * var(--ui-modal-length)`);
  });

  it("measures lengths at --ui-unit, or in CSS px on a projected frame", () => {
    expect(css).toMatch(
      /:where\(\.ui-modal-frame\) \{[^}]*--ui-modal-length: calc\(var\(--ui-unit, 1\) \* 1px\);/,
    );
    expect(css).toMatch(
      /:where\(\.ui-modal-frame\[data-ui-modal-projected\]\) \{\s*--ui-modal-length: 1px;\s*\}/,
    );
    expect(css).toContain("var(--ui-modal-inset-left, var(--ui-modal-inset-side))");
    expect(css).toContain(
      ":where(.ui-modal-card:not([data-ui-modal-footer], [data-ui-modal-measuring]) > .ui-modal-footer)",
    );
    expect(css).toMatch(
      /\[data-ui-modal-scroll="game"\] > \.ui-modal-body\) \{[^}]*overflow: visible;[^}]*touch-action: none;/,
    );
  });

  it("matches with zero specificity and holds no fixed lengths, colours or rings", () => {
    for (const selector of css.match(/^[^\s@}][^{]*\{/gm) ?? []) {
      expect(selector).toMatch(/^:where\(/);
    }
    expect(css.replace(/\* -?1px\)/g, "").replace("--ui-modal-length: 1px;", "")).not.toMatch(
      /\d(px|rem|em)\b/,
    );
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|\b(box-shadow|border(-color)?)\s*:/i);
    expect(css).toMatch(/\.ui-modal-close\)::before\s*\{[^}]*content: "";[^}]*position: absolute;/);
    expect(css).not.toMatch(/\.ui-modal-card\)\s*\{[^}]*overflow/);
  });
});
