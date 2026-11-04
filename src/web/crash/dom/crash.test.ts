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
});
