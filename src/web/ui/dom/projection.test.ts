// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { Rect } from "../../../rect.ts";
import { type ActionProjection, arrangeActions } from "../../../ui/actionGroup.ts";
import type { FormRowLayout } from "../../../ui/formRow.ts";
import type { SliderArt } from "../../../ui/slider.ts";
import {
  ACTION_PROJECTED_ATTRIBUTE,
  createActionGroup,
  createPressContext,
} from "./actionGroup.ts";
import {
  createFormRow,
  createFormRows,
  FORM_ROW_ACTION_ATTRIBUTE,
  FORM_ROWS_PROJECTED_ATTRIBUTE,
} from "./formRow.ts";
import { createModalFrame } from "./modalFrame.ts";
import { createSlider } from "./slider.ts";

// Placement on a game's grid: Archie's device art-pixel grid at several scales and DPRs, every
// placed part's edges written in CSS px from its holder's corner.

const SCALES = [
  { dpr: 1, origin: { x: 0, y: 0 }, unit: 1 },
  { dpr: 2, origin: { x: 10.25, y: 3.5 }, unit: 1.5 },
  { dpr: 3, origin: { x: 0, y: 17.4 }, unit: 2.1 },
  { dpr: 2.625, origin: { x: 41.3, y: 0.7 }, unit: 1.17 },
];

// Archie's DOM grid (domScale gridX, gridY and gridRect): a game edge's exact device place from
// the layer's grid-snapped corner, rounded to whole art pixels.
function archieGrid(scale: { dpr: number; origin: { x: number; y: number }; unit: number }) {
  const art = Math.max(1, Math.floor(scale.unit * scale.dpr + 1e-9));
  const axis = (origin: number) => (edge: number) => {
    const exact = (origin + edge * scale.unit) * scale.dpr - Math.round(origin * scale.dpr);
    return Math.round(exact / art) * art;
  };
  const project: ActionProjection = { x: axis(scale.origin.x), y: axis(scale.origin.y) };
  const gridRect = (rect: Rect): Rect => {
    const left = project.x(rect.x);
    const top = project.y(rect.y);
    return {
      height: project.y(rect.y + rect.height) - top,
      width: project.x(rect.x + rect.width) - left,
      x: left,
      y: top,
    };
  };
  return { gridRect, project };
}

const value = (element: HTMLElement, name: string) => element.style.getPropertyValue(name);
const numbers = (element: HTMLElement, names: readonly string[]) =>
  names.map((name) => Number(value(element, name)));
const BOX = ["--ui-action-x", "--ui-action-y", "--ui-action-width", "--ui-action-height"];

const ART: SliderArt = {
  thumb: { height: 16, width: 10 },
  track: { caps: { left: 4, right: 4 }, height: 10 },
};
const rule = { holdMs: 500, slopPx: 5 };
// Archie's Settings list: a switch row, a value row and a volume slider.
const LIST: FormRowLayout = {
  columnGap: 4,
  height: 48,
  icon: { size: 16, slot: 24 },
  padding: { bottom: 0, left: 8, right: 8, top: 0 },
  switch: { height: 16, width: 32 },
  value: { bearing: 1, gap: 4, state: "end", track: 40 },
};

