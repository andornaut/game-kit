// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { FORM_ROW_ATTRIBUTES } from "../../../ui/formRow.ts";
import {
  createFormRow,
  createFormRows,
  FORM_ROW_CLASS,
  FORM_ROW_ICON_CLASS,
  FORM_ROW_LABEL_CLASS,
  FORM_ROW_TEXT_CLASS,
  FORM_ROW_VALUE_CLASS,
  FORM_ROWS_CLASS,
  type FormRowState,
  SWITCH_CLASS,
} from "./formRow.ts";
import { REFUSAL_ATTRIBUTES } from "./refusalCue.ts";

const rule = { holdMs: 500, slopPx: 5 };
const css = readFileSync(join(import.meta.dirname, "formRow.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

afterEach(() => {
  document.body.replaceChildren();
});

describe("createFormRows", () => {
  it("writes the layout on the list and clears lengths a later layout leaves out", () => {
    const rows = createFormRows(
      document,
      { columnGap: 4, height: 48, icon: { size: 16, slot: 16 } },
      { className: "game-rows" },
    );
    expect(rows.element.className).toBe(`game-rows ${FORM_ROWS_CLASS}`);
    expect(rows.element.getAttribute(FORM_ROW_ATTRIBUTES.icons)).toBe("slot");
    expect(rows.element.style.getPropertyValue("--ui-form-icon-slot")).toBe("16");
    rows.setLayout({ columnGap: 4, height: 48, value: { state: "end" } });
    expect(rows.element.getAttribute(FORM_ROW_ATTRIBUTES.icons)).toBe("none");
    expect(rows.element.getAttribute(FORM_ROW_ATTRIBUTES.state)).toBe("end");
    expect(rows.element.style.getPropertyValue("--ui-form-icon-slot")).toBe("");
    expect(() => rows.setLayout({ columnGap: 0.5, height: 48 })).toThrow(RangeError);
    expect(rows.element.getAttribute(FORM_ROW_ATTRIBUTES.state)).toBe("end");
  });
});

describe("createFormRow", () => {
  it("makes the whole row one switch named by its label, its stack decorative", () => {
    let state: FormRowState = { checked: false, value: "Off" };
    const activate = vi.fn(() => {
      state = { checked: true, value: "On" };
    });
    const icon = document.createElement("img");
    const row = createFormRow(document, {
      getAction: () => ({ activate }),
      getState: () => state,
      icon,
      label: "FPS counter",
      note: "Shows frames per second.",
      rule,
      switch: true,
    });
    const { element } = row;
    expect(element.tagName).toBe("BUTTON");
    expect(element.classList.contains(FORM_ROW_CLASS)).toBe(true);
    expect(element.getAttribute("role")).toBe("switch");
    expect(element.getAttribute("aria-checked")).toBe("false");
    expect(element.hasAttribute("aria-pressed")).toBe(false);
    expect([...element.children].map((child) => child.className)).toEqual([
      FORM_ROW_ICON_CLASS,
      FORM_ROW_TEXT_CLASS,
      FORM_ROW_VALUE_CLASS,
    ]);
    expect(icon.getAttribute("aria-hidden")).toBe("true");
    expect(row.label.className).toBe(FORM_ROW_LABEL_CLASS);
    expect(row.label.textContent).toBe("FPS counter");
    expect(row.label.hasAttribute(REFUSAL_ATTRIBUTES.label)).toBe(true);
    expect(row.switch?.classList.contains(SWITCH_CLASS)).toBe(true);
    expect(row.switch?.parentElement).toBe(row.value);
    expect(row.state.textContent).toBe("Off");
    expect(row.state.getAttribute("aria-hidden")).toBe("true");
    expect(row.note.getAttribute("aria-hidden")).toBe("true");
    expect(element.getAttribute("aria-describedby")).toBe(row.note.id);
    // Only the label is read as the name: every other cell's text is hidden from it.
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const named: string[] = [];
    while (walker.nextNode()) {
      if (walker.currentNode.parentElement?.closest("[aria-hidden]") === null) {
        named.push(walker.currentNode.textContent ?? "");
      }
    }
    expect(named).toEqual(["FPS counter"]);
    document.body.append(element);
    element.click();
    row.refresh();
    expect(activate).toHaveBeenCalledOnce();
    expect(element.getAttribute("aria-checked")).toBe("true");
    expect(row.state.textContent).toBe("On");
    row.dispose();
  });

  it("describes a value row by its note and value, and updates its text", () => {
    const row = createFormRow(document, {
      getAction: () => null,
      getState: () => ({ value: "Large" }),
      label: "Text size",
      rule,
    });
    const { element } = row;
    expect(element.hasAttribute("role")).toBe(false);
    expect(row.switch).toBeUndefined();
    expect(element.getAttribute("aria-describedby")).toBe(row.state.id);
    expect(row.note.hidden).toBe(true);
    row.setNote("Scales the text.");
    expect(element.getAttribute("aria-describedby")).toBe(`${row.note.id} ${row.state.id}`);
    row.setNote(undefined);
    expect(element.getAttribute("aria-describedby")).toBe(row.state.id);
    row.setLabel("Type size");
    expect(row.label.textContent).toBe("Type size");
    expect(row.label.classList.contains("ui-control-label")).toBe(false);
    expect(row.label.parentElement?.className).toBe(FORM_ROW_TEXT_CLASS);
  });

  it("keeps the kit button's unavailable and disabled states", () => {
    const onUnavailable = vi.fn();
    const row = createFormRow(document, {
      getAction: () => ({ activate: vi.fn() }),
      getState: () => ({ availability: { kind: "unavailable", reason: "Not on this device" } }),
      label: "Vibration",
      onUnavailable,
      rule,
      switch: true,
    });
    document.body.append(row.element);
    expect(row.element.getAttribute("aria-disabled")).toBe("true");
    row.element.click();
    expect(onUnavailable).toHaveBeenCalledWith("Not on this device");
    expect(row.state.hidden).toBe(true);
  });
});

describe("formRow.css", () => {
  it("matches only through zero-specificity selectors, with no literals", () => {
    const selectors = [...css.matchAll(/(^|\n)\s*([^@{}\s][^{}]*)\{/g)].map((match) =>
      match[2]!.trim(),
    );
    expect(selectors.length).toBeGreaterThan(10);
    for (const selector of selectors) {
      expect(selector, selector).toMatch(/^:where\(/);
    }
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\b(rgb|hsl)a?\(/i);
    expect(css).not.toMatch(/\b(outline|box-shadow)\s*:/);
    expect(css.replace(/\* -?1px\b/g, "")).not.toMatch(/\d(px|rem|em)\b/);
  });

  it("sizes the value column by CSS and shares it across rows", () => {
    expect(css).toContain("[value] var(--ui-form-value-track, max-content)");
    expect(css).toContain("grid-template-columns: subgrid");
    expect(css).toContain("var(--ui-form-rows-gap)");
  });

  it("keeps rows' fills to the theme with a clear idle face and no dip", () => {
    const list = /:where\(\.ui-form-rows\)\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(list).toContain("--ui-colour-button-face: transparent");
    expect(list).toContain("--ui-button-press-dip: 0");
    const row = /:where\(\.ui-form-row\)\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(row).not.toMatch(/(^|\s)(background|background-color|color)\s*:/m);
  });
});
