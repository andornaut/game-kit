// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { SliderArt } from "../../../ui/slider.ts";
import {
  createFormRows,
  FORM_ROW_CLASS,
  FORM_ROW_ICON_CLASS,
  FORM_ROW_STATE_CLASS,
  FORM_ROW_TEXT_CLASS,
  FORM_ROW_VALUE_CLASS,
} from "./formRow.ts";
import { REFUSAL_ATTRIBUTES } from "./refusalCue.ts";
import {
  createSlider,
  SLIDER_CLASS,
  SLIDER_LANE_CLASS,
  type SliderOptions,
  type SliderState,
} from "./slider.ts";

const ART: SliderArt = {
  thumb: { height: 16, width: 10 },
  track: { caps: { left: 4, right: 4 }, height: 10 },
};
const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "");
const css = strip(readFileSync(join(import.meta.dirname, "slider.css"), "utf8"));
const formCss = strip(readFileSync(join(import.meta.dirname, "formRow.css"), "utf8"));

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

// A volume slider in a form row list, its track 280 units wide from x 100 at a unit of 2 px.
function fixture(overrides: Partial<SliderOptions> = {}, initial: Partial<SliderState> = {}) {
  let state: SliderState = { step: 10, value: "50%", ...initial };
  const change = vi.fn((step: number) => {
    state = { ...state, step, value: `${step * 5}%` };
  });
  const commit = vi.fn();
  const rows = createFormRows(document, { columnGap: 4, height: 48, icon: { size: 16, slot: 16 } });
  document.body.append(rows.element);
  const slider = createSlider(document, {
    change,
    commit,
    getState: () => state,
    icon: document.createElement("img"),
    label: "Music",
    layout: { art: ART, gap: 2, height: 56 },
    slop: 4,
    steps: 20,
    ...overrides,
  });
  rows.element.append(slider.element);
  slider.element.style.setProperty("--ui-unit", "2");
  vi.spyOn(slider.track, "getBoundingClientRect").mockReturnValue({
    bottom: 20,
    height: 20,
    left: 100,
    right: 660,
    toJSON: () => ({}),
    top: 0,
    width: 560,
    x: 100,
    y: 0,
  });
  const set = (next: Partial<SliderState>) => {
    state = { ...state, ...next };
    slider.refresh();
  };
  return { change, commit, rows, set, slider };
}

// The client x of the thumb's centre at step, on the fixture's track.
const at = (step: number) => 100 + 2 * (5 + Math.round((270 * step) / 20));

function pointer(
  type: string,
  target: EventTarget,
  init: { x: number; y?: number; id?: number; pointerType?: string },
) {
  const event = new PointerEvent(type, {
    bubbles: true,
    button: 0,
    cancelable: true,
    clientX: init.x,
    clientY: init.y ?? 10,
    pointerId: init.id ?? 1,
    pointerType: init.pointerType ?? "mouse",
  });
  target.dispatchEvent(event);
  return event;
}

function key(target: HTMLElement, name: string) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: name });
  target.dispatchEvent(event);
  return event;
}