function settings() {
  const rows = createFormRows(document, LIST);
  const sound = createFormRow(document, {
    getAction: () => null,
    getState: () => ({ checked: true, value: "On" }),
    icon: document.createElement("img"),
    label: "Sound",
    rule,
    switch: true,
  });
  const size = createFormRow(document, {
    getAction: () => null,
    getState: () => ({ value: "Large" }),
    label: "Text size",
    rule,
  });
  let step = 10;
  const change = vi.fn((next: number) => {
    step = next;
  });
  const music = createSlider(document, {
    change,
    getState: () => ({ step, value: `${step * 5}%` }),
    icon: document.createElement("img"),
    label: "Music",
    layout: { art: ART, gap: 4, height: 56, inset: { left: 2 }, line: 20 },
    slop: 4,
    steps: 20,
  });
  rows.element.append(sound.element, size.element, music.element);
  document.body.append(rows.element);
  return { change, music, rows, size, sound };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("a projected action group", () => {
  it.each(SCALES)("lands on Archie's grid at $unit units and DPR $dpr", (scale) => {
    const { gridRect, project } = archieGrid(scale);
    const group = createActionGroup(document);
    const back = document.createElement("button");
    const pager = document.createElement("div");
    const ok = document.createElement("button");
    group.element.append(back, pager, ok);
    const origin = { x: 8, y: 500 };
    const sizes = [
      { height: 48, width: 96 },
      { height: 48, width: 128 },
    ] as const;
    const context = {
      middle: { height: 40, width: 81 },
      origin,
      variant: "footer",
      width: 344,
    } as const;
    const units = arrangeActions(context, [
      { key: back, role: "secondary", size: sizes[0] },
      { key: ok, role: "primary", size: sizes[1] },
    ]);
    const arrangement = group.arrange(
      { ...context, middle: { element: pager, size: context.middle }, project },
      [
        { element: back, role: "secondary", size: sizes[0] },
        { element: ok, role: "primary", size: sizes[1] },
      ],
    );
    expect(group.element.hasAttribute(ACTION_PROJECTED_ATTRIBUTE)).toBe(true);
    const corner = gridRect(units.group);
    expect(arrangement.group).toEqual(corner);
    expect(numbers(group.element, ["--ui-action-group-width", "--ui-action-group-height"])).toEqual(
      [corner.width, corner.height],
    );
    const local = (rect: Rect) => [rect.x - corner.x, rect.y - corner.y, rect.width, rect.height];
    units.actions.forEach((action, i) => {
      if (action.hidden) {
        throw new Error("visible");
      }
      const element = action.key;
      expect(numbers(element, BOX)).toEqual(local(gridRect(action.face)));
      // The press area's projected edges, written as outsets from the projected face.
      const { face, outset } = action;
      const taken = gridRect({
        height: face.height + outset.top + outset.bottom,
        width: face.width + outset.left + outset.right,
        x: face.x - outset.left,
        y: face.y - outset.top,
      });
      const drawn = gridRect(face);
      expect(
        numbers(
          element,
          ["top", "right", "bottom", "left"].map((s) => `--ui-action-outset-${s}`),
        ),
      ).toEqual([
        drawn.y - taken.y,
        taken.x + taken.width - (drawn.x + drawn.width),
        taken.y + taken.height - (drawn.y + drawn.height),
        drawn.x - taken.x,
      ]);
      expect(arrangement.actions[i]).toMatchObject({ face: drawn });
    });
    expect(numbers(pager, BOX)).toEqual(local(gridRect(units.middle!)));
    // Arranged again without a projection, the group is in base px once more.
    group.arrange({ width: 344 }, [{ element: ok, role: "primary", size: sizes[1] }]);
    expect(group.element.hasAttribute(ACTION_PROJECTED_ATTRIBUTE)).toBe(false);
    expect(value(group.element, "--ui-action-group-width")).toBe("344");
  });

  it("places a grid on the grid and takes an origin only with a projection", () => {
    const { gridRect, project } = archieGrid(SCALES[3]!);
    const group = createActionGroup(document);
    const cells = [0, 1, 2].map(() => document.createElement("button"));
    group.element.append(...cells);
    const actions = cells.map((element) => ({
      element,
      role: "secondary" as const,
      size: { height: 48, width: 100 },
    }));
    const origin = { x: 16, y: 200 };
    const arrangement = group.arrangeGrid(
      { cellWidth: "fill", columns: 2, origin, project, width: 328 },
      actions,
    );
    expect(arrangement.group).toEqual(gridRect({ height: 104, width: 328, x: 16, y: 200 }));
    const last = arrangement.actions[2]!;
    expect(last.hidden).toBe(false);
    expect(Number(value(cells[2]!, "--ui-action-y"))).toBe(
      (last as { face: Rect }).face.y - arrangement.group.y,
    );
    expect(() => group.arrange({ origin, width: 328 }, actions)).toThrow(RangeError);
    expect(() => group.arrangeGrid({ columns: 2, origin, width: 328 }, actions)).toThrow(
      RangeError,
    );
  });
});

describe("a placed form row list", () => {
  it.each(SCALES)("lands every part on Archie's grid at $unit units and DPR $dpr", (scale) => {
    const { project } = archieGrid(scale);
    const x = project.x;
    const y = project.y;
    const { music, rows, size, sound } = settings();
    const { placed, units } = rows.place({ origin: { x: 8, y: 103 }, project, width: 344 }, [
      sound,
      size,
      music,
    ]);
    expect(units.rows.map((row) => row.row.y)).toEqual([103, 159, 215]);
    expect(placed.rows[0]!.row).toEqual({
      height: y(151) - y(103),
      width: x(352) - x(8),
      x: x(8),
      y: y(103),
    });
    const list = rows.element;
    expect(list.hasAttribute(FORM_ROWS_PROJECTED_ATTRIBUTE)).toBe(true);
    const px = (edges: readonly number[], at: (edge: number) => number) =>
      edges.slice(1).map((edge, i) => `${at(edge) - at(edges[i]!)}px`);
    const [padLeft, slotLead, icon, slotTrail, label, gap, valueColumn, padRight] = px(
      [8, 16, 20, 36, 44, 300, 304, 344, 352],
      x,
    );
    expect(value(list, "--ui-form-columns")).toBe(
      `${padLeft} ${slotLead} [icon] ${icon} ${slotTrail} [label] ${label} ${gap} [value] ` +
        `${valueColumn} ${padRight}`,
    );
    expect(value(list, "--ui-form-rows")).toBe(px([103, 159, 215, 271], y).join(" "));
    expect(
      numbers(sound.element, [
        "--ui-form-row-height",
        "--ui-form-row-padding-top",
        "--ui-form-row-padding-left",
        "--ui-form-icon-offset",
        "--ui-form-icon-size",
        "--ui-form-icon-height",
        "--ui-form-value-offset",
        "--ui-switch-width",
        "--ui-switch-height",
        "--ui-form-switch-end",
        "--ui-form-value-gap",
        "--ui-form-state-bearing",
      ]),
    ).toEqual([
      y(151) - y(103),
      0,
      0,
      y(119) - y(103),
      x(36) - x(20),
      y(135) - y(119),
      y(119) - y(103),
      x(344) - x(312),
      y(135) - y(119),
      0,
      y(139) - y(135),
      x(344) - x(343),
    ]);
    expect(numbers(size.element, ["--ui-form-row-height", "--ui-switch-width"])).toEqual([
      y(207) - y(159),
      0,
    ]);
    // The lane is 4 under the 20 unit first line, inset 2; the thumb at step 10 of 20 is 158 in.
    expect(
      numbers(music.element, [
        "--ui-form-row-height",
        "--ui-slider-line",
        "--ui-slider-gap",
        "--ui-slider-inset-left",
        "--ui-slider-inset-right",
        "--ui-slider-lane-height",
        "--ui-slider-track-top",
        "--ui-slider-track-height",
        "--ui-slider-thumb-left",
        "--ui-slider-thumb-width",
        "--ui-slider-thumb-top",
        "--ui-slider-fill-width",
        "--ui-slider-empty-cap-left",
        "--ui-slider-empty-cap-right",
        "--ui-slider-fill-cap-right",
      ]),
    ).toEqual([
      y(271) - y(215),
      y(235) - y(215),
      y(239) - y(235),
      x(18) - x(8),
      x(352) - x(344),
      y(255) - y(239),
      y(242) - y(239),
      y(252) - y(242),
      x(176) - x(18),
      x(186) - x(176),
      y(239) - y(242),
      x(186) - x(18),
      x(22) - x(18),
      x(344) - x(340),
      x(186) - x(182),
    ]);
    // The cap slices stay in art pixels.
    expect(value(music.element, "--ui-slider-cap-left")).toBe("4");
  });

  it("moves the thumb on refresh, keeps its placement over a new layout and maps presses", () => {
    const { project } = archieGrid(SCALES[1]!);
    const { change, music, rows, size, sound } = settings();
    rows.place({ origin: { x: 8, y: 103 }, project, width: 344 }, [sound, size, music]);
    change(20);
    music.refresh();
    expect(value(music.element, "--ui-slider-thumb-left")).toBe(
      String(project.x(334) - project.x(18)),
    );
    music.setLayout({ art: ART, gap: 4, height: 56, inset: { left: 2 }, line: 20 });
    expect(value(music.element, "--ui-form-row-height")).toBe(
      String(project.y(271) - project.y(215)),
    );
    // The drawn track is 2 page px per unit: a press 163 units in, the thumb's centre at step 10.
    vi.spyOn(music.track, "getBoundingClientRect").mockReturnValue({
      bottom: 20,
      height: 20,
      left: 100,
      right: 752,
      toJSON: () => ({}),
      top: 0,
      width: 652,
      x: 100,
      y: 0,
    });
    music.element.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        cancelable: true,
        clientX: 100 + 2 * 163,
        clientY: 10,
        pointerId: 1,
        pointerType: "mouse",
      }),
    );
    expect(change).toHaveBeenLastCalledWith(10);
  });

  it("re-places on a new layout, skips hidden rows and refuses rows it cannot place", () => {
    const { project } = archieGrid(SCALES[2]!);
    const { music, rows, size, sound } = settings();
    size.element.hidden = true;
    const context = { origin: { x: 8, y: 103 }, project, width: 344 };
    const { units } = rows.place(context, [sound, size, music]);
    expect(units.rows.map((row) => row.row.y)).toEqual([103, 159]);
    rows.setLayout({ ...LIST, height: 44 });
    expect(value(sound.element, "--ui-form-row-height")).toBe(
      String(project.y(147) - project.y(103)),
    );
    const stranger = createFormRow(document, { getAction: () => null, label: "Other", rule });
    expect(() => rows.place(context, [sound, stranger])).toThrow(RangeError);
    const unfixed = { bearing: 1, gap: 4, state: "end" } as const;
    expect(() => rows.setLayout({ ...LIST, value: unfixed })).toThrow(RangeError);
    expect(value(sound.element, "--ui-form-row-height")).toBe(
      String(project.y(147) - project.y(103)),
    );
    music.setLayout({ art: ART, height: 56 });
    expect(() => rows.place(context, [sound, music])).toThrow(RangeError);
  });

  it("writes its tracks and lengths through the length variable", () => {
    const strip = (file: string) =>
      readFileSync(join(import.meta.dirname, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const form = strip("formRow.css");
    expect(form).toContain(
      ":where(.ui-form-rows[data-ui-form-projected], .ui-form-rows[data-ui-form-projected] *) {\n" +
        "  --ui-form-length: 1px;\n}",
    );
    expect(form).toMatch(/grid-template-columns: var\(--ui-form-columns\);/);
    expect(form).toMatch(/grid-template-rows: var\(--ui-form-rows\);/);
    for (const file of ["formRow.css", "slider.css"]) {
      // Only text sizes stay at --ui-unit.
      expect(
        strip(file)
          .split("\n")
          .filter(
            (line) =>
              line.includes("--ui-unit") && !/font-size|line-height|--ui-form-length:/.test(line),
          ),
      ).toEqual([]);
    }
  });
});

