// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import {
  createViewUnits,
  fromEdge,
  readUnit,
  slice,
  sliceProperty,
  units,
  viewProperties,
} from "./viewUnits.ts";

const FIT = { unit: 1.5, view: { height: 270, width: 540, x: 30, y: 0 } };

describe("viewProperties", () => {
  it("gives the unit, the view's box in CSS px and whole-pixel slice edges", () => {
    expect(viewProperties([1, 3], FIT)).toEqual({
      "--ui-slice-1": "2px",
      "--ui-slice-3": "5px",
      "--ui-unit": "1.5",
      "--ui-view-height": "270px",
      "--ui-view-left": "30px",
      "--ui-view-top": "0px",
      "--ui-view-width": "540px",
    });
  });

  it("keeps every slice edge at least 1 px", () => {
    expect(viewProperties([1], { ...FIT, unit: 0.25 })["--ui-slice-1"]).toBe("1px");
  });

  it.each([1.5, -1])("refuses the slice edge %s", (edge) => {
    expect(() => sliceProperty(edge)).toThrow(RangeError);
  });
});

describe("createViewUnits", () => {
  it("writes the properties on the layer only when they change", () => {
    const layer = document.createElement("div");
    const update = createViewUnits([3], layer);
    expect([update(FIT), update(FIT), update({ ...FIT, unit: 2 })]).toEqual([true, false, true]);
    expect(layer.style.getPropertyValue("--ui-slice-3")).toBe("6px");
  });

  it.each([0, Number.NaN])("ignores a fit with unit %s", (unit) => {
    const layer = document.createElement("div");
    expect(createViewUnits([], layer)({ ...FIT, unit })).toBe(false);
    expect(layer.style.getPropertyValue("--ui-unit")).toBe("");
  });

  it("reads back the unit in effect, 1 before it is set", () => {
    const layer = document.createElement("div");
    document.body.append(layer);
    expect(readUnit(layer)).toBe(1);
    createViewUnits([], layer)(FIT);
    expect(readUnit(layer)).toBe(1.5);
    layer.remove();
  });
});

describe("length helpers", () => {
  it.each([
    [units(3), "calc(var(--ui-unit) * 3px)"],
    [units(0), "0px"],
    [fromEdge("--hud-edge"), "calc(var(--ui-unit) * var(--hud-edge) * 1px)"],
    [fromEdge("--hud-edge", 4), "calc(var(--ui-unit) * (var(--hud-edge) + 4) * 1px)"],
    [fromEdge("--hud-edge", -4), "calc(var(--ui-unit) * (var(--hud-edge) - 4) * 1px)"],
    [slice(3), "var(--ui-slice-3)"],
  ])("writes %s", (actual, expected) => {
    expect(actual).toBe(expected);
  });
});