describe("createSlider", () => {
  it("is a form row with native slider semantics and the value word in the value column", () => {
    const { slider } = fixture({ note: "Background music." });
    const { element } = slider;
    expect(element.tagName).toBe("DIV");
    expect(element.classList.contains(FORM_ROW_CLASS)).toBe(true);
    expect(element.classList.contains(SLIDER_CLASS)).toBe(true);
    expect(element.tabIndex).toBe(0);
    expect(element.getAttribute("role")).toBe("slider");
    expect(element.getAttribute("aria-valuemin")).toBe("0");
    expect(element.getAttribute("aria-valuemax")).toBe("20");
    expect(element.getAttribute("aria-valuenow")).toBe("10");
    expect(element.getAttribute("aria-valuetext")).toBe("50%");
    expect(element.getAttribute("aria-labelledby")).toBe(slider.label.id);
    expect(element.getAttribute("aria-describedby")).toBe(slider.note.id);
    expect(slider.label.textContent).toBe("Music");
    expect([...element.children].map((child) => child.className)).toEqual([
      FORM_ROW_ICON_CLASS,
      FORM_ROW_TEXT_CLASS,
      FORM_ROW_VALUE_CLASS,
      SLIDER_LANE_CLASS,
    ]);
    expect(slider.value.className).toBe(FORM_ROW_STATE_CLASS);
    expect(slider.value.textContent).toBe("50%");
    expect(slider.value.getAttribute("aria-hidden")).toBe("true");
    expect(element.querySelector(`.${SLIDER_LANE_CLASS}`)!.getAttribute("aria-hidden")).toBe(
      "true",
    );
    for (const text of [slider.label, slider.value]) {
      expect(text.hasAttribute(REFUSAL_ATTRIBUTES.label)).toBe(true);
    }
    expect(element.style.getPropertyValue("--ui-slider-step")).toBe("10");
    expect(element.style.getPropertyValue("--ui-slider-steps")).toBe("20");
    expect(element.style.getPropertyValue("--ui-slider-thumb-width")).toBe("10");
    expect(element.style.getPropertyValue("--ui-form-row-height")).toBe("56");
    slider.setNote(undefined);
    expect(element.hasAttribute("aria-describedby")).toBe(false);
    expect(slider.note.hidden).toBe(true);
  });

  it("steps with ArrowLeft, ArrowRight, Home and End and commits each change", () => {
    const { change, commit, slider } = fixture();
    const { element } = slider;
    expect(key(element, "ArrowRight").defaultPrevented).toBe(true);
    expect(change).toHaveBeenLastCalledWith(11);
    expect(commit).toHaveBeenLastCalledWith(11);
    expect(element.getAttribute("aria-valuenow")).toBe("11");
    expect(element.getAttribute("aria-valuetext")).toBe("55%");
    expect(slider.value.textContent).toBe("55%");
    key(element, "ArrowLeft");
    key(element, "Home");
    expect(change).toHaveBeenLastCalledWith(0);
    commit.mockClear();
    key(element, "ArrowLeft");
    expect(commit).not.toHaveBeenCalled();
    key(element, "End");
    expect(element.getAttribute("aria-valuenow")).toBe("20");
    expect(key(element, "ArrowUp").defaultPrevented).toBe(false);
    expect(change).toHaveBeenCalledTimes(4);
  });

  it("drags the thumb's centre along the track from a mouse press anywhere on the row", () => {
    const { change, commit, slider } = fixture();
    const { element } = slider;
    const down = pointer("pointerdown", slider.label, { x: 0 });
    expect(down.defaultPrevented).toBe(true);
    expect(change).toHaveBeenLastCalledWith(0);
    expect(element.hasAttribute("data-ui-pressed")).toBe(true);
    pointer("pointermove", document, { x: at(7) });
    expect(change).toHaveBeenLastCalledWith(7);
    pointer("pointermove", document, { id: 2, x: at(15) });
    expect(change).toHaveBeenLastCalledWith(7);
    expect(commit).not.toHaveBeenCalled();
    pointer("pointerup", document, { x: at(19) });
    expect(change).toHaveBeenLastCalledWith(19);
    expect(commit).toHaveBeenCalledWith(19);
    expect(element.hasAttribute("data-ui-pressed")).toBe(false);
    pointer("pointermove", document, { x: at(3) });
    expect(change).toHaveBeenLastCalledWith(19);
  });

  it("drags a touch once it travels sideways, taps where it lifts and leaves vertical to scroll", () => {
    const { change, commit, slider } = fixture();
    const { element } = slider;
    const touch = { pointerType: "touch" };
    pointer("pointerdown", element, { ...touch, x: at(4) });
    expect(change).not.toHaveBeenCalled();
    pointer("pointermove", document, { ...touch, x: at(4) + 6 });
    expect(change).not.toHaveBeenCalled();
    pointer("pointermove", document, { ...touch, x: at(6) });
    expect(change).toHaveBeenLastCalledWith(6);
    pointer("pointerup", document, { ...touch, x: at(6) });
    expect(commit).toHaveBeenCalledWith(6);

    change.mockClear();
    commit.mockClear();
    pointer("pointerdown", element, { ...touch, x: at(12) });
    pointer("pointerup", document, { ...touch, x: at(12) });
    expect(change).toHaveBeenCalledWith(12);
    expect(commit).toHaveBeenCalledWith(12);
    expect(document.activeElement).toBe(element);

    change.mockClear();
    commit.mockClear();
    pointer("pointerdown", element, { ...touch, x: at(2), y: 10 });
    pointer("pointermove", document, { ...touch, x: at(2) + 4, y: 40 });
    pointer("pointerup", document, { ...touch, x: at(2) + 4, y: 40 });
    expect(change).not.toHaveBeenCalled();

    pointer("pointerdown", element, { ...touch, x: at(2) });
    pointer("pointermove", document, { ...touch, x: at(9) });
    pointer("pointercancel", document, { ...touch, x: at(9) });
    expect(change).toHaveBeenLastCalledWith(9);
    expect(commit).not.toHaveBeenCalled();
    expect(element.hasAttribute("data-ui-pressed")).toBe(false);
  });

  it("keeps a refused slider's value and plays the refusal cue on a press or a step key", () => {
    vi.useFakeTimers();
    const { change, commit, set, slider } = fixture({
      refusal: { cue: { shake: 2, stepMs: 50, steps: 4 }, reducedMotion: () => true },
    });
    const { element } = slider;
    set({ refused: true, value: "Muted" });
    expect(element.getAttribute("aria-disabled")).toBe("true");
    expect(element.getAttribute("aria-valuetext")).toBe("Muted");
    expect(element.tabIndex).toBe(0);
    expect(key(element, "ArrowRight").defaultPrevented).toBe(true);
    expect(element.hasAttribute(REFUSAL_ATTRIBUTES.red)).toBe(true);
    vi.advanceTimersByTime(200);
    expect(element.hasAttribute(REFUSAL_ATTRIBUTES.red)).toBe(false);
    pointer("pointerdown", element, { x: at(3) });
    expect(element.hasAttribute(REFUSAL_ATTRIBUTES.red)).toBe(true);
    expect(element.hasAttribute("data-ui-pressed")).toBe(false);
    pointer("pointermove", document, { x: at(5) });
    pointer("pointerup", document, { x: at(5) });
    expect(change).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    set({ refused: false, value: "50%" });
    expect(element.hasAttribute("aria-disabled")).toBe(false);
  });

  it("ignores input while the caller's guard is closed and ends a drag when it closes", () => {
    let open = false;
    const { change, commit, slider } = fixture({ active: () => open });
    const { element } = slider;
    key(element, "ArrowRight");
    pointer("pointerdown", element, { x: at(3) });
    pointer("pointerup", document, { x: at(3) });
    expect(change).not.toHaveBeenCalled();
    open = true;
    pointer("pointerdown", element, { x: at(3) });
    open = false;
    pointer("pointermove", document, { x: at(8) });
    expect(change).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
    expect(element.hasAttribute("data-ui-pressed")).toBe(false);
  });

  it("rejects invalid steps, layouts and labels, and stops on dispose", () => {
    expect(() => fixture({ steps: 0 })).toThrow(RangeError);
    expect(() => fixture({}, { step: 21 })).toThrow(RangeError);
    expect(() => fixture({ label: " " })).toThrow(RangeError);
    const { change, slider } = fixture();
    expect(() => slider.setLayout({ art: ART, gap: 0.5 })).toThrow(RangeError);
    expect(slider.element.style.getPropertyValue("--ui-slider-gap")).toBe("2");
    slider.setLayout({ art: ART });
    expect(slider.element.style.getPropertyValue("--ui-form-row-height")).toBe("");
    slider.dispose();
    key(slider.element, "ArrowRight");
    pointer("pointerdown", slider.element, { x: at(3) });
    expect(change).not.toHaveBeenCalled();
  });
});