describe("press contexts with projected members", () => {
  it("clamps a projected group toward a placed row in the projection's space", () => {
    const project = { x: (edge: number) => 3 * edge, y: (edge: number) => 3 * edge + 1 };
    const { music, rows, size, sound } = settings();
    rows.place({ project, width: 344 }, [sound, size, music]);
    const group = createActionGroup(document);
    const back = document.createElement("button");
    group.element.append(back);
    document.body.append(group.element);
    const arrange = () =>
      group.arrange({ origin: { x: 0, y: 170 }, project, width: 344 }, [
        { element: back, role: "primary", size: { height: 48, width: 128 } },
      ]);
    arrange();
    const own = Number(value(back, "--ui-action-outset-top"));
    const presses = createPressContext(document.body);
    presses.add(music.element);
    presses.add(group);
    presses.apply();
    // The slider row ends at 168 units and the face starts at 170: 6 px apart, 3 the face's share.
    expect(own).toBeGreaterThan(3);
    expect(Number(value(back, "--ui-action-outset-top"))).toBe(3);
    presses.remove(group);
    expect(Number(value(back, "--ui-action-outset-top"))).toBe(own);
    presses.add(group);
    const plain = createActionGroup(document);
    const other = document.createElement("button");
    plain.element.append(other);
    document.body.append(plain.element);
    presses.add(plain);
    expect(() =>
      plain.arrange({ width: 100 }, [
        { element: other, role: "primary", size: { height: 48, width: 50 } },
      ]),
    ).toThrow(RangeError);
  });
});

