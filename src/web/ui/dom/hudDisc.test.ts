// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createActionGroup } from "./actionGroup.ts";
import {
  createHudDisc,
  HUD_DISC_ART_CLASS,
  HUD_DISC_CLASS,
  HUD_DISC_FACE_CLASS,
  HUD_DISC_ICON_CLASS,
} from "./hudDisc.ts";

const rule = { holdMs: 500, slopPx: 5 };
const sizes = { large: { face: 33, icon: 20 }, small: { face: 24, icon: 16 } };
const value = (element: HTMLElement, name: string) => element.style.getPropertyValue(name);

const css = readFileSync(join(import.meta.dirname, "hudDisc.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

afterEach(() => {
  document.body.replaceChildren();
});

function svg() {
  return document.createElementNS("http://www.w3.org/2000/svg", "svg");
}

describe("createHudDisc", () => {
  it("is one named standard button with the face, art and icon box at whole units", () => {
    const activate = vi.fn();
    const icon = svg();
    const art = svg();
    const disc = createHudDisc(document, {
      art,
      bearings: { bottom: 3, left: 1, right: 2, top: 3 },
      className: "game-disc",
      getAction: () => ({ activate }),
      icon,
      name: "Rapid missile",
      rule,
      size: "large",
      sizes,
    });
    const { element, face } = disc;
    expect(element.tagName).toBe("BUTTON");
    expect(element.className).toContain(`game-disc ${HUD_DISC_CLASS}`);
    expect(element.getAttribute("aria-label")).toBe("Rapid missile");
    expect(face.classList.contains(HUD_DISC_FACE_CLASS)).toBe(true);
    expect(face.classList.contains("ui-control-button")).toBe(false);
    expect(face.hasAttribute("data-ui-refusal-label")).toBe(true);
    expect(face.firstElementChild).toBe(art);
    expect(art.classList.contains(HUD_DISC_ART_CLASS)).toBe(true);
    expect(art.getAttribute("aria-hidden")).toBe("true");
    const slot = face.querySelector<HTMLElement>(`.${HUD_DISC_ICON_CLASS}`)!;
    expect(slot.firstElementChild).toBe(icon);
    expect(slot.getAttribute("aria-hidden")).toBe("true");
    expect(value(element, "--ui-hud-disc-face")).toBe("33");
    expect(value(element, "--ui-hud-disc-icon")).toBe("20");
    expect(value(element, "--ui-hud-disc-icon-x")).toBe("7");
    expect(value(element, "--ui-hud-disc-icon-y")).toBe("6");
    expect(disc.size()).toEqual(sizes.large);
    document.body.append(element);
    element.click();
    expect(activate).toHaveBeenCalledOnce();
    disc.dispose();
  });

  it("changes size, icon and name without changing the button", () => {
    const disc = createHudDisc(document, {
      getAction: () => null,
      name: "Pause",
      rule,
      size: "large",
      sizes,
    });
    const { element } = disc;
    disc.setSize("small");
    expect(element.dataset.uiHudDiscSize).toBe("small");
    expect(value(element, "--ui-hud-disc-face")).toBe("24");
    expect(value(element, "--ui-hud-disc-icon-x")).toBe("4");
    const icon = svg();
    disc.setIcon(icon, { bottom: 0, left: 2, right: 0, top: 0 });
    expect(value(element, "--ui-hud-disc-icon-x")).toBe("3");
    disc.setName("Menu");
    expect(element.getAttribute("aria-label")).toBe("Menu");
    expect(disc.element).toBe(element);
    expect(() => disc.setName(" ")).toThrow(RangeError);
    expect(element.getAttribute("aria-label")).toBe("Menu");
    expect(() => disc.setSize("huge")).toThrow(RangeError);
    expect(disc.size()).toEqual(sizes.small);
    expect(() => disc.setIcon(icon, { bottom: 0, left: 8, right: 8, top: 0 })).toThrow(RangeError);
    expect(value(element, "--ui-hud-disc-icon-x")).toBe("3");
  });

  it("refuses an unknown or invalid size", () => {
    const options = { getAction: () => null, name: "Pause", rule, sizes };
    expect(() => createHudDisc(document, { ...options, size: "toString" })).toThrow(RangeError);
    expect(() =>
      createHudDisc(document, { ...options, size: "odd", sizes: { odd: { face: 1.5, icon: 1 } } }),
    ).toThrow(RangeError);
  });

  it("is an action group's action, its press area the group's", () => {
    const group = createActionGroup(document);
    const discs = ["a", "b"].map((name) =>
      createHudDisc(document, { getAction: () => null, name, rule, size: "large", sizes }),
    );
    group.element.append(...discs.map((disc) => disc.element));
    const arrangement = group.arrange(
      { gap: "small", pressOverlap: "nearest", width: 90 },
      discs.map((disc) => ({
        element: disc.element,
        role: "secondary" as const,
        size: { height: disc.size().face, width: disc.size().face },
      })),
    );
    const [a, b] = arrangement.actions.map((action) => {
      if (action.hidden) {
        throw new Error("hidden");
      }
      return action;
    });
    // HIT_RULE grows a 33 face by 9 a side; toward the neighbour the cut is at the centres.
    expect(a!.press.width).toBe(51);
    expect(b!.face.x).toBe(57);
    expect(b!.press.x).toBe(48);
    expect(value(discs[0]!.element, "--ui-action-outset-right")).toBe("9");
    expect(value(discs[1]!.element, "--ui-action-outset-left")).toBe("9");
  });
});

const RING_INSET = "calc(var(--ui-hud-disc-ring-inset, 0) * var(--ui-unit, 1) * 1px)";

describe("hudDisc.css", () => {
  it("matches only through zero-specificity selectors", () => {
    const selectors = [...css.matchAll(/(^|\n)\s*([^@{}\s][^{}]*)\{/g)].map((match) =>
      match[2]!.trim(),
    );
    expect(selectors.length).toBeGreaterThan(5);
    for (const selector of selectors) {
      expect(selector, selector).toMatch(/^:where\(/);
    }
  });

  it("changes only fills and images by state, with no rings, colour literals or fixed lengths", () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\b(rgb|hsl)a?\(/i);
    expect(css).not.toMatch(/\boutline\s*:/);
    // The one shadow is the fill layer's own fill, spread over the band inside the edge.
    expect(
      css.match(/\bbox-shadow\s*:[^;]*;/g)?.map((shadow) => shadow.replace(/\s+/g, " ")),
    ).toEqual([`box-shadow: 0 0 0 ${RING_INSET} var(--ui-hud-disc-layer-fill);`]);
    expect(css.replace(/\* -?1px\b/g, "")).not.toMatch(/\d(px|rem|em)\b/);
    for (const state of [
      ...css.matchAll(/(:focus-visible|\[data-ui-pressed\]|:disabled)[^{]*\{([^}]*)\}/g),
    ]) {
      const properties = [...state[2]!.matchAll(/([a-z-]+)\s*:/g)].map((match) => match[1]);
      for (const property of properties) {
        expect([
          "--ui-hud-disc-layer-fill",
          "background-color",
          "background-image",
          "border-color",
          "color",
        ]).toContain(property);
      }
    }
    expect(css).toContain("@media (forced-colors: active)");
  });

  it("draws the game's fill, ring and ink per state, which forced colours set aside", () => {
    for (const state of ["", "selected-", "focus-", "pressed-", "disabled-"]) {
      expect(css).toContain(`var(--ui-hud-disc-${state}fill, transparent)`);
      expect(css).toContain(`var(--ui-hud-disc-${state}ink, currentColor)`);
      expect(css).toMatch(new RegExp(`var\\(\\s*--ui-hud-disc-${state}ring-colour`));
    }
    // The ring is one width in every state, part of the fill layer under the art and icon.
    expect(css.match(/--ui-hud-disc-ring,/g)).toHaveLength(1);
    expect(css).toContain("background-color: var(--ui-hud-disc-layer-fill);");
    for (const state of ["selected-", "focus-", "pressed-", "disabled-"]) {
      expect(css).toContain(
        `--ui-hud-disc-layer-fill: var(--ui-hud-disc-${state}fill, transparent);`,
      );
    }
    const forced = css.slice(css.indexOf("@media (forced-colors: active)"));
    expect(forced).toMatch(/\.ui-hud-disc-face\)::before\s*\{\s*display: none;/);
    expect(forced).toMatch(/\.ui-hud-disc-icon\)\s*\{\s*color: currentColor;/);
  });

  // The ring sits its inset inside the edge in every state, 0 by default, and the fill covers the
  // band between: only the fill layer's box moves, never the disc's.
  it("insets the ring by one token, in every state, with the fill under the band", () => {
    const layers = [...css.matchAll(/::before\s*\{([^}]*)\}/g)].map((match) => match[1]!);
    const [base, ...states] = layers;
    expect(base).toContain(`inset: ${RING_INSET};`);
    expect(base).toContain(`box-shadow: 0 0 0 ${RING_INSET}`);
    for (const state of states) {
      expect(state).not.toMatch(/\b(inset|box-shadow|border-width|border)\s*:/);
    }
    expect(css.match(/--ui-hud-disc-ring-inset\b/g)).toHaveLength(2);
  });
});