describe("slider.css", () => {
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
    expect(css).not.toMatch(/\bbox-shadow\s*:/);
    expect(css.match(/\boutline\s*:[^;]*/g)).toEqual(["outline: none"]);
    expect(css.replace(/\* -?1px\b/g, "")).not.toMatch(/\d(px|rem|em)\b/);
  });

  it("puts the track on whole units and the thumb on a whole unit at its step", () => {
    expect(css).toContain("width: round(down, 100%, var(--ui-unit, 1) * 1px)");
    const thumb = /:where\(\.ui-slider-track > \.ui-slider-thumb\)\s*\{([^}]*)\}/.exec(css)?.[1];
    expect(thumb).toMatch(/left: round\(\s*nearest,/);
    expect(css).toMatch(
      /border-image-slice: 0 var\(--ui-slider-cap-right, 0\) 0 var\(--ui-slider-cap-left, 0\) fill/,
    );
  });

  it("fills the row for state inside a theme, with the focus slots last", () => {
    const fills = [...css.matchAll(/:where\(\[data-ui-theme\] \.ui-slider-row([^)]*\)?)\)\s*\{/g)]
      .map((match) => match[1])
      .slice(0, 4);
    expect(fills).toEqual(["", "[data-ui-pressed]", '[aria-disabled="true"]', ":focus-visible"]);
    expect(css).toContain("background-color: var(--ui-button-focus-fill, Highlight)");
    expect(css).toMatch(/forced-colors: active[\s\S]*Highlight[\s\S]*GrayText/);
  });

  it("leaves vertical pans to the browser on a slider row", () => {
    expect(formCss).toMatch(/:where\(\.ui-form-row\[role="slider"\]\)\s*\{\s*touch-action: pan-y;/);
  });
});
