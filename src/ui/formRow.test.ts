import { describe, expect, it } from "vitest";

import { ACTION_GAPS } from "./actionGroup.ts";
import { FORM_ROW_ATTRIBUTES, formRowPresentation } from "./formRow.ts";

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
