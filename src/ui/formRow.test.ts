import { describe, expect, it } from "vitest";

import type { Rect } from "../rect.ts";
import { ACTION_GAPS, type ActionProjection } from "./actionGroup.ts";
import {
  FORM_ROW_ATTRIBUTES,
  type FormRowLayout,
  formRowPresentation,
  type FormRowsContext,
  formRowsGeometry,
} from "./formRow.ts";

describe("formRowPresentation", () => {
  it("writes the game's lengths and the stacked action gap between rows", () => {
    // Archie: a 16 icon 3 above the label's capitals, its 32x16 switch level with the icon and
    // the state word under it, its ink's right edge on the switch's.
    const { attributes, properties } = formRowPresentation({
      align: "start",
      columnGap: 4,
      height: 48,
      icon: { offset: 9, size: 16, slot: 16 },
      padding: { bottom: 0, left: 6, right: 8, top: 0 },
      switch: { height: 16, width: 32 },
      value: { bearing: 2, gap: 8, offset: 9, state: "end" },
    });
    expect(attributes).toEqual({
      [FORM_ROW_ATTRIBUTES.align]: "start",
      [FORM_ROW_ATTRIBUTES.icons]: "slot",
      [FORM_ROW_ATTRIBUTES.state]: "end",
    });
    expect(properties).toMatchObject({
      "--ui-form-icon-offset": 9,
      "--ui-form-icon-size": 16,
      "--ui-form-icon-slot": 16,
      "--ui-form-row-column-gap": 4,
      "--ui-form-row-height": 48,
      "--ui-form-row-padding-left": 6,
      "--ui-form-row-padding-right": 8,
      "--ui-form-rows-gap": ACTION_GAPS.standard.stack,
      "--ui-form-state-bearing": 2,
      "--ui-form-value-gap": 8,
      "--ui-form-value-offset": 9,
      "--ui-switch-height": 16,
      "--ui-switch-width": 32,
    });
    expect(properties).not.toHaveProperty("--ui-form-value-track");
  });

  it("centres by default, drops the icon column without icons and fixes a named track", () => {
    const { attributes, properties } = formRowPresentation({
      columnGap: 8,
      height: 48,
      value: { track: 48 },
    });
    expect(attributes[FORM_ROW_ATTRIBUTES.align]).toBe("center");
    expect(attributes[FORM_ROW_ATTRIBUTES.icons]).toBe("none");
    expect(attributes[FORM_ROW_ATTRIBUTES.state]).toBe("center");
    expect(properties).not.toHaveProperty("--ui-form-icon-slot");
    expect(properties["--ui-form-value-track"]).toBe("calc(var(--ui-unit, 1) * 48 * 1px)");
  });

  it("refuses lengths that are not whole units and unknown placements", () => {
    const base = { columnGap: 8, height: 48 };
    expect(() => formRowPresentation({ ...base, height: 47.5 })).toThrow(RangeError);
    expect(() => formRowPresentation({ ...base, columnGap: -1 })).toThrow(RangeError);
    expect(() => formRowPresentation({ ...base, icon: { size: 20, slot: 16 } })).toThrow(
      RangeError,
    );
    expect(() => formRowPresentation({ ...base, switch: { height: 16, width: 0 } })).toThrow(
      RangeError,
    );
    expect(() =>
      formRowPresentation({ ...base, value: { state: "start" as unknown as "end" } }),
    ).toThrow(RangeError);
    expect(() => formRowPresentation({ ...base, align: "end" as unknown as "start" })).toThrow(
      RangeError,
    );
  });
});

// A settings list: a switch row, a value row and a slider row 56 tall whose 20 unit first line
// has its lane 4 under it, inset 2, its art 16 tall.
const LIST: FormRowLayout = {
  columnGap: 4,
  height: 48,
  icon: { size: 16, slot: 24 },
  padding: { bottom: 0, left: 8, right: 8, top: 0 },
  switch: { height: 16, width: 32 },
  value: { bearing: 1, gap: 4, state: "end", track: 40 },
};
const ROWS: FormRowsContext = {
  origin: { x: 8, y: 103 },
  rows: [
    { switch: true },
    {},
    { height: 56, lane: { gap: 4, height: 16, inset: { left: 2 }, line: 20 } },
  ],
  width: 344,
};

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
      height: Math.max(art, project.y(rect.y + rect.height) - top),
      width: Math.max(art, project.x(rect.x + rect.width) - left),
      x: left,
      y: top,
    };
  };
  return { gridRect, project };
}

