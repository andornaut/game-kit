import { describe, expect, it } from "vitest";

import {
  buttonGroupSize,
  type ButtonLayoutContext,
  type ButtonMetrics,
  type ButtonPlacement,
  type ButtonRole,
  type ButtonSize,
  layoutButton,
  withoutCurrentNavigation,
} from "./buttonLayout.ts";

// Synthetic measurements exercise geometry without prescribing product metrics or labels.
const tokens = {
  compact: { height: 24, minWidth: 24, paddingX: 4, paddingY: 2 },
  standard: { height: 40, minWidth: 60, paddingX: 10, paddingY: 5 },
} satisfies Record<string, ButtonMetrics>;
const labels: ButtonSize[] = [
  { height: 10, width: 20 },
  { height: 30, width: 75 },
];
const size = buttonGroupSize(tokens, { labels, size: "standard" });
const context: ButtonLayoutContext = {
  bounds: { height: 100, width: 200, x: 10, y: 20 },
  metrics: tokens.standard,
  size,
};
const button = { label: labels[0]!, role: "primary" as const };

describe("buttonGroupSize", () => {
  it("derives a shared width from the widest measured label and horizontal padding", () => {
    expect(size).toEqual({ height: 40, width: 95 });
    expect(buttonGroupSize(tokens, { labels: [...labels].reverse(), size: "standard" })).toEqual(
      size,
    );
  });

  it("uses the named token's minimum for a short label or an empty group", () => {
    expect(buttonGroupSize(tokens, { labels: [labels[0]!], size: "standard" })).toEqual({
      height: 40,
      width: 60,
    });
    expect(buttonGroupSize(tokens, { labels: [], size: "compact" })).toEqual({
      height: 24,
      width: 24,
    });
  });

  it("includes horizontal padding even when the minimum width is smaller", () => {
    expect(
      buttonGroupSize(
        { narrow: { ...tokens.compact, minWidth: 0 } },
        { labels: [], size: "narrow" },
      ),
    ).toEqual({ height: 24, width: 8 });
  });

  it.each(["missing", "toString", "__proto__"])("rejects an absent token named %s", (name) => {
    expect(() => buttonGroupSize(tokens, { labels, size: name })).toThrow(RangeError);
  });

  it("rejects a measured multiline label that cannot fit the padded height", () => {
    expect(() =>
      buttonGroupSize(tokens, { labels: [{ height: 31, width: 20 }], size: "standard" }),
    ).toThrow(RangeError);
  });

  it.each<keyof ButtonMetrics>(["height", "minWidth", "paddingX", "paddingY"])(
    "rejects invalid %s metrics",
    (field) => {
      for (const value of [-1, NaN, Infinity, -Infinity]) {
        expect(() =>
          buttonGroupSize(
            { invalid: { ...tokens.standard, [field]: value } },
            { labels, size: "invalid" },
          ),
        ).toThrow(RangeError);
      }
    },
  );

  it("rejects padding that overflows even an empty face", () => {
    expect(() =>
      buttonGroupSize(
        { invalid: { ...tokens.standard, paddingY: 21 } },
        { labels: [], size: "invalid" },
      ),
    ).toThrow(RangeError);
  });

  it("rejects arithmetic overflow from finite horizontal metrics", () => {
    expect(() =>
      buttonGroupSize(
        { invalid: { ...tokens.standard, paddingX: Number.MAX_VALUE } },
        { labels: [], size: "invalid" },
      ),
    ).toThrow(RangeError);
  });

  it.each<keyof ButtonSize>(["width", "height"])("rejects invalid label %s", (axis) => {
    for (const value of [-1, NaN, Infinity, -Infinity]) {
      expect(() =>
        buttonGroupSize(tokens, {
          labels: [{ ...{ height: 10, width: 10 }, [axis]: value }],
          size: "standard",
        }),
      ).toThrow(RangeError);
    }
  });
});

