// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  ACTION_CLASS,
  ACTION_GROUP_CLASS,
  ACTION_MEASURING_ATTRIBUTE,
  ACTION_MIDDLE_CLASS,
  createActionGroup,
  createPressContext,
} from "./actionGroup.ts";

function fixture() {
  const group = createActionGroup(document, { className: "game-actions" });
  const back = document.createElement("button");
  const ok = document.createElement("button");
  ok.className = "game-primary";
  group.element.append(ok, back);
  document.body.append(group.element);
  return { back, group, ok };
}

const value = (element: HTMLElement, name: string) => element.style.getPropertyValue(name);

describe("createActionGroup", () => {
  it("places each action by its face and press outsets without reordering the DOM", () => {
    const { back, group, ok } = fixture();
    expect(group.element.classList.contains(ACTION_GROUP_CLASS)).toBe(true);
    expect(group.element.classList.contains("game-actions")).toBe(true);
    const arrangement = group.arrange({ width: 201 }, [
      { element: ok, role: "primary", size: { height: 48, width: 50 } },
      { element: back, role: "secondary", size: { height: 48, width: 60 } },
    ]);
    expect(arrangement.axis).toBe("row");
    expect(group.element.dataset.uiActionAxis).toBe("row");
    expect(group.element.dataset.uiActionVariant).toBe("group");
    expect(group.element.dataset.uiActionGap).toBe("standard");
    expect(value(group.element, "--ui-action-group-width")).toBe("201");
    expect(value(group.element, "--ui-action-group-height")).toBe("48");
    expect(value(back, "--ui-action-x")).toBe("37");
    expect(value(ok, "--ui-action-x")).toBe("113");
    expect(value(back, "--ui-action-outset-right")).toBe("8");
    expect(value(ok, "--ui-action-outset-left")).toBe("8");
    expect(value(ok, "--ui-action-outset-right")).toBe("12");
    expect(ok.className).toBe(`game-primary ${ACTION_CLASS}`);
    expect([...group.element.children]).toEqual([ok, back]);
    group.element.remove();
  });

  it("leaves hidden actions out of the layout", () => {
    const { back, group, ok } = fixture();
    back.hidden = true;
    group.arrange({ width: 100 }, [
      { element: ok, role: "primary", size: { height: 48, width: 50 } },
      { element: back, role: "secondary", size: { height: 48, width: 60 } },
    ]);
    expect(value(ok, "--ui-action-x")).toBe("25");
    expect(value(back, "--ui-action-x")).toBe("");
    expect(back.classList.contains(ACTION_CLASS)).toBe(true);
    group.element.remove();
  });

  it("places a footer's middle slot", () => {
    const { back, group, ok } = fixture();
    const pager = document.createElement("div");
    group.element.insertBefore(pager, ok);
    const arrangement = group.arrange(
      {
        middle: { element: pager, size: { height: 48, width: 80 } },
        variant: "footer",
        width: 300,
      },
      [
        { element: back, role: "secondary", size: { height: 48, width: 60 } },
        { element: ok, role: "primary", size: { height: 48, width: 70 } },
      ],
    );
    expect(arrangement.middle).toEqual({ height: 48, width: 80, x: 110, y: 0 });
    expect(pager.classList.contains(ACTION_MIDDLE_CLASS)).toBe(true);
    expect(value(pager, "--ui-action-x")).toBe("110");
    expect(value(ok, "--ui-action-x")).toBe("230");
    group.element.remove();
  });

  it("refuses an element outside the group before changing anything", () => {
    const { group, ok } = fixture();
    const stranger = document.createElement("button");
    expect(() =>
      group.arrange({ width: 200 }, [
        { element: ok, role: "primary", size: { height: 48, width: 50 } },
        { element: stranger, role: "secondary", size: { height: 48, width: 50 } },
      ]),
    ).toThrow(RangeError);
    expect(() =>
      group.arrange({ width: 20 }, [
        { element: ok, role: "primary", size: { height: 48, width: 50 } },
      ]),
    ).toThrow(RangeError);
    expect(ok.getAttribute("style")).toBeNull();
    expect(group.element.hasAttribute("data-ui-action-axis")).toBe(false);
    group.element.remove();
  });

  it("clears actions it no longer places and everything on dispose", () => {
    const { back, group, ok } = fixture();
    const both = [
      { element: ok, role: "primary" as const, size: { height: 48, width: 50 } },
      { element: back, role: "secondary" as const, size: { height: 48, width: 60 } },
    ];
    group.arrange({ width: 200 }, both);
    group.arrange({ width: 200 }, both.slice(0, 1));
    expect(back.classList.contains(ACTION_CLASS)).toBe(false);
    expect(value(back, "--ui-action-x")).toBe("");
    group.dispose();
    group.dispose();
    expect(ok.className).toBe("game-primary");
    expect(value(ok, "--ui-action-outset-top")).toBe("");
    expect(() => group.arrange({ width: 200 }, both)).toThrow(Error);
    group.element.remove();
  });

  it("measures natural faces in whole base px with placement suspended", () => {
    const { back, group, ok } = fixture();
    group.element.style.setProperty("--ui-unit", "2");
    const seen: boolean[] = [];
    const rect = (width: number, height: number) => () => {
      seen.push(group.element.hasAttribute(ACTION_MEASURING_ATTRIBUTE));
      return { height, width } as DOMRect;
    };
    vi.spyOn(ok, "getBoundingClientRect").mockImplementation(rect(101, 96));
    vi.spyOn(back, "getBoundingClientRect").mockImplementation(rect(120.0000001, 96));
    expect(group.measure([ok, back])).toEqual([
      { height: 48, width: 51 },
      { height: 48, width: 60 },
    ]);
    expect(seen).toEqual([true, true]);
    expect(group.element.hasAttribute(ACTION_MEASURING_ATTRIBUTE)).toBe(false);
    group.element.remove();
  });
});

