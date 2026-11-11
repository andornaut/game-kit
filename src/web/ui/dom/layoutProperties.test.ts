// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { writeLayoutProperties } from "./layoutProperties.ts";

describe("writeLayoutProperties", () => {
  it("writes numbers unitless and strings as given, and reports the change", () => {
    const element = document.createElement("div");
    expect(
      writeLayoutProperties({ "--hud-edge": 12, "--ui-refusal-colour": "#e4574e" }, element),
    ).toBe(true);
    expect([
      element.style.getPropertyValue("--hud-edge"),
      element.style.getPropertyValue("--ui-refusal-colour"),
    ]).toEqual(["12", "#e4574e"]);
  });

  it("reports no change when every value is already there", () => {
    const element = document.createElement("div");
    writeLayoutProperties({ "--hud-edge": 12 }, element);
    expect(writeLayoutProperties({ "--hud-edge": 12 }, element)).toBe(false);
    expect(writeLayoutProperties({ "--hud-edge": 13 }, element)).toBe(true);
  });

  it.each([
    ["a name that is not a custom property", { "hud-edge": 1 }],
    ["a number that is not finite", { "--hud-edge": Number.NaN, "--ok": 1 }],
  ])("throws on %s before writing any", (_, values) => {
    const element = document.createElement("div");
    expect(() => writeLayoutProperties(values, element)).toThrow();
    expect(element.style.getPropertyValue("--ok")).toBe("");
  });
});