describe("layoutButton", () => {
  it("defaults to top placement beside related text", () => {
    expect(layoutButton(context, button)).toEqual({
      face: { height: 40, width: 95, x: 62.5, y: 20 },
      label: { height: 10, width: 20, x: 100, y: 35 },
      role: "primary",
    });
  });

  it.each<[ButtonPlacement, number]>([
    ["top", 20],
    ["center", 50],
    ["footer", 80],
  ])("places the face at %s while centering a multiline label on both axes", (placement, y) => {
    const placed = layoutButton(
      { ...context, footerBaseline: 105, placement },
      { label: labels[1]!, labelBaselineOffset: 20, role: "secondary" },
    );
    expect(placed.face).toEqual({ height: 40, width: 95, x: 62.5, y });
    expect(placed.label).toEqual({ height: 30, width: 75, x: 72.5, y: y + 5 });
  });

  it("centers a compact quantity control in a taller row", () => {
    const label = { height: 12, width: 8 };
    const placed = layoutButton(
      {
        ...context,
        metrics: tokens.compact,
        placement: "center",
        size: buttonGroupSize(tokens, { labels: [label], size: "compact" }),
      },
      { label, role: "secondary" },
    );
    expect(placed.face).toEqual({ height: 24, width: 24, x: 98, y: 58 });
    expect(placed.label).toEqual({ height: 12, width: 8, x: 106, y: 64 });
  });

  it("aligns different measured line boxes to the same explicit footer baseline", () => {
    const measurements = [
      { label: { height: 10, width: 20 }, labelBaselineOffset: 7 },
      { label: { height: 30, width: 75 }, labelBaselineOffset: 22 },
    ];
    const placed = measurements.map((measurement, index) =>
      layoutButton(
        {
          ...context,
          bounds: { ...context.bounds, x: index * 200 },
          footerBaseline: 90,
          placement: "footer",
        },
        { ...measurement, role: "navigation" },
      ),
    );
    expect(placed.map(({ face }) => [face.width, face.height, face.y])).toEqual([
      [95, 40, 68],
      [95, 40, 63],
    ]);
    expect(
      placed.map(({ label }, index) => label.y + measurements[index]!.labelBaselineOffset),
    ).toEqual([90, 90]);
    for (const { face, label } of placed) {
      expect(label.y + label.height / 2).toBe(face.y + face.height / 2);
      expect(label.x + label.width / 2).toBe(face.x + face.width / 2);
      expect(face.y).toBeGreaterThanOrEqual(context.bounds.y);
      expect(face.y + face.height).toBeLessThanOrEqual(context.bounds.y + context.bounds.height);
    }
  });

  it("requires both footer target and measured label baseline offset", () => {
    expect(() => layoutButton({ ...context, placement: "footer" }, button)).toThrow(RangeError);
    expect(() =>
      layoutButton({ ...context, footerBaseline: 90, placement: "footer" }, button),
    ).toThrow(RangeError);
    expect(() =>
      layoutButton({ ...context, placement: "footer" }, { ...button, labelBaselineOffset: 7 }),
    ).toThrow(RangeError);
  });

  it.each([NaN, Infinity, -Infinity, 41, 103])(
    "rejects invalid or uncontainable footer baseline %s",
    (footerBaseline) => {
      expect(() =>
        layoutButton(
          { ...context, footerBaseline, placement: "footer" },
          { ...button, labelBaselineOffset: 7 },
        ),
      ).toThrow(RangeError);
    },
  );

  it.each([-1, 11, NaN, Infinity, -Infinity])(
    "rejects a baseline offset outside the label line box: %s",
    (labelBaselineOffset) => {
      expect(() =>
        layoutButton(
          { ...context, footerBaseline: 90, placement: "footer" },
          { ...button, labelBaselineOffset },
        ),
      ).toThrow(RangeError);
    },
  );

  it.each([42, 102])(
    "accepts a footer face exactly on a region edge at baseline %s",
    (footerBaseline) => {
      const placed = layoutButton(
        { ...context, footerBaseline, placement: "footer" },
        { ...button, labelBaselineOffset: 7 },
      );
      expect(placed.label.y + 7).toBe(footerBaseline);
      expect(placed.face.height).toBe(tokens.standard.height);
    },
  );

  it.each([0, 10])("accepts a measured baseline at line box offset %s", (labelBaselineOffset) => {
    const placed = layoutButton(
      { ...context, footerBaseline: 60, placement: "footer" },
      { ...button, labelBaselineOffset },
    );
    expect(placed.label.y + labelBaselineOffset).toBe(60);
  });

  it("accepts a finite negative footer target within a negative-origin region", () => {
    const placed = layoutButton(
      {
        ...context,
        bounds: { ...context.bounds, y: -100 },
        footerBaseline: -20,
        placement: "footer",
      },
      { ...button, labelBaselineOffset: 7 },
    );
    expect(placed.face.y).toBe(-42);
    expect(placed.label.y + 7).toBe(-20);
  });

  it("rejects an unknown role or placement", () => {
    expect(() => layoutButton(context, { ...button, role: "unknown" as ButtonRole })).toThrow(
      RangeError,
    );
    expect(() =>
      layoutButton({ ...context, placement: "unknown" as ButtonPlacement }, button),
    ).toThrow(RangeError);
  });

  it.each<ButtonRole>(["primary", "secondary", "navigation"])("preserves the %s role", (role) => {
    expect(layoutButton(context, { ...button, role }).role).toBe(role);
  });

  it("accepts exact containment and a negative coordinate origin", () => {
    const bounds = { ...size, x: -95, y: -40 };
    expect(layoutButton({ ...context, bounds }, button).face).toEqual(bounds);
  });

  it.each(["width", "height"] as const)("rejects insufficient region %s", (axis) => {
    expect(() =>
      layoutButton({ ...context, bounds: { ...context.bounds, [axis]: size[axis] - 1 } }, button),
    ).toThrow(RangeError);
  });

  it.each(["width", "height"] as const)("rejects invalid region and face %s", (axis) => {
    for (const value of [-1, NaN, Infinity, -Infinity]) {
      expect(() =>
        layoutButton({ ...context, bounds: { ...context.bounds, [axis]: value } }, button),
      ).toThrow(RangeError);
      expect(() => layoutButton({ ...context, size: { ...size, [axis]: value } }, button)).toThrow(
        RangeError,
      );
    }
  });

  it("rejects nonfinite origins and overflowing bounds edges", () => {
    for (const bounds of [
      { ...context.bounds, x: NaN },
      { ...context.bounds, y: Infinity },
      { ...context.bounds, width: Number.MAX_VALUE, x: Number.MAX_VALUE },
      { ...context.bounds, height: Number.MAX_VALUE, y: Number.MAX_VALUE },
    ]) {
      expect(() => layoutButton({ ...context, bounds }, button)).toThrow(RangeError);
    }
  });

  it("rejects a stale group width rather than letting a new label escape its padding", () => {
    expect(() =>
      layoutButton(context, { label: { height: 10, width: 76 }, role: "primary" }),
    ).toThrow(RangeError);
  });

  it("rejects an arbitrary face height that differs from the named token", () => {
    expect(() => layoutButton({ ...context, size: { ...size, height: 41 } }, button)).toThrow(
      RangeError,
    );
  });
});