describe("formRowsGeometry", () => {
  it("places each part as formRow.css lays it out, the odd unit right and below", () => {
    const { list, rows } = formRowsGeometry(LIST, ROWS);
    expect(list).toEqual({ height: 48 + 8 + 48 + 8 + 56, width: 344, x: 8, y: 103 });
    const [toggle, plain, slider] = rows;
    expect(toggle).toEqual({
      content: { height: 48, width: 328, x: 16, y: 103 },
      icon: { height: 16, width: 16, x: 20, y: 119 },
      label: { height: 48, width: 256, x: 44, y: 103 },
      line: { height: 48, width: 328, x: 16, y: 103 },
      row: { height: 48, width: 344, x: 8, y: 103 },
      slot: { height: 48, width: 24, x: 16, y: 103 },
      stack: { height: 16, width: 40, x: 304, y: 119 },
      switch: { height: 16, width: 32, x: 312, y: 119 },
      value: { height: 48, width: 40, x: 304, y: 103 },
    });
    expect(plain?.row).toEqual({
      height: 48,
      width: 344,
      x: 8,
      y: 103 + 48 + ACTION_GAPS.standard.stack,
    });
    expect(plain?.switch).toBeUndefined();
    expect(plain?.stack).toEqual({ height: 0, width: 40, x: 304, y: 159 + 24 });
    expect(slider?.row).toEqual({ height: 56, width: 344, x: 8, y: 215 });
    expect(slider?.line).toEqual({ height: 20, width: 328, x: 16, y: 215 });
    expect(slider?.icon).toEqual({ height: 16, width: 16, x: 20, y: 217 });
    expect(slider?.lane).toEqual({ height: 16, width: 326, x: 18, y: 239 });
  });

  it("aligns to the start at the offsets and centres a switch with the odd unit right", () => {
    const [row] = formRowsGeometry(
      {
        ...LIST,
        align: "start",
        icon: { offset: 3, size: 15, slot: 24 },
        padding: { bottom: 2, left: 8, right: 8, top: 5 },
        value: { gap: 4, height: 30, offset: 6, track: 41 },
      },
      { ...ROWS, rows: [{ switch: true }] },
    ).rows;
    expect(row?.content).toEqual({ height: 41, width: 328, x: 16, y: 108 });
    expect(row?.icon).toEqual({ height: 15, width: 15, x: 20, y: 111 });
    expect(row?.stack).toEqual({ height: 30, width: 41, x: 303, y: 114 });
    expect(row?.switch).toEqual({ height: 16, width: 32, x: 307, y: 114 });
  });

  it("refuses a list it cannot place", () => {
    const value = { bearing: 1, gap: 4, state: "end" } as const;
    expect(() => formRowsGeometry({ ...LIST, value }, ROWS)).toThrow(RangeError);
    expect(() => formRowsGeometry(LIST, { ...ROWS, width: 60 })).toThrow(RangeError);
    expect(() => formRowsGeometry(LIST, { ...ROWS, rows: [{ height: 47.5 }] })).toThrow(RangeError);
    expect(() =>
      formRowsGeometry({ ...LIST, padding: { bottom: 30, left: 0, right: 0, top: 30 } }, ROWS),
    ).toThrow(RangeError);
    const noSwitch = { columnGap: 4, height: 48, value: { track: 40 } };
    expect(() => formRowsGeometry(noSwitch, ROWS)).toThrow(RangeError);
    expect(() =>
      formRowsGeometry(LIST, {
        ...ROWS,
        rows: [{ lane: { height: 16, inset: { left: 400 }, line: 20 } }],
      }),
    ).toThrow(RangeError);
    expect(() =>
      formRowsGeometry(LIST, { ...ROWS, project: { x: (edge) => edge + 0.5, y: (edge) => edge } }),
    ).toThrow(RangeError);
  });

  it.each([
    { dpr: 1, origin: { x: 0, y: 0 }, unit: 1 },
    { dpr: 2, origin: { x: 10.25, y: 3.5 }, unit: 1.5 },
    { dpr: 3, origin: { x: 0, y: 17.4 }, unit: 2.1 },
    { dpr: 2.625, origin: { x: 41.3, y: 0.7 }, unit: 1.17 },
  ])("lands every part on Archie's device grid at $unit units and DPR $dpr", (scale) => {
    const { gridRect, project } = archieGrid(scale);
    const units = formRowsGeometry(LIST, ROWS);
    const placed = formRowsGeometry(LIST, { ...ROWS, project });
    expect(placed.list).toEqual(gridRect(units.list));
    placed.rows.forEach((row, i) => {
      for (const [part, rect] of Object.entries(row)) {
        const unit = units.rows[i]![part as keyof typeof row]! as Rect;
        expect(rect).toEqual(unit.height === 0 ? { ...gridRect(unit), height: 0 } : gridRect(unit));
      }
    });
  });
});

