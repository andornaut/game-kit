// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { FORM_ROW_ATTRIBUTES } from "../../../../ui/layout/formRow.ts";
import * as refusalCue from "../refusalCue.ts";
import { REFUSAL_ATTRIBUTES } from "../refusalCue.ts";
import {
  createFormRow,
  createFormRows,
  FORM_ROW_ACTION_ATTRIBUTE,
  FORM_ROW_CLASS,
  FORM_ROW_FACE_CLASS,
  FORM_ROW_ICON_CLASS,
  FORM_ROW_LABEL_CLASS,
  FORM_ROW_PRESS_DIP_ATTRIBUTE,
  FORM_ROW_TEXT_CLASS,
  FORM_ROW_VALUE_CLASS,
  FORM_ROWS_CLASS,
  type FormRowState,
  SWITCH_CLASS,
} from "./formRow.ts";

// The kit cue's functions, passed through as spies, so a test can prove a row never calls them.
vi.mock("../refusalCue.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("../refusalCue.ts")>();
  return {
    ...original,
    refuse: vi.fn(original.refuse),
    refusing: vi.fn(original.refusing),
    stopRefusal: vi.fn(original.stopRefusal),
  };
});

const rule = { holdMs: 500, slopPx: 5 };
const css = readFileSync(join(import.meta.dirname, "formRow.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.clearAllMocks();
});

const CUE = { shake: 2, stepMs: 50, steps: 4 };

// A click as a pointer (detail 1) or as Enter, Space or click() (detail 0) delivers it.
const click = (element: HTMLElement, detail: 0 | 1) =>
  element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail }));

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

  it.each([
    ["value", false],
    ["switch", true],
  ])(
    "plays the game's refuse on each key, pointer and hold refusal of a %s row",
    (_kind, isSwitch) => {
      let reduced = false;
      let current = true;
      const activate = vi.fn();
      const refuse = vi.fn();
      const row = createFormRow(document, {
        getAction: () => (current ? { activate } : null),
        getState: () => ({ availability: { kind: "refused" }, checked: false, value: "Off" }),
        label: "Vibration",
        refusal: { reducedMotion: () => reduced, refuse },
        rule,
        switch: isSwitch,
      });
      const { element } = row;
      document.body.append(element);
      expect(element.getAttribute("aria-disabled")).toBe("true");
      expect(element.tabIndex).toBe(0);
      expect(click(element, 0)).toBe(false);
      expect(refuse.mock.calls).toEqual([[false, element]]);
      reduced = true;
      click(element, 1);
      row.holdAction()!.hold!();
      row.holdAction()!.activate();
      expect(refuse.mock.calls).toEqual([
        [false, element],
        [true, element],
        [true, element],
        [true, element],
      ]);
      current = false;
      click(element, 1);
      expect(row.holdAction()).toBeNull();
      expect(refuse).toHaveBeenCalledTimes(4);
      expect(activate).not.toHaveBeenCalled();
      row.dispose();
      expect(element.hasAttribute(REFUSAL_ATTRIBUTES.red)).toBe(false);
      expect(refusalCue.refuse).not.toHaveBeenCalled();
      expect(refusalCue.refusing).not.toHaveBeenCalled();
      expect(refusalCue.stopRefusal).not.toHaveBeenCalled();
    },
  );

  it("gives pointer refusal to the caller's onPointerRefusal only, never the kit cue", () => {
    const onPointerRefusal = vi.fn();
    const refuse = vi.fn();
    const row = createFormRow(document, {
      getAction: () => ({ activate: vi.fn() }),
      getState: () => ({ availability: { kind: "pointer-refusal" }, checked: true, value: "On" }),
      label: "Vibration",
      onPointerRefusal,
      refusal: { reducedMotion: () => false, refuse },
      rule,
      switch: true,
    });
    const { element } = row;
    document.body.append(element);
    expect(element.tabIndex).toBe(-1);
    expect(element.getAttribute("aria-disabled")).toBe("true");
    click(element, 1);
    row.holdAction()!.activate();
    expect(onPointerRefusal).toHaveBeenCalledTimes(2);
    click(element, 0);
    expect(onPointerRefusal).toHaveBeenCalledTimes(2);
    expect(refuse).not.toHaveBeenCalled();
    expect(refusalCue.refuse).not.toHaveBeenCalled();
    expect(refusalCue.refusing).not.toHaveBeenCalled();
    expect(refusalCue.stopRefusal).not.toHaveBeenCalled();
  });

  it("plays the kit cue by default, leaving a playing cue to finish, as 0.88.0 did", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const row = createFormRow(document, {
      getAction: () => ({ activate: vi.fn() }),
      getState: () => ({ availability: { kind: "refused" }, checked: false, value: "Off" }),
      label: "Vibration",
      refusal: { cue: CUE, reducedMotion: () => true },
      rule,
      switch: true,
    });
    const { element } = row;
    document.body.append(element);
    click(element, 0);
    expect(element.hasAttribute(REFUSAL_ATTRIBUTES.red)).toBe(true);
    vi.advanceTimersByTime(150);
    click(element, 1);
    vi.advanceTimersByTime(50);
    expect(element.hasAttribute(REFUSAL_ATTRIBUTES.red)).toBe(false);
    expect(vi.mocked(refusalCue.refuse).mock.calls).toEqual([[CUE, true, element]]);
    row.dispose();
  });
});