describe("a projected modal frame", () => {
  it.each(SCALES)(
    "places the kit footer on the frame's grid at $unit units and DPR $dpr",
    (scale) => {
      const { gridRect, project } = archieGrid(scale);
      const frame = createModalFrame(document, { id: "shop", title: "Pet shop" });
      const back = document.createElement("button");
      frame.footer.element.append(back);
      document.body.append(frame.element);
      const context = {
        content: { height: 520, width: 360, x: 0, y: 40 },
        insets: { bottom: 12, side: 8 },
        project,
        variant: "page",
      } as const;
      const {
        footer,
        frame: placed,
        units,
      } = frame.layout(context, {
        body: 300,
        footer: { actions: [{ element: back, role: "primary", size: { height: 48, width: 128 } }] },
        title: { height: 15, inset: 24 },
      });
      // Archie's Back, centred in the padded page above the bottom inset.
      expect(units.footer).toEqual({ height: 48, width: 344, x: 8, y: 500 });
      expect(footer?.group).toEqual(placed.footer);
      expect(footer?.actions[0]).toMatchObject({
        face: gridRect({ height: 48, width: 128, x: 116, y: 500 }),
      });
      expect(frame.footer.element.hasAttribute(ACTION_PROJECTED_ATTRIBUTE)).toBe(true);
      expect(numbers(back, BOX)).toEqual([
        project.x(116) - project.x(8),
        0,
        project.x(244) - project.x(116),
        project.y(548) - project.y(500),
      ]);
    },
  );
});