// Archie's device grid for a viewport w x h at dpr, as its probe builds it: the layer at the
// viewport's corner, unit w / 360 CSS px per game pixel.
function archieViewport(width: number, dpr: number) {
  const scale = { dpr, origin: { x: 0, y: 0 }, unit: width / 360 };
  return { art: Math.max(1, Math.floor(scale.unit * scale.dpr + 1e-9)), ...archieGrid(scale) };
}
const VIEWPORTS = [
  { dpr: 2, height: 608, width: 360 },
  { dpr: 2.625, height: 915, width: 412 },
  { dpr: 3, height: 844, width: 390 },
];

describe("formRowsGeometry gaps, one-action rows, press dips and art", () => {
  it("spaces rows by the list's gap and each row's own, none above the first", () => {
    // Archie's Settings: a separator and its clearance between rows, 17 in all.
    const settings = formRowsGeometry({ ...LIST, gap: 17 }, ROWS);
    expect(settings.rows.map((row) => row.row.y)).toEqual([103, 168, 233]);
    expect(settings.list.height).toBe(48 + 17 + 48 + 17 + 56);
    // Archie's Cheats: switches touch, other rows the stacked gap apart.
    const cheats = formRowsGeometry(LIST, {
      ...ROWS,
      rows: [{ gap: 30, switch: true }, { gap: 0, switch: true }, {}],
    });
    expect(cheats.rows.map((row) => row.row.y)).toEqual([103, 151, 207]);
    expect(formRowPresentation({ ...LIST, gap: 17 }).properties["--ui-form-rows-gap"]).toBe(17);
    expect(() => formRowPresentation({ ...LIST, gap: 1.5 })).toThrow(RangeError);
    expect(() => formRowsGeometry(LIST, { ...ROWS, rows: [{ gap: -1 }] })).toThrow(RangeError);
  });

  it("centres a one-action row's face in the whole row, the odd unit right and below", () => {
    // Archie's Install: a 48 row whose sole action is a 145x33 face.
    const { rows } = formRowsGeometry(LIST, {
      ...ROWS,
      rows: [{ action: { height: 33, width: 145 } }],
    });
    expect(rows[0]!.face).toEqual({ height: 33, width: 145, x: 8 + 99, y: 103 + 7 });
    expect(rows[0]!.row).toEqual({ height: 48, width: 344, x: 8, y: 103 });
    // Padding does not move the face: centred in the 344x48 row, not the 330x40 content.
    const padded = formRowsGeometry(
      { ...LIST, padding: { bottom: 3, left: 6, right: 8, top: 5 } },
      {
        ...ROWS,
        rows: [{ action: { height: 33, width: 145 } }, { action: { height: 44, width: 344 } }],
      },
    ).rows;
    expect(padded[0]!.content).toEqual({ height: 40, width: 330, x: 14, y: 108 });
    expect(padded[0]!.face).toEqual({ height: 33, width: 145, x: 8 + 99, y: 103 + 7 });
    expect(padded[1]!.face).toEqual({ height: 44, width: 344, x: 8, y: 159 + 2 });
    expect(() =>
      formRowsGeometry(LIST, { ...ROWS, rows: [{ action: { height: 49, width: 10 } }] }),
    ).toThrow(RangeError);
    expect(() =>
      formRowsGeometry(LIST, { ...ROWS, rows: [{ action: { height: 10, width: 345 } }] }),
    ).toThrow(RangeError);
  });

  it("dips a row by its press dip, projected from its top or in whole art pixels", () => {
    const { art, project } = archieViewport(390, 3);
    const context = { ...ROWS, project, rows: [{ pressDip: 1, switch: true }, {}] };
    const edges = formRowsGeometry(LIST, context).rows;
    expect(edges[0]!.pressDip).toBe(project.y(104) - project.y(103));
    expect(edges[1]!.pressDip).toBeUndefined();
    expect(formRowsGeometry(LIST, { ...context, artPixel: art }).rows[0]!.pressDip).toBe(3);
    expect(() => formRowsGeometry(LIST, { ...ROWS, rows: [{ pressDip: 0.5 }] })).toThrow(
      RangeError,
    );
  });

  it.each(VIEWPORTS)(
    "keeps the icon and switch at their art size at $width x $height @ $dpr",
    ({ dpr, width }) => {
      const { art, project } = archieViewport(width, dpr);
      const units = formRowsGeometry(LIST, ROWS).rows[0]!;
      const placed = formRowsGeometry(LIST, { ...ROWS, artPixel: art, project }).rows[0]!;
      const corner = (rect: Rect) => ({ x: project.x(rect.x), y: project.y(rect.y) });
      expect(placed.icon).toEqual({ ...corner(units.icon!), height: 16 * art, width: 16 * art });
      expect(placed.switch).toEqual({
        ...corner(units.switch!),
        height: 16 * art,
        width: 32 * art,
      });
      // Boxes stay on their projected edges.
      const edges = formRowsGeometry(LIST, { ...ROWS, project }).rows[0]!;
      expect(placed.row).toEqual(edges.row);
      expect(placed.value).toEqual(edges.value);
      expect(() => formRowsGeometry(LIST, { ...ROWS, artPixel: 0, project })).toThrow(RangeError);
    },
  );

  it("draws a 16x16 icon 48x48 and a 32x16 switch 96x48 at 390x844@3, unstretched", () => {
    const { art, project } = archieViewport(390, 3);
    expect(art).toBe(3);
    // Six switch rows 17 apart, as on Archie's Settings page; snapping each edge stretches them.
    const rows = Array.from({ length: 6 }, () => ({ switch: true }));
    const context = { ...ROWS, rows };
    const locked = formRowsGeometry({ ...LIST, gap: 17 }, { ...context, artPixel: art, project });
    const snapped = formRowsGeometry({ ...LIST, gap: 17 }, { ...context, project });
    for (const row of locked.rows) {
      expect([row.icon!.width, row.icon!.height]).toEqual([48, 48]);
      expect([row.switch!.width, row.switch!.height]).toEqual([96, 48]);
    }
    const sizes = snapped.rows.flatMap((row) => [
      `${row.icon!.width}x${row.icon!.height}`,
      `${row.switch!.width}x${row.switch!.height}`,
    ]);
    expect(sizes.some((size) => size !== "48x48" && size !== "96x48")).toBe(true);
  });
});