describe("withoutCurrentNavigation", () => {
  it("omits only navigation for the current section and preserves caller objects without mutation", () => {
    const metadata = Object.freeze({ value: 3 });
    const buttons = Object.freeze([
      Object.freeze({ key: "a", role: "navigation" as const, section: "a" }),
      Object.freeze({ key: "a", role: "primary" as const, section: "a" }),
      Object.freeze({ key: "a", role: "secondary" as const, section: "a" }),
      Object.freeze({
        key: "b",
        metadata,
        role: "navigation" as const,
        section: "b",
      }),
      Object.freeze({ key: "back", role: "navigation" as const }),
    ]);
    const before = [...buttons];
    const retained = withoutCurrentNavigation("a", buttons);
    expect(retained).toEqual(before.slice(1));
    expect(buttons).toEqual(before);
    retained.forEach((entry, index) => expect(entry).toBe(buttons[index + 1]));
    expect(retained[2]).toHaveProperty("metadata", metadata);
  });

  it("accepts caller-owned numeric section IDs and an empty list", () => {
    const buttons = [{ role: "navigation" as const, section: 4 }];
    expect(withoutCurrentNavigation(4, buttons)).toEqual([]);
    expect(withoutCurrentNavigation(5, buttons)[0]).toBe(buttons[0]);
    expect(withoutCurrentNavigation(4, [])).toEqual([]);
  });

  it("retains unsectioned navigation when the current section is undefined", () => {
    const buttons = [{ role: "navigation" as const }];
    expect(withoutCurrentNavigation(undefined, buttons)).toEqual(buttons);
  });

  it("rejects an unknown role", () => {
    expect(() => withoutCurrentNavigation("a", [{ role: "unknown" as ButtonRole }])).toThrow(
      RangeError,
    );
  });
});