// Archie's grid for a viewport w wide at dpr, as its probe builds it: the layer at the viewport's
// corner, unit w / 360 CSS px per game pixel, and its art pixel in device px.
function archieViewport(width: number, dpr: number) {
  const scale = { dpr, origin: { x: 0, y: 0 }, unit: width / 360 };
  return { art: Math.max(1, Math.floor(scale.unit * scale.dpr + 1e-9)), ...archieGrid(scale) };
}

describe("a placed list with art pixels, gaps, a one-action row and a press dip", () => {
  it.each([
    { art: 2, dpr: 2, height: 608, width: 360 },
    { art: 3, dpr: 2.625, height: 915, width: 412 },
    { art: 3, dpr: 3, height: 844, width: 390 },
  ])("draws Archie's Settings art at its size at $width x $height @ $dpr", (viewport) => {
    const { art, project } = archieViewport(viewport.width, viewport.dpr);
    expect(art).toBe(viewport.art);
    const { x, y } = project;
    // Settings: rows a separator and its clearance apart, a switch that dips, a volume slider
    // and the Install row, whose sole action's press is the whole row.
    const rows = createFormRows(document, { ...LIST, gap: 17 });
    const sound = createFormRow(document, {
      getAction: () => null,
      getState: () => ({ checked: true, value: "On" }),
      icon: document.createElement("img"),
      label: "Sound",
      pressDip: 1,
      rule,
      switch: true,
    });
    const music = createSlider(document, {
      change: () => undefined,
      getState: () => ({ step: 7, value: "35%" }),
      icon: document.createElement("img"),
      label: "Music",
      layout: { art: ART, gap: 4, height: 56, inset: { left: 2 }, line: 20 },
      slop: 4,
      steps: 20,
    });
    const install = createFormRow(document, {
      action: { role: "secondary", size: { height: 33, width: 145 } },
      getAction: () => null,
      icon: document.createElement("img"),
      label: "Install",
      rule,
    });
    rows.element.append(sound.element, music.element, install.element);
    document.body.append(rows.element);
    const context = { origin: { x: 8, y: 103 }, project, width: 344 };
    const edges = rows.place(context, [sound, music, install]);
    const columns = value(rows.element, "--ui-form-columns");
    const { placed, units } = rows.place({ ...context, artPixel: art }, [sound, music, install]);
    expect(units.rows.map((row) => row.row.y)).toEqual([103, 168, 241]);
    expect(value(rows.element, "--ui-form-rows")).toBe(
      [y(168) - y(103), y(241) - y(168), y(289) - y(241)].map((px) => `${px}px`).join(" "),
    );
    // The columns stay on the projected edges; the icon starts its column.
    expect(value(rows.element, "--ui-form-columns")).toBe(columns);
    expect(placed.rows.map((row) => row.row)).toEqual(edges.placed.rows.map((row) => row.row));
    expect(
      numbers(sound.element, [
        "--ui-form-icon-size",
        "--ui-form-icon-height",
        "--ui-switch-width",
        "--ui-switch-height",
        "--ui-form-switch-end",
        "--ui-form-row-press-dip",
      ]),
    ).toEqual([16 * art, 16 * art, 32 * art, 16 * art, x(344) - (x(312) + 32 * art), art]);
    expect(placed.rows[0]!.switch).toEqual({
      height: 16 * art,
      width: 32 * art,
      x: x(312),
      y: y(119),
    });
    expect(
      numbers(music.element, [
        "--ui-form-icon-size",
        "--ui-slider-thumb-width",
        "--ui-slider-thumb-height",
        "--ui-slider-track-height",
        "--ui-slider-empty-cap-left",
        "--ui-slider-empty-cap-right",
        "--ui-slider-fill-cap-left",
        "--ui-slider-fill-cap-right",
        "--ui-slider-lane-height",
        "--ui-slider-fill-width",
      ]),
    ).toEqual([
      16 * art,
      10 * art,
      16 * art,
      10 * art,
      4 * art,
      4 * art,
      4 * art,
      4 * art,
      y(192 + 16) - y(192),
      // The thumb at step 7 of 20 is 111 along the 326 unit track.
      x(18 + 111 + 10) - x(18),
    ]);
    // Install: the face centred in the row, the odd unit right and below, by projected edges.
    expect(install.element.hasAttribute(FORM_ROW_ACTION_ATTRIBUTE)).toBe(true);
    expect(install.face?.parentElement).toBe(install.element);
    expect(
      numbers(install.element, [
        "--ui-form-action-left",
        "--ui-form-action-top",
        "--ui-form-action-width",
        "--ui-form-action-height",
      ]),
    ).toEqual([x(107) - x(8), y(248) - y(241), x(252) - x(107), y(281) - y(248)]);
    expect(placed.rows[2]!.row).toEqual({
      height: y(289) - y(241),
      width: x(352) - x(8),
      x: x(8),
      y: y(241),
    });
    if (viewport.width === 390) {
      // Archie's numbers at 390x844@3: 30x48 thumb, 12/12 caps, 96x48 switch, 48x48 icon.
      expect(
        numbers(music.element, ["--ui-slider-thumb-width", "--ui-slider-thumb-height"]),
      ).toEqual([30, 48]);
      expect(
        numbers(music.element, ["--ui-slider-empty-cap-left", "--ui-slider-empty-cap-right"]),
      ).toEqual([12, 12]);
      expect(numbers(sound.element, ["--ui-switch-width", "--ui-switch-height"])).toEqual([96, 48]);
      expect(numbers(sound.element, ["--ui-form-icon-size", "--ui-form-icon-height"])).toEqual([
        48, 48,
      ]);
    }
  });

  it("puts Cheats' adjacent switches 0 apart and keeps the gap of a hidden row's successor", () => {
    const { project } = archieViewport(390, 3);
    const rows = createFormRows(document, LIST);
    const make = (label: string) =>
      createFormRow(document, { getAction: () => null, label, rule, switch: true });
    const [god, ghost, fast, reset] = ["Invincible", "Ghost", "Fast", "Reset"].map(make) as [
      ReturnType<typeof make>,
      ReturnType<typeof make>,
      ReturnType<typeof make>,
      ReturnType<typeof make>,
    ];
    rows.element.append(god.element, ghost.element, fast.element, reset.element);
    document.body.append(rows.element);
    ghost.element.hidden = true;
    const { units } = rows.place({ origin: { x: 8, y: 103 }, project, width: 344 }, [
      god,
      { element: ghost.element, gap: 0 },
      { element: fast.element, gap: 0 },
      reset,
    ]);
    expect(units.rows.map((row) => row.row.y)).toEqual([103, 151, 207]);
    const pitch = (from: number, to: number) => `${project.y(to) - project.y(from)}px`;
    expect(value(rows.element, "--ui-form-rows")).toBe(
      [pitch(103, 151), pitch(151, 207), pitch(207, 255)].join(" "),
    );
    expect(() =>
      rows.place({ project, width: 344 }, [god, { element: fast.element, gap: 0.5 }]),
    ).toThrow(RangeError);
  });
});

