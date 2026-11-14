import { describe, expect, expectTypeOf, it } from "vitest";

import {
  type ComponentNode,
  type LayoutMeasurement,
  type LayoutNode,
  layoutReport,
  validateLayoutTree,
} from "./layoutTree.ts";

type Schema = {
  card: { props: { title: string }; slots: "header" | "body" | "footer" };
  text: { props: { text: string }; slots: never };
};
const slots = { card: ["header", "body", "footer"], text: [] } as const;
const leaf: LayoutNode<Schema> = {
  component: "text",
  key: "caption",
  kind: "component",
  props: { text: "Caption" },
};
const bounds = { height: 80, width: 120, x: 0, y: 0 };
const measurement: LayoutMeasurement = {
  available: bounds,
  clipped: false,
  overlaps: [],
  required: { height: 40, width: 80, x: 0, y: 0 },
  wrappedLines: [{ height: 10, width: 80, x: 0, y: 0 }],
};

describe("layout tree validation", () => {
  it("maps component props and named slots without accepting another component's props", () => {
    expectTypeOf<Extract<ComponentNode<Schema>, { component: "text" }>["props"]>().toEqualTypeOf<{
      text: string;
    }>();
    expectTypeOf<Extract<ComponentNode<Schema>, { component: "card" }>["slots"]>().toEqualTypeOf<
      | Readonly<Partial<Record<"header" | "body" | "footer", readonly LayoutNode<Schema>[]>>>
      | undefined
    >();
    // @ts-expect-error Text components require text props, not card props.
    const wrongProps: ComponentNode<Schema> = { ...leaf, props: { title: "Title" } };
    // @ts-expect-error Text components have no body slot.
    const wrongSlot: ComponentNode<Schema> = { ...leaf, slots: { body: [] } };
    expect([wrongProps, wrongSlot]).toHaveLength(2);
  });

  it("accepts repeated keys in different slots while validating nested containers", () => {
    expect(() =>
      validateLayoutTree<Schema>(slots, {
        component: "card",
        key: "card",
        kind: "component",
        props: { title: "Title" },
        slots: {
          body: [{ children: [leaf], gap: 4, key: "content", kind: "columns", padding: 0 }],
          header: [leaf],
        },
      }),
    ).not.toThrow();
  });

  it.each(["row", "stack", "columns"] as const)("rejects duplicate sibling keys in %s", (kind) => {
    expect(() =>
      validateLayoutTree(slots, {
        children: [leaf, leaf],
        gap: 0,
        key: "group",
        kind,
        padding: 0,
      }),
    ).toThrow(/unique/);
  });

  it.each([-1, Infinity, NaN])("rejects invalid gap or padding %s", (value) => {
    for (const metrics of [
      { gap: value, padding: 0 },
      { gap: 0, padding: value },
    ]) {
      expect(() =>
        validateLayoutTree(slots, {
          ...metrics,
          children: [leaf],
          key: "group",
          kind: "row",
        }),
      ).toThrow(/finite/);
    }
  });

  it("rejects undeclared slots, unknown components, alignments and cyclic trees", () => {
    expect(() =>
      validateLayoutTree(slots, { ...leaf, slots: { missing: [] } } as LayoutNode<Schema>),
    ).toThrow(/slot/);
    expect(() =>
      validateLayoutTree(slots, { ...leaf, component: "missing" } as unknown as LayoutNode<Schema>),
    ).toThrow(/component/);
    const group = {
      children: [] as LayoutNode<Schema>[],
      gap: 0,
      key: "group",
      kind: "row" as const,
      padding: 0,
    };
    expect(() =>
      validateLayoutTree(slots, { ...group, align: "wrong" } as unknown as LayoutNode<Schema>),
    ).toThrow(/alignment/);
    group.children.push(group);
    expect(() => validateLayoutTree(slots, group)).toThrow(/Cyclic/);
  });
});

describe("physical layout reports", () => {
  it("reports fit only with explicit complete physical evidence", () => {
    expect(layoutReport(bounds, [{ measurement, path: ["card", "body", "caption"] }])).toEqual({
      diagnostics: [],
      status: "fit",
    });
  });

  it("retains required rectangles, wrapped lines, clip and overlap evidence at exact paths", () => {
    const required = { ...bounds, width: 150 };
    const wrappedLines = [{ height: 10, width: 150, x: 0, y: 0 }];
    const report = layoutReport(bounds, [
      {
        measurement: {
          ...measurement,
          clipped: true,
          overlaps: [["footer"]],
          required,
          wrappedLines,
        },
        path: ["card", "body", "caption"],
      },
    ]);
    expect(report.status).toBe("overflow");
    expect(report.diagnostics.map(({ kind }) => kind)).toEqual(["overflow", "clip", "overlap"]);
    expect(report.diagnostics[2]).toEqual({
      available: bounds,
      kind: "overlap",
      path: ["card", "body", "caption"],
      relatedPath: ["footer"],
      required,
      viewport: bounds,
      wrappedLines,
    });
  });

  it("detects wrapped lines outside the slot and required bounds outside the viewport", () => {
    expect(
      layoutReport(bounds, [
        {
          measurement: { ...measurement, wrappedLines: [{ height: 10, width: 130, x: 0, y: 0 }] },
          path: ["text"],
        },
      ]).status,
    ).toBe("overflow");
    expect(
      layoutReport(bounds, [
        {
          measurement: {
            ...measurement,
            available: { ...bounds, width: 200 },
            required: { ...bounds, width: 150 },
          },
          path: ["text"],
        },
      ]).status,
    ).toBe("overflow");
  });

  it("reports unavailable for missing or partial evidence even alongside known overflow", () => {
    const report = layoutReport(bounds, [
      { measurement: { ...measurement, clipped: true }, path: ["clipped"] },
      { measurement: null, path: ["missing"] },
      { measurement: { available: bounds } as LayoutMeasurement, path: ["partial"] },
      { measurement: { ...measurement, required: { ...bounds, width: NaN } }, path: ["invalid"] },
    ]);
    expect(report.status).toBe("unavailable");
    expect(report.diagnostics.map(({ kind }) => kind)).toEqual([
      "clip",
      "unavailable",
      "unavailable",
      "unavailable",
    ]);
    expect(layoutReport(bounds, []).status).toBe("unavailable");
  });

  it("copies evidence so later measurement mutations cannot change a report", () => {
    const required = { ...bounds, width: 150 };
    const report = layoutReport(bounds, [
      { measurement: { ...measurement, required }, path: ["text"] },
    ]);
    required.width = 1;
    expect(report.diagnostics[0]!.required!.width).toBe(150);
  });

  it("rejects nonfinite viewports instead of reporting a fit", () => {
    expect(() => layoutReport({ ...bounds, height: Infinity }, [])).toThrow(/viewport/);
  });
});
