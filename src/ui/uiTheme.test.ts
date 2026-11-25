import { describe, expect, it } from "vitest";

import {
  colourProperties,
  colourProperty,
  TEXT_ROLES,
  textRoleClass,
  textRoleProperties,
  UI_COLOUR_ROLES,
  type UiColourRole,
} from "./uiTheme.ts";

describe("colour slots", () => {
  it("names each role's custom property", () => {
    expect(colourProperty("cardFace")).toBe("--ui-colour-card-face");
    expect(colourProperty("buttonPressedFace")).toBe("--ui-colour-button-pressed-face");
    expect(new Set(UI_COLOUR_ROLES.map(colourProperty)).size).toBe(UI_COLOUR_ROLES.length);
    expect(() => colourProperty("ink" as UiColourRole)).toThrow(RangeError);
  });

  it("writes numbers and hex strings as CSS colours", () => {
    expect(
      colourProperties({ accent: "#FEAE34", buttonFace: 0x3b3850, frame: "#101926b3" }),
    ).toEqual({
      "--ui-colour-accent": "#feae34",
      "--ui-colour-button-face": "#3b3850",
      "--ui-colour-frame": "#101926b3",
    });
    expect(colourProperties({ cardFace: 0 })).toEqual({ "--ui-colour-card-face": "#000000" });
  });

  it.each<[string, Record<string, unknown>]>([
    ["an unknown role", { ink: 0 }],
    ["a short hex", { accent: "#fff" }],
    ["a named colour", { accent: "red" }],
    ["a CSS expression", { accent: "#123456; color: red" }],
    ["a number out of range", { accent: 0x1000000 }],
    ["a fractional number", { accent: 1.5 }],
  ])("refuses %s", (_name, colours) => {
    expect(() => colourProperties(colours as never)).toThrow(RangeError);
  });
});

describe("text roles", () => {
  it("names each role's class", () => {
    expect(TEXT_ROLES.map(textRoleClass)).toEqual([
      "ui-text-body",
      "ui-text-heading",
      "ui-text-label",
      "ui-text-supporting",
    ]);
  });

  it("writes size, line height and weight in base px", () => {
    expect(textRoleProperties({ heading: { lineHeight: 28, size: 22, weight: 700 } })).toEqual({
      "--ui-text-heading-line-height": 28,
      "--ui-text-heading-size": 22,
      "--ui-text-heading-weight": 700,
    });
  });

  it.each([
    { lineHeight: 0, size: 12, weight: 400 },
    { lineHeight: 16, size: Number.NaN, weight: 400 },
    { lineHeight: 16, size: 12, weight: 0 },
    { lineHeight: 16, size: 12, weight: 450.5 },
  ])("refuses %o", (style) => {
    expect(() => textRoleProperties({ body: style })).toThrow(RangeError);
  });
});
