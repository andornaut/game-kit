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
  ])("reads %s at --ui-unit", (name) => {
    expect(css).toContain(`var(${name}) * var(--ui-unit, 1)`);
  });

  it("outsets the press area as the action's own overflow, with no fixed lengths or colours", () => {
    expect(css).toMatch(/\.ui-action::before\s*\{[^}]*content: "";[^}]*position: absolute;/);
    expect(css).toContain(`[${ACTION_MEASURING_ATTRIBUTE}]`);
    expect(css.replace(/\* -?1px\)/g, "")).not.toMatch(/\d(px|rem|em)\b/);
    expect(css).not.toMatch(/\b(color|background|outline|box-shadow|padding)\s*:/);
  });
});