describe("arrangeGrid", () => {
  it("places rows of columns by the pure grid, as a group", () => {
    const group = createActionGroup(document);
    const buttons = ["a", "b", "c"].map(() => document.createElement("button"));
    group.element.append(...buttons);
    const grid = group.arrangeGrid(
      { cellWidth: "fill", columns: 2, width: 216 },
      buttons.map((element) => ({ element, role: "secondary", size: { height: 48, width: 60 } })),
    );
    expect([grid.columns, grid.rows]).toEqual([2, 2]);
    expect(group.element.dataset.uiActionAxis).toBe("grid");
    expect(group.element.dataset.uiActionVariant).toBe("group");
    expect(value(group.element, "--ui-action-group-height")).toBe("104");
    expect(value(buttons[1]!, "--ui-action-x")).toBe("116");
    expect(value(buttons[2]!, "--ui-action-x")).toBe("58");
    expect(value(buttons[2]!, "--ui-action-outset-top")).toBe("4");
  });
});

describe("createPressContext", () => {
  // Every box is placed in px at --ui-unit 2 from the root's corner at (10, 20).
  const at = (element: Element, x: number, y: number, width: number, height: number) =>
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
      bottom: 20 + y + height,
      height,
      left: 10 + x,
      right: 10 + x + width,
      top: 20 + y,
      width,
      x: 10 + x,
      y: 20 + y,
    } as DOMRect);

  function cheats() {
    const root = document.createElement("div");
    root.style.setProperty("--ui-unit", "2");
    const stack = createActionGroup(document);
    const unlock = document.createElement("button");
    stack.element.append(unlock);
    const row = document.createElement("button");
    const footer = createActionGroup(document);
    const back = document.createElement("button");
    footer.element.append(back);
    root.append(stack.element, row, footer.element);
    document.body.append(root);
    at(root, 0, 0, 400, 400);
    at(stack.element, 0, 0, 200, 96);
    at(row, 0, 120, 200, 96);
    at(footer.element, 0, 240, 200, 96);
    const size = { height: 48, width: 60 };
    const arrange = () => {
      stack.arrange({ width: 100 }, [{ element: unlock, role: "secondary", size }]);
      footer.arrange({ width: 100 }, [{ element: back, role: "secondary", size }]);
    };
    return { arrange, back, footer, root, row, stack, unlock };
  }

  it("clamps groups toward a form row between them, so no stacking order is needed", () => {
    const { arrange, back, footer, root, row, stack, unlock } = cheats();
    arrange();
    expect(value(unlock, "--ui-action-outset-bottom")).toBe("12");
    const context = createPressContext(root);
    context.add(stack);
    context.add(row);
    // A wrapping view, as a modal frame's footer is, is its group.
    context.add({ ...footer });
    context.apply();
    // The row is 12 base px below the stack's face and above Back's.
    expect(value(unlock, "--ui-action-outset-bottom")).toBe("6");
    expect(value(back, "--ui-action-outset-top")).toBe("6");
    expect(value(unlock, "--ui-action-outset-top")).toBe("12");
    arrange();
    expect(value(unlock, "--ui-action-outset-bottom")).toBe("6");
    row.hidden = true;
    context.apply();
    expect(value(unlock, "--ui-action-outset-bottom")).toBe("12");
    row.hidden = false;
    context.apply();
    context.remove(stack);
    expect(value(unlock, "--ui-action-outset-bottom")).toBe("12");
    context.dispose();
    expect(value(back, "--ui-action-outset-top")).toBe("12");
    root.remove();
  });

  it("keeps a group in one context and refuses a disposed one", () => {
    const { footer, root, stack } = cheats();
    const context = createPressContext(root);
    context.add(stack);
    context.add(stack);
    expect(() => createPressContext(root).add(stack)).toThrow(RangeError);
    footer.dispose();
    expect(() => context.add(footer)).toThrow(Error);
    stack.dispose();
    context.apply();
    root.remove();
  });
});

describe("actionGroup.css", () => {
  const css = readFileSync(join(import.meta.dirname, "actionGroup.css"), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );

  it.each([
    "--ui-action-group-width",
    "--ui-action-group-height",
    "--ui-action-x",
    "--ui-action-y",
    "--ui-action-width",
    "--ui-action-height",
    "--ui-action-outset-top",
    "--ui-action-outset-right",
    "--ui-action-outset-bottom",
    "--ui-action-outset-left",
  ])("reads %s at the action length", (name) => {
    expect(css).toContain(`var(${name}) * var(--ui-action-length)`);
  });

  it("measures lengths at --ui-unit, or in CSS px on a projected group", () => {
    expect(css).toMatch(
      /\.ui-action-group \{\s*--ui-action-length: calc\(var\(--ui-unit, 1\) \* 1px\);/,
    );
    expect(css).toMatch(
      /\[data-ui-action-projected\] > :is\(\.ui-action, \.ui-action-middle\) \{\s*--ui-action-length: 1px;/,
    );
  });

  it("outsets the press area as the action's own overflow, with no fixed lengths or colours", () => {
    expect(css).toMatch(/\.ui-action::before\s*\{[^}]*content: "";[^}]*position: absolute;/);
    expect(css).toContain(`[${ACTION_MEASURING_ATTRIBUTE}]`);
    expect(css.replace(/\* -?1px\)|--ui-action-length: 1px;/g, "")).not.toMatch(/\d(px|rem|em)\b/);
    expect(css).not.toMatch(/\b(color|background|outline|box-shadow|padding)\s*:/);
  });
});
