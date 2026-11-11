import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { BUTTON_GAP, SMALL_BUTTON_GAP } from "../../../ui/spacing.ts";
import { REFUSAL_ATTRIBUTES, REFUSAL_SHAKE, REFUSAL_SHAKE_MS } from "./refusalCue.ts";
import { UI_UNIT, units, VIEW_PROPERTIES } from "./viewUnits.ts";

// ui.css reads the names the modules write.
describe("ui.css", () => {
  const css = readFileSync(join(import.meta.dirname, "ui.css"), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );

  it.each([UI_UNIT, REFUSAL_SHAKE, REFUSAL_SHAKE_MS, ...Object.values(VIEW_PROPERTIES)])(
    "reads %s",
    (name) => {
      expect(css).toContain(`var(${name}`);
    },
  );

  it.each<[string, number]>([
    ["--ui-button-gap", BUTTON_GAP],
    ["--ui-small-button-gap", SMALL_BUTTON_GAP],
  ])("sets %s on the layer to %s base px", (name, gap) => {
    const layer = /\.ui-layer\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(new RegExp(`${name}:\\s*([^;]+);`).exec(layer)?.[1]).toBe(units(gap));
    expect(css.split(`${name}:`)).toHaveLength(2);
  });

  it.each(Object.values(REFUSAL_ATTRIBUTES))("styles [%s]", (name) => {
    expect(css).toContain(`[${name}`);
  });

  it.each(["left", "right", "out", "back"])("styles the %s shake stroke", (stroke) => {
    expect(css).toContain(`[${REFUSAL_ATTRIBUTES.shake}="${stroke}"]`);
  });
});
