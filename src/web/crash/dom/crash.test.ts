import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const EDGES = ["top", "right", "bottom", "left"] as const;

// The crash screen turns with a page frame inside <body>, so it keeps clear of the frame's own
// safe areas: each side's padding reads that side's --inset-* property, and the screen's inset
// where no frame stylesheet sets it.
describe("crash.css", () => {
  const css = readFileSync(join(import.meta.dirname, "crash.css"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ");
  // Without the line breaks a formatter puts inside long var() and calc() expressions.
  const flat = css.replace(/\(\s+/g, "(").replace(/\s+\)/g, ")");

  it.each(EDGES)("pads the %s with the frame's inset", (edge) => {
    expect(css).toContain(`var(--inset-${edge}, env(safe-area-inset-${edge}, 0px))`);
  });

  it("reads all four insets in every block that reads any", () => {
    const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
      body: body ?? "",
      selector: (selector ?? "").trim(),
    }));
    const insetBlocks = blocks.filter(({ body }) => body.includes("--inset-"));
    expect(insetBlocks.map(({ selector }) => selector)).toEqual([".crash"]);
    for (const { body, selector } of insetBlocks) {
      expect(
        EDGES.filter((edge) => !body.includes(`--inset-${edge}`)),
        selector,
      ).toEqual([]);
    }
  });

  // Each uiTheme role and slot falls back to the screen's own value, so a page that sets none keeps
  // its look.
  it.each([
    ["heading", "22px", "1.25"],
    ["body", "16px", "1.5"],
    ["supporting", "12px", "1.4"],
  ])("takes the %s role with its own default", (role, size, lineHeight) => {
    expect(css).toContain(`var(--crash-${role}-size, ${size})`);
    expect(css).toContain(`var(--crash-${role}-line-height, ${lineHeight})`);
  });

  it.each(["heading", "body", "label", "supporting"])(
    "scales the %s role by the inherited unit",
    (role) => {
      for (const field of ["size", "line-height"]) {
        expect(flat).toContain(
          `--crash-${role}-${field}: calc(var(--ui-text-${role}-${field}) * var(--ui-unit, 1) * 1px)`,
        );
      }
    },
  );

  it.each([
    "var(--ui-colour-text-primary, var(--crash-text))",
    "var(--ui-colour-frame, var(--crash-text))",
    "var(--ui-colour-card-face, transparent)",
    "var(--ui-colour-button-face, var(--crash-button-face))",
    "var(--ui-colour-button-text, var(--crash-background))",
    "var(--ui-colour-button-pressed-face, var(--crash-action-face))",
    "var(--ui-colour-button-focus-face, var(--crash-action-text))",
    "var(--ui-colour-button-primary-face, var(--ui-colour-button-face, var(--crash-button-face)))",
  ])("falls back from the slot in %s", (declaration) => {
    expect(flat).toContain(declaration);
  });
});
