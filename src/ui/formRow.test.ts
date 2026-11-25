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
        const unit = units.rows[i]![part as keyof typeof row]!;
        expect(rect).toEqual(unit.height === 0 ? { ...gridRect(unit), height: 0 } : gridRect(unit));
      }
    });
  });
});
