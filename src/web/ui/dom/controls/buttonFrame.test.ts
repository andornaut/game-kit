import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { BUTTON_FRAME_CLASS, BUTTON_FRAME_CONTENT_CLASS } from "../../../../ui/uiTheme.ts";

const css = readFileSync(join(import.meta.dirname, "buttonFrame.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);
const forcedAt = css.indexOf("@media (forced-colors: active)");
const blocks = (text: string) =>
  [...text.matchAll(/:where\(([^{]*)\)\s*\{([^}]*)\}/g)].map(([, selector, body]) => ({
    body: body!,
    selector: selector!,
  }));

describe("buttonFrame.css", () => {
  it("matches only through zero-specificity selectors, with no literals", () => {
    const selectors = [...css.matchAll(/(^|\n)\s*([^@{}\s][^{}]*)\{/g)].map((match) =>
      match[2]!.trim(),
    );
    expect(selectors.length).toBeGreaterThan(8);
    for (const selector of selectors) {
      expect(selector, selector).toMatch(/^:where\(/);
    }
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\b(rgb|hsl)a?\(/i);
    expect(css).not.toMatch(/\b(outline|box-shadow)\s*:/);
    expect(css.replace(/\* 1px\)|\b0px\b/g, "")).not.toMatch(/\d(px|rem|em)\b/);
  });

  it("takes each state's frame from its tokens, falling back to the idle frame", () => {
    expect(css).toContain(`.${BUTTON_FRAME_CLASS}`);
    expect(css).toContain(`.${BUTTON_FRAME_CONTENT_CLASS}`);
    for (const state of [
      "",
      "primary-",
      "selected-",
      "pressed-",
      "primary-pressed-",
      "disabled-",
    ]) {
      for (const part of ["image", "slice", "width"]) {
        expect(css).toMatch(new RegExp(`var\\(\\s*--ui-button-frame-${state}${part}\\b`));
      }
    }
    expect(css).toContain("border-image-slice: var(--ui-button-frame-state-slice) fill;");
  });

  it("fills inside the frame on press and focus in the theme, focus last, never when disabled", () => {
    const fills = blocks(css.slice(0, forcedAt)).filter(({ body }) =>
      body.includes("background-color"),
    );
    expect(fills.map(({ body }) => /background-color: ([^;]+);/.exec(body)![1])).toEqual([
      "var(--ui-colour-button-pressed-face)",
      "var(--ui-button-focus-fill, Highlight)",
    ]);
    for (const { body, selector } of fills) {
      expect(selector).toContain("[data-ui-theme]");
      expect(selector).toContain(':not(:disabled, [aria-disabled="true"])');
      expect(body).toContain("border-image-slice: var(--ui-button-frame-state-slice);");
    }
  });

  it("uses system edges and fills in forced colours", () => {
    const forced = css.slice(forcedAt);
    expect(forcedAt).toBeGreaterThan(0);
    expect(forced).toContain("border-image-source: none");
    for (const system of ["ButtonFace", "ButtonText", "Highlight", "GrayText"]) {
      expect(forced).toContain(system);
    }
  });
});