describe("one-action rows and press dips", () => {
  it("hosts one face in the row, which stays the button and its whole press target", () => {
    const activate = vi.fn();
    const icon = document.createElement("img");
    const row = createFormRow(document, {
      action: { className: "game-face", role: "secondary", size: { height: 33, width: 145 } },
      getAction: () => ({ activate }),
      getState: () => ({ value: "ignored" }),
      icon,
      label: "Install",
      rule,
    });
    document.body.append(row.element);
    const { element, face } = row;
    expect(element.hasAttribute(FORM_ROW_ACTION_ATTRIBUTE)).toBe(true);
    expect(element.getAttribute("data-ui-button-role")).toBe("secondary");
    expect([...element.children]).toEqual([face]);
    expect(face?.className).toBe(`game-face ${FORM_ROW_FACE_CLASS} ui-button-face`);
    expect(face?.firstElementChild?.firstElementChild).toBe(icon);
    expect(row.label.parentElement).toBe(face);
    expect(row.label.textContent).toBe("Install");
    expect(element.hasAttribute("aria-describedby")).toBe(false);
    expect(element.style.getPropertyValue("--ui-form-action-width")).toBe("145");
    expect(element.style.getPropertyValue("--ui-form-action-height")).toBe("33");
    element.click();
    expect(activate).toHaveBeenCalledOnce();
    expect(() => row.setNote("A note")).toThrow(RangeError);
    const base = { getAction: () => null, label: "Install", rule };
    const size = { height: 33, width: 145 };
    expect(() => createFormRow(document, { ...base, action: { size }, switch: true })).toThrow(
      RangeError,
    );
    expect(() => createFormRow(document, { ...base, action: { size }, note: "Note" })).toThrow(
      RangeError,
    );
    expect(() =>
      createFormRow(document, { ...base, action: { size: { height: 0, width: 4 } } }),
    ).toThrow(RangeError);
  });

  it("marks a row that dips with its dip in units, and only such rows", () => {
    const dipping = createFormRow(document, {
      getAction: () => null,
      label: "Sound",
      pressDip: 1,
      rule,
    });
    expect(dipping.element.hasAttribute(FORM_ROW_PRESS_DIP_ATTRIBUTE)).toBe(true);
    expect(dipping.element.style.getPropertyValue("--ui-form-row-press-dip")).toBe("1");
    const still = createFormRow(document, { getAction: () => null, label: "Size", rule });
    expect(still.element.hasAttribute(FORM_ROW_PRESS_DIP_ATTRIBUTE)).toBe(false);
    expect(still.element.getAttribute("style")).toBeNull();
    expect(() =>
      createFormRow(document, { getAction: () => null, label: "Sound", pressDip: -1, rule }),
    ).toThrow(RangeError);
  });

  it("dips a pressed row's art but never a disabled row's, and leaves a face to the theme", () => {
    const dip = /:where\(\s*(\.ui-form-row\[data-ui-form-press-dip\][^{]*)\)\s*\{([^}]*)\}/.exec(
      css,
    );
    expect(dip?.[1]).toContain('[data-ui-pressed]:not(:disabled, [aria-disabled="true"])');
    expect(dip?.[1]).toContain("> :not(.ui-button-face)");
    expect(dip?.[2]).toContain(
      "translate: 0 calc(var(--ui-form-row-press-dip, 0) * var(--ui-form-length))",
    );
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
    expect(css.replace(/\* -?1px\b|--ui-form-length: 1px;/g, "")).not.toMatch(/\d(px|rem|em)\b/);
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

  it("centres a one-action row's face in the whole row, without the list's padding", () => {
    const action = /:where\(\.ui-form-row\[data-ui-form-action\]\)\s*\{([^}]*)\}/.exec(css)?.[1];
    expect(action).toMatch(/(^|\s)padding: 0;/);
    expect(css.indexOf("padding: 0;")).toBeGreaterThan(css.indexOf("padding: calc("));
  });
});