describe("a placed list with per-row heights", () => {
  it("places Archie's 82 and 48 tall Settings rows in one list at 390x844@3", () => {
    const { art, project } = archieViewport(390, 3);
    const { x, y } = project;
    const rows = createFormRows(document, {
      align: "start",
      columnGap: 4,
      gap: 17,
      height: 82,
      icon: { offset: 9, size: 16, slot: 16 },
      padding: { bottom: 0, left: 6, right: 8, top: 0 },
      switch: { height: 16, width: 32 },
      value: { gap: 8, offset: 9, state: "center", track: 46 },
    });
    const toggle = (label: string) =>
      createFormRow(document, {
        getAction: () => null,
        getState: () => ({ checked: true, value: "On" }),
        icon: document.createElement("img"),
        label,
        pressDip: 1,
        rule,
        switch: true,
      });
    const sound = toggle("Sound");
    const fps = toggle("FPS");
    const music = createSlider(document, {
      change: () => undefined,
      getState: () => ({ step: 7, value: "35%" }),
      icon: document.createElement("img"),
      label: "Music",
      layout: { art: ART, height: 56, inset: { left: 20, right: 0 }, line: 27 },
      slop: 4,
      steps: 20,
    });
    const install = createFormRow(document, {
      action: { role: "secondary", size: { height: 33, width: 145 } },
      getAction: () => null,
      icon: document.createElement("img"),
      label: "Install",
      rule,
    });
    rows.element.append(sound.element, music.element, install.element, fps.element);
    document.body.append(rows.element);
    const context = { artPixel: art, origin: { x: 8, y: 103 }, project, width: 330 };
    const { units } = rows.place(context, [
      sound,
      music,
      { element: install.element, height: 48 },
      { element: fps.element, height: 48 },
    ]);
    expect(units.rows.map(({ row }) => [row.y, row.height])).toEqual([
      [103, 82],
      [202, 56],
      [275, 48],
      [340, 48],
    ]);
    const pitches = [y(202) - y(103), y(275) - y(202), y(340) - y(275), y(388) - y(340)];
    expect(value(rows.element, "--ui-form-rows")).toBe(pitches.map((px) => `${px}px`).join(" "));
    expect(numbers(sound.element, ["--ui-form-row-height"])).toEqual([y(185) - y(103)]);
    expect(
      numbers(fps.element, [
        "--ui-form-row-height",
        "--ui-form-icon-size",
        "--ui-form-icon-offset",
        "--ui-switch-width",
        "--ui-switch-height",
        "--ui-form-row-press-dip",
      ]),
    ).toEqual([y(388) - y(340), 48, y(349) - y(340), 96, 48, 3]);
    // Install's face centred in its whole 330x48 row, from the row's corner: 92 in and 7 down.
    expect(
      numbers(install.element, [
        "--ui-form-row-height",
        "--ui-form-action-left",
        "--ui-form-action-top",
      ]),
    ).toEqual([y(323) - y(275), x(100) - x(8), y(282) - y(275)]);
    // Without its own height a row takes the list's.
    rows.place(context, [sound, music, install, { element: fps.element, height: 48 }]);
    const fitted = numbers(install.element, ["--ui-form-row-height", "--ui-form-action-top"]);
    expect(fitted).toEqual([y(357) - y(275), y(299) - y(275)]);
    expect(() => rows.place(context, [{ element: sound.element, height: 81.5 }])).toThrow(
      RangeError,
    );
    rows.element.remove();
  });
});
