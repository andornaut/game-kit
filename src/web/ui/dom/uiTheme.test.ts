// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  BUTTON_RESET_CLASS,
  colourProperty,
  TEXT_ROLES,
  textRoleClass,
  UI_COLOUR_ROLES,
} from "../../../ui/uiTheme.ts";
import { setTextRoles, setUiColours, UI_THEME_ATTRIBUTE } from "./uiTheme.ts";

const css = readFileSync(join(import.meta.dirname, "uiTheme.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

describe("setUiColours", () => {
  it("writes the slots, marks the theme root and reports changes", () => {
    const root = document.createElement("div");
    expect(setUiColours({ buttonFace: 0x9690b4 }, root)).toBe(true);
    expect(root.hasAttribute(UI_THEME_ATTRIBUTE)).toBe(true);
    expect(root.style.getPropertyValue("--ui-colour-button-face")).toBe("#9690b4");
    expect(setUiColours({ buttonFace: "#9690B4" }, root)).toBe(false);
    expect(setUiColours({}, root)).toBe(false);
  });

  it("writes nothing on an invalid slot", () => {
    const root = document.createElement("div");
    expect(() => setUiColours({ accent: 1, buttonFace: "blue" }, root)).toThrow(RangeError);
    expect(root.getAttribute("style")).toBeNull();
    expect(root.hasAttribute(UI_THEME_ATTRIBUTE)).toBe(false);
  });
});

describe("setTextRoles", () => {
  it("writes each role's lengths unitless", () => {
    const root = document.createElement("div");
    expect(setTextRoles({ body: { lineHeight: 20, size: 16, weight: 400 } }, root)).toBe(true);
    expect(root.style.getPropertyValue("--ui-text-body-size")).toBe("16");
    expect(root.style.getPropertyValue("--ui-text-body-line-height")).toBe("20");
    expect(root.style.getPropertyValue("--ui-text-body-weight")).toBe("400");
  });
});

describe("uiTheme.css", () => {
  it("reads every text and button colour slot and text role", () => {
    // Surface slots are read by the components that draw surfaces.
    const surfaces = new Set(["accent", "cardFace", "frame"]);
    for (const role of UI_COLOUR_ROLES.filter((name) => !surfaces.has(name))) {
      expect(css, role).toContain(`var(${colourProperty(role)}`);
    }
    for (const role of TEXT_ROLES) {
      expect(css).toContain(`.${textRoleClass(role)}`);
      for (const field of ["size", "line-height", "weight"]) {
        expect(css).toContain(`var(--ui-text-${role}-${field})`);
      }
    }
    expect(css).toContain(`.${BUTTON_RESET_CLASS}`);
  });

  it("matches only through zero-specificity selectors", () => {
    const selectors = [...css.matchAll(/(^|\n)\s*([^@{}\s][^{}]*)\{/g)].map((match) =>
      match[2]!.trim(),
    );
    expect(selectors.length).toBeGreaterThan(5);
    for (const selector of selectors) {
      expect(selector, selector).toMatch(/^:where\(/);
    }
  });

  it("uses only slot and system colours, gated on the theme root", () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\b(rgb|hsl)a?\(/i);
    expect(css).not.toMatch(/\b(outline|box-shadow)\s*:/);
    for (const block of css.matchAll(/:where\(([^{]*)\)\s*\{[^}]*background-color/g)) {
      expect(block[1]).toContain(`[${UI_THEME_ATTRIBUTE}]`);
    }
    expect(css).toContain("@media (forced-colors: active)");
    for (const system of ["ButtonFace", "ButtonText", "Highlight", "HighlightText", "GrayText"]) {
      expect(css).toContain(system);
    }
  });

  it("feeds the focus slots to the one focus fill and never dips a disabled face", () => {
    expect(css).toContain("--ui-button-focus-fill: var(--ui-colour-button-focus-face, Highlight)");
    expect(css).not.toContain(":focus");
    const disabled = /:disabled[^{]*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(disabled).toContain("translate: none");
  });
});
