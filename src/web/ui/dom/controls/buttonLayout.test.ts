// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import type { ButtonPlacement, ButtonRole } from "../../../../ui/actions/buttonLayout.ts";
import {
  setButtonFrame,
  setButtonRole,
  setButtonSize,
  setControlPlacement,
} from "./buttonLayout.ts";

const TOKENS = {
  compact: { height: 24, minWidth: 40, paddingX: 5, paddingY: 3 },
  standard: { height: 40, minWidth: 80, paddingX: 12, paddingY: 6 },
};

describe("setButtonSize", () => {
  it("writes the selected shared metrics as unitless properties on a group", () => {
    const group = document.createElement("div");
    expect(setButtonSize(TOKENS, "compact", group)).toBe(true);
    expect(group.getAttribute("data-ui-size")).toBe("compact");
    expect([
      group.style.getPropertyValue("--ui-button-height"),
      group.style.getPropertyValue("--ui-button-min-width"),
      group.style.getPropertyValue("--ui-button-padding-x"),
      group.style.getPropertyValue("--ui-button-padding-y"),
    ]).toEqual(["24", "40", "5", "3"]);
    expect(setButtonSize(TOKENS, "compact", group)).toBe(false);
    expect(setButtonSize(TOKENS, "standard", group)).toBe(true);
  });

  it("rejects unknown or invalid tokens before changing properties or the name", () => {
    const group = document.createElement("div");
    setButtonSize(TOKENS, "standard", group);
    const before = group.outerHTML;
    expect(() => setButtonSize(TOKENS, "missing", group)).toThrow(RangeError);
    expect(() =>
      setButtonSize({ broken: { ...TOKENS.compact, paddingY: -1 } }, "broken", group),
    ).toThrow(RangeError);
    expect(group.outerHTML).toBe(before);
  });

  it("shares the measured wrapped group minimum including its asymmetric face insets", () => {
    const group = document.createElement("div");
    const context = {
      faceInsets: { bottom: 7.5, left: 4.5, right: 3.5, top: 2.5 },
      labels: [
        { height: 20, width: 20 },
        { height: 100, width: 70 },
      ],
      size: "standard",
    };
    expect(setButtonSize(TOKENS, context, group)).toBe(true);
    expect(group.style.getPropertyValue("--ui-button-height")).toBe("122");
    expect(group.style.getPropertyValue("--ui-button-min-width")).toBe("102");
    expect(group.getAttribute("data-ui-size")).toBe("standard");
    expect(setButtonSize(TOKENS, context, group)).toBe(false);
  });

  it("rejects invalid measurements without partially updating the group", () => {
    const group = document.createElement("div");
    setButtonSize(TOKENS, "standard", group);
    const before = group.outerHTML;
    expect(() =>
      setButtonSize(TOKENS, { labels: [{ height: NaN, width: 10 }], size: "compact" }, group),
    ).toThrow(RangeError);
    expect(group.outerHTML).toBe(before);
  });
});

describe("setButtonFrame", () => {
  const faceInsets = { bottom: 7, left: 4.5, right: 3, top: 2.5 };

  it("writes logical insets and already-rounded CSS border lengths without rescaling", () => {
    const button = document.createElement("button");
    const frame = { borderWidths: { bottom: 8, left: 6, right: 5, top: 3 }, faceInsets };
    expect(setButtonFrame(frame, button)).toBe(true);
    for (const side of ["top", "right", "bottom", "left"] as const) {
      expect(button.style.getPropertyValue(`--ui-button-face-${side}`)).toBe(
        String(faceInsets[side]),
      );
      expect(button.style.getPropertyValue(`--ui-button-border-${side}`)).toBe(
        `${frame.borderWidths[side]}px`,
      );
    }
    expect(setButtonFrame(frame, button)).toBe(false);
  });

  it("defaults borders to zero and clears earlier compensation on reapplication", () => {
    const group = document.createElement("div");
    setButtonFrame({ borderWidths: faceInsets, faceInsets }, group);
    expect(setButtonFrame({ faceInsets }, group)).toBe(true);
    for (const side of ["top", "right", "bottom", "left"] as const) {
      expect(group.style.getPropertyValue(`--ui-button-border-${side}`)).toBe("0px");
    }
    expect(setButtonFrame({ faceInsets }, group)).toBe(false);
  });

  it("preserves native frame, pressed shift, content and semantics", () => {
    const button = document.createElement("button");
    button.style.borderWidth = "3px 4px 7px 5px";
    button.style.borderImageSource = 'url("frame.png")';
    button.style.borderImageSlice = "3 4 7 5 fill";
    button.style.transform = "translateY(2px)";
    button.textContent = "Continue";
    const before = [
      button.style.borderWidth,
      button.style.borderImageSource,
      button.style.borderImageSlice,
      button.style.transform,
    ];
    setButtonFrame({ faceInsets }, button);
    expect([
      button.style.borderWidth,
      button.style.borderImageSource,
      button.style.borderImageSlice,
      button.style.transform,
    ]).toEqual(before);
    expect(button.textContent).toBe("Continue");
    expect(button.getAttribute("role")).toBeNull();
  });

  it.each([-1, NaN])("rejects invalid frame values atomically: %s", (invalid) => {
    const button = document.createElement("button");
    setButtonFrame({ faceInsets }, button);
    const before = button.outerHTML;
    expect(() => setButtonFrame({ faceInsets: { ...faceInsets, left: invalid } }, button)).toThrow(
      RangeError,
    );
    expect(() =>
      setButtonFrame({ borderWidths: { ...faceInsets, left: invalid }, faceInsets }, button),
    ).toThrow(RangeError);
    expect(button.outerHTML).toBe(before);
  });

  it("allows metrics to grow beyond the named minimum without changing frame compensation", () => {
    const group = document.createElement("div");
    setButtonFrame({ faceInsets }, group);
    setButtonSize(
      { wrapped: { height: 12, minWidth: 16, paddingX: 12, paddingY: 9 } },
      "wrapped",
      group,
    );
    expect(group.style.getPropertyValue("--ui-button-height")).toBe("18");
    expect(group.style.getPropertyValue("--ui-button-min-width")).toBe("24");
    expect(group.style.getPropertyValue("--ui-button-face-bottom")).toBe("7");
  });
});

describe("control presentation attributes", () => {
  it.each(["primary", "secondary", "navigation"] as const)(
    "sets the %s presentation without overriding native semantics or content",
    (role) => {
      const button = document.createElement("button");
      button.textContent = "Action";
      setButtonRole(role, button);
      expect(button.getAttribute("data-ui-button-role")).toBe(role);
      expect(button.hasAttribute("role")).toBe(false);
      expect(button.textContent).toBe("Action");
    },
  );

  it.each(["top", "center", "footer"] as const)("sets explicit %s placement", (placement) => {
    const row = document.createElement("div");
    setControlPlacement(placement, row);
    expect(row.getAttribute("data-ui-placement")).toBe(placement);
  });

  it("rejects unknown roles and placements without changing the element", () => {
    const element = document.createElement("div");
    expect(() => setButtonRole("other" as ButtonRole, element)).toThrow(RangeError);
    expect(() => setControlPlacement("bottom" as ButtonPlacement, element)).toThrow(RangeError);
    expect(element.attributes).toHaveLength(0);
  });
});
