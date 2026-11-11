import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { REFUSAL_ATTRIBUTES, REFUSAL_SHAKE, REFUSAL_SHAKE_MS } from "./refusalCue.ts";
import { UI_UNIT, VIEW_PROPERTIES } from "./viewUnits.ts";

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

  it.each(Object.values(REFUSAL_ATTRIBUTES))("styles [%s]", (name) => {
    expect(css).toContain(`[${name}`);
  });

  it.each(["left", "right", "out", "back"])("styles the %s shake stroke", (stroke) => {
    expect(css).toContain(`[${REFUSAL_ATTRIBUTES.shake}="${stroke}"]`);
  });
});
