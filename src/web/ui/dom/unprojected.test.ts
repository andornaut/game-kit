// @vitest-environment happy-dom
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { SliderArt } from "../../../ui/slider.ts";
import { createActionGroup, createPressContext } from "./actionGroup.ts";
import { createFormRow, createFormRows } from "./formRow.ts";
import { createModalFrame } from "./modalFrame.ts";
import { createSlider } from "./slider.ts";

// Callers without a projection get the same markup, inline styles and CSS as GameKit 0.83.0. The
// digests are of 0.83.0's output for the same calls, and of its stylesheets with comments removed
// and whitespace collapsed. Rules for opt-in parts (one-action rows and press dips, 0.90.0) apply
// only to rows that set them, so they are removed too. A placed list without the 0.90.0 options
// (artPixel and gaps) writes what 0.89.0 wrote.

const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const markup = (...elements: Element[]) => elements.map((e) => e.outerHTML).join("\n");

// A stylesheet as an unprojected caller resolves it: projected and opt-in rules gone and the length
// variable replaced by its unprojected definition, calc(var(--ui-unit, 1) * 1px).
function unprojectedCss(file: string, length: string): string {
  return readFileSync(join(import.meta.dirname, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/[^{}]*(projected|data-ui-form-action|data-ui-form-press-dip)[^{}]*\{[^{}]*\}/g, "")
    .replace(new RegExp(`\\s*${length}:[^;]*;`, "g"), "")
    .replace(/[^{}]*\{\s*\}/g, "")
    .replaceAll(`var(${length}) * -1`, "var(--ui-unit, 1) * -1px")
    .replaceAll(`var(${length})`, "var(--ui-unit, 1) * 1px")
    .replace(/\s+/g, " ")
    .trim();
}

const ART: SliderArt = {
  thumb: { height: 16, width: 10 },
  track: { caps: { left: 4, right: 3 }, height: 10 },
};
const rule = { holdMs: 500, slopPx: 5 };

describe("unprojected callers", () => {
  it.each([
    [
      "actionGroup.css",
      "--ui-action-length",
      "9b5502499d052de8531ada095e0745bacbbe80d3a11fe06efca6e3ecd2a6b81a",
    ],
    [
      "formRow.css",
      "--ui-form-length",
      "bcd06566a4e4b8bdd368ddc800f29ffbc42ef1854eeb695de4c2c3806ca89a5a",
    ],
    [
      "slider.css",
      "--ui-form-length",
      "c80e9ec27aa03fefb76557a933e1836fa58aed6ba1ff25a1e6c0149a2fd50cde",
    ],
  ])("resolve %s as before", (file, length, expected) => {
    expect(digest(unprojectedCss(file, length))).toBe(expected);
  });

  it("get the same action group markup", () => {
    const root = document.createElement("div");
    const group = createActionGroup(document, { className: "game-actions" });
    const [back, pager, ok, hidden] = ["button", "div", "button", "button"].map((tag) =>
      document.createElement(tag),
    ) as [HTMLElement, HTMLElement, HTMLElement, HTMLElement];
    hidden.hidden = true;
    group.element.append(back, pager, ok, hidden);
    const grid = createActionGroup(document);
    const cells = [0, 1, 2].map(() => document.createElement("button"));
    grid.element.append(...cells);
    const row = document.createElement("button");
    root.append(group.element, grid.element, row);
    document.body.append(root);
    const states: string[] = [];
    group.arrange({ width: 201 }, [
      { element: ok, role: "primary", size: { height: 48, width: 50 } },
      { element: back, role: "secondary", size: { height: 48, width: 61 } },
      { element: hidden, role: "secondary", size: { height: 48, width: 20 } },
    ]);
    states.push(markup(root));
    group.arrange(
      {
        gap: "small",
        middle: { element: pager, size: { height: 40, width: 81 } },
        pressOverlap: "nearest",
        variant: "footer",
        width: 300,
      },
      [
        { element: back, role: "secondary", size: { height: 48, width: 60 } },
        { element: ok, role: "primary", size: { height: 47, width: 71 } },
      ],
    );
    states.push(markup(root));
    grid.arrangeGrid({ cellWidth: "fill", columns: 2, width: 203 }, [
      { element: cells[0]!, role: "secondary", size: { height: 40, width: 50 } },
      { element: cells[1]!, locked: true, role: "secondary", size: { height: 33, width: 41 } },
      { element: cells[2]!, role: "primary", size: { height: 40, width: 60 } },
    ]);
    states.push(markup(root));
    const context = createPressContext(root);
    context.add(group);
    context.add(grid);
    context.add(row);
    context.apply();
    states.push(markup(root));
    context.remove(grid);
    group.dispose();
    states.push(markup(root));
    root.remove();
    expect(states.map(digest)).toEqual([
      "84c17d11ff324c2a1499e2e300eb4b3af3733ad7e12d65c89e0761fd580e6abf",
      "881bf69bbe912001a25a264ec5475c3e737c8f110d41b5bf3672f74fd5252906",
      "a70095a5980decb45193f961bf387a72c0ad224a46aaed975d4dc6f15e04f50b",
      "76f50ca0bb8d59dfc4340034d707334c7bd5aa72f7aeb24e73ee1e3e607dad5c",
      "33bfc7fed1e484a68e23cf5b1144ecd730a91629d804228dca107991ea1374b6",
    ]);
  });

  it("get the same form row and slider markup", () => {
    const rows = createFormRows(
      document,
      {
        align: "start",
        columnGap: 4,
        height: 48,
        icon: { offset: 3, size: 15, slot: 18 },
        padding: { bottom: 2, left: 8, right: 7, top: 5 },
        switch: { height: 14, width: 27 },
        value: { bearing: 1, gap: 2, offset: 6, state: "end", track: 41 },
      },
      { className: "game-rows" },
    );
    document.body.append(rows.element);
    const toggle = createFormRow(document, {
      getAction: () => null,
      getState: () => ({ checked: true, value: "On" }),
      icon: document.createElement("img"),
      label: "Sound",
      note: "Plays effects.",
      rule,
      switch: true,
    });
    const plain = createFormRow(document, {
      getAction: () => null,
      getState: () => ({ value: "Large" }),
      label: "Text size",
      rule,
    });
    const slider = createSlider(document, {
      change: () => undefined,
      getState: () => ({ step: 7, value: "35%" }),
      icon: document.createElement("img"),
      label: "Music",
      layout: { art: ART, gap: 2, height: 57, inset: { left: 3, right: 5 } },
      note: "Background tunes.",
      slop: 4,
      steps: 20,
    });
    rows.element.append(toggle.element, plain.element, slider.element);
    toggle.refresh();
    plain.refresh();
    const states = [markup(rows.element)];
    rows.setLayout({ columnGap: 3, height: 44, value: { state: "center" } });
    slider.setLayout({ art: ART });
    slider.refresh();
    states.push(markup(rows.element));
    rows.element.remove();
    expect(states.map(digest)).toEqual([
      "00a7208a9ee2ac94e0420b0c68f5b3893916f5499b92ce0af4f1314b5dd47a0e",
      "741a89832222ab9e1d3e672a1b366ebb7f493f1f2c05c8d1b515c23c5b7f379b",
    ]);
  });

  it("place a list without art pixels or gaps as 0.89.0 did", () => {
    // Archie's grid at 390x844@3: whole 3 px art pixels, 3.25 device px per unit.
    const grid = (edge: number) => Math.round((edge * 3.25) / 3) * 3;
    const rows = createFormRows(document, {
      columnGap: 4,
      height: 48,
      icon: { size: 16, slot: 24 },
      padding: { bottom: 0, left: 8, right: 8, top: 0 },
      switch: { height: 16, width: 32 },
      value: { bearing: 1, gap: 4, state: "end", track: 40 },
    });
    document.body.append(rows.element);
    const toggle = createFormRow(document, {
      getAction: () => null,
      getState: () => ({ checked: true, value: "On" }),
      icon: document.createElement("img"),
      label: "Sound",
      rule,
      switch: true,
    });
    const plain = createFormRow(document, {
      getAction: () => null,
      getState: () => ({ value: "Large" }),
      label: "Text size",
      rule,
    });
    const slider = createSlider(document, {
      change: () => undefined,
      getState: () => ({ step: 7, value: "35%" }),
      icon: document.createElement("img"),
      label: "Music",
      layout: { art: ART, gap: 4, height: 56, inset: { left: 2 }, line: 20 },
      slop: 4,
      steps: 20,
    });
    rows.element.append(toggle.element, plain.element, slider.element);
    toggle.refresh();
    plain.refresh();
    const { placed } = rows.place(
      { origin: { x: 8, y: 103 }, project: { x: grid, y: grid }, width: 344 },
      [toggle, plain, slider],
    );
    const state = markup(rows.element) + JSON.stringify(placed);
    rows.element.remove();
    expect(digest(state)).toBe("c302a8e5895ec0b99300c0644920327704ed6840025deda99ae29ce259adcc5c");
  });

  it("get the same modal frame markup with a kit footer", () => {
    const frame = createModalFrame(document, { id: "leave", title: "Leave" });
    const stay = document.createElement("button");
    const leave = document.createElement("button");
    frame.footer.element.append(stay, leave);
    const close = document.createElement("button");
    document.body.append(frame.element);
    frame.layout(
      {
        close: { face: { height: 24, width: 24, x: 6, y: 6 } },
        content: { height: 540, width: 960, x: 0, y: 0 },
        families: { medium: 500 },
        family: "medium",
      },
      {
        body: 120,
        close,
        footer: {
          actions: [
            { element: stay, role: "secondary", size: { height: 48, width: 90 } },
            { element: leave, role: "primary", size: { height: 48, width: 100 } },
          ],
        },
        title: { height: 28 },
      },
    );
    const state = markup(frame.element);
    frame.element.remove();
    expect(digest(state)).toBe("fc524cf25c0cd8e9ddad233ba00bec964ed510bc5da7e4cbf621616321ab20ef");
  });
});