// Archie's Settings layout: 16 icons 9 down beside their labels, 32x16 switches centred over their
// state words in a 46 track, rows a separator and its clearance (17) apart, 82 tall by default.
const ARCHIE_SETTINGS: FormRowLayout = {
  align: "start",
  columnGap: 4,
  gap: 17,
  height: 82,
  icon: { offset: 9, size: 16, slot: 16 },
  padding: { bottom: 0, left: 6, right: 8, top: 0 },
  switch: { height: 16, width: 32 },
  value: { gap: 8, offset: 9, state: "center", track: 46 },
};
const ARCHIE_SWITCH = { pressDip: 1, switch: true } as const;
const ARCHIE_SLIDER = { height: 56, lane: { height: 16, inset: { left: 20, right: 0 }, line: 27 } };
const ARCHIE_INSTALL = { action: { height: 33, width: 145 }, height: 48 };

describe("formRowsGeometry per-row heights", () => {
  it("places Archie's Settings as one list at 390x844@3, as its three lists did", () => {
    const { art, project } = archieViewport(390, 3);
    expect(art).toBe(3);
    const context = { artPixel: art, project, width: 330 };
    // Sound, Music, Effects, Motion, Install and FPS: 82 and 48 tall rows in one list.
    const one = formRowsGeometry(ARCHIE_SETTINGS, {
      ...context,
      origin: { x: 8, y: 103 },
      rows: [
        ARCHIE_SWITCH,
        ARCHIE_SLIDER,
        ARCHIE_SLIDER,
        ARCHIE_SWITCH,
        ARCHIE_INSTALL,
        { ...ARCHIE_SWITCH, height: 48 },
      ],
    });
    const units = formRowsGeometry(ARCHIE_SETTINGS, {
      origin: { x: 8, y: 103 },
      rows: [
        ARCHIE_SWITCH,
        ARCHIE_SLIDER,
        ARCHIE_SLIDER,
        ARCHIE_SWITCH,
        ARCHIE_INSTALL,
        { ...ARCHIE_SWITCH, height: 48 },
      ],
      width: 330,
    });
    expect(units.rows.map(({ row }) => [row.y, row.height])).toEqual([
      [103, 82],
      [202, 56],
      [275, 56],
      [348, 82],
      [447, 48],
      [512, 48],
    ]);
    expect(units.list).toEqual({ height: 457, width: 330, x: 8, y: 103 });
    // Before per-row heights: [Sound, Music, Effects, Motion] at 82, Install in an unpadded list
    // and FPS at 48, each list at its first row's corner.
    const three = [
      formRowsGeometry(ARCHIE_SETTINGS, {
        ...context,
        origin: { x: 8, y: 103 },
        rows: [ARCHIE_SWITCH, ARCHIE_SLIDER, ARCHIE_SLIDER, ARCHIE_SWITCH],
      }),
      formRowsGeometry(
        { ...ARCHIE_SETTINGS, height: 48, padding: { bottom: 0, left: 0, right: 0, top: 0 } },
        { ...context, origin: { x: 8, y: 447 }, rows: [{ action: ARCHIE_INSTALL.action }] },
      ),
      formRowsGeometry(
        { ...ARCHIE_SETTINGS, height: 48 },
        { ...context, origin: { x: 8, y: 512 }, rows: [ARCHIE_SWITCH] },
      ),
    ];
    expect(one.rows[4]!.face).toEqual(three[1]!.rows[0]!.face);
    expect(one.rows[4]!.row).toEqual(three[1]!.rows[0]!.row);
    expect([...one.rows.slice(0, 4), one.rows[5]]).toEqual([...three[0]!.rows, ...three[2]!.rows]);
    // Tracks on projected edges; art at its size from its corner; dips in art pixels.
    expect(one.list).toEqual({
      height: project.y(560) - project.y(103),
      width: project.x(338) - project.x(8),
      x: project.x(8),
      y: project.y(103),
    });
    one.rows.forEach((placed, i) => {
      const { height, y } = units.rows[i]!.row;
      expect(placed.row.height).toBe(project.y(y + height) - project.y(y));
    });
    for (const i of [0, 3, 5]) {
      const placed = one.rows[i]!;
      const top = units.rows[i]!.row.y;
      expect(placed.icon).toEqual({
        height: 48,
        width: 48,
        x: project.x(14),
        y: project.y(top + 9),
      });
      expect(placed.switch).toEqual({
        height: 48,
        width: 96,
        x: project.x(8 + 330 - 8 - 46 + 7),
        y: project.y(top + 9),
      });
      expect(placed.pressDip).toBe(3);
    }
    // Install's face centred in its whole 330x48 row, 92 in and 7 down, not in the padded content
    // (85 in from the content's left, 91 from the row's).
    expect(units.rows[4]!.face).toEqual({ height: 33, width: 145, x: 8 + 92, y: 447 + 7 });
    expect(one.rows[4]!.face).toEqual({
      height: project.y(487) - project.y(454),
      width: project.x(245) - project.x(100),
      x: project.x(100),
      y: project.y(454),
    });
  });

  it("refuses a row height that is not a whole unit or too short for the padding", () => {
    const padded = { ...ARCHIE_SETTINGS, padding: { bottom: 3, left: 6, right: 8, top: 2 } };
    expect(() => formRowsGeometry(padded, { rows: [{ height: 5 }], width: 330 })).not.toThrow();
    expect(() => formRowsGeometry(padded, { rows: [{ height: 4.5 }], width: 330 })).toThrow(
      RangeError,
    );
    expect(() =>
      formRowsGeometry(padded, { rows: [{ height: 82 }, { height: 4 }], width: 330 }),
    ).toThrow(RangeError);
  });
});
