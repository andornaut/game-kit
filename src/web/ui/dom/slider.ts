import {
  checkSliderStep,
  checkSliderSteps,
  type SliderLayout,
  sliderPresentation,
  sliderStepAt,
  sliderStepForKey,
} from "../../../ui/slider.ts";
import { focusTarget } from "./focusModality.ts";
import {
  FORM_ROW_CLASS,
  FORM_ROW_ICON_CLASS,
  FORM_ROW_LABEL_CLASS,
  FORM_ROW_NOTE_CLASS,
  FORM_ROW_STATE_CLASS,
  FORM_ROW_TEXT_CLASS,
  FORM_ROW_VALUE_CLASS,
} from "./formRow.ts";
import { writeLayoutProperties } from "./layoutProperties.ts";
import { REFUSAL_ATTRIBUTES, type RefusalCue, refuse } from "./refusalCue.ts";
import { readUnit } from "./viewUnits.ts";

// The HTML slider row (slider.css with formRow.css): a form row in createFormRows' list, sharing
// its icon, label and value columns, whose first line holds the optional icon (one state-free
// frame of the game's art), the label and optional note, and the value word in the value column,
// placed as the list places a switch's state word. Under that line the lane spans the row's
// content: the game's three-slice track art (--ui-slider-track-image), the fill to the thumb's
// right edge (--ui-slider-fill-image) and the thumb (--ui-slider-thumb-image), each at its
// art-locked size, with disabled and pressed variants. The row is role slider with its step as
// aria-valuenow from 0 to steps and the value word as aria-valuetext; ArrowLeft, ArrowRight, Home
// and End step it, and a press anywhere on the row drags the thumb's centre along the track. A
// touch drags once it travels slop sideways, a tap sets the step where it lifts, and a vertical
// travel is left to the browser's scrolling. A refused slider keeps its focus and value and plays
// the game's refusal cue on a press or a step key.

export const SLIDER_CLASS = "ui-slider-row";
export const SLIDER_LANE_CLASS = "ui-slider-lane";
export const SLIDER_TRACK_CLASS = "ui-slider-track";
export const SLIDER_EMPTY_CLASS = "ui-slider-empty";
export const SLIDER_FILL_CLASS = "ui-slider-fill";
export const SLIDER_THUMB_CLASS = "ui-slider-thumb";

export interface SliderState {
  // The current step, a whole number from 0 to steps.
  readonly step: number;
  // Player text: the value word, such as 50% or Muted, shown and read as the value.
  readonly value: string;
  // A refused slider keeps its value; presses and step keys play the refusal cue.
  readonly refused?: boolean;
}

export interface SliderOptions {
  // Player text: the row's name, and its note, read as its description.
  readonly label: string;
  readonly note?: string;
  // The game's decorative icon art, one state-free frame.
  readonly icon?: Element;
  readonly steps: number;
  readonly layout: SliderLayout;
  // Read on each refresh and before each change.
  readonly getState: () => SliderState;
  // Sets the step; the slider refreshes after it.
  readonly change: (step: number) => void;
  // Told the step after a key changes it and when a drag or tap ends uncancelled.
  readonly commit?: (step: number) => void;
  // Base px a touch travels before it drags sideways or is left to scroll.
  readonly slop: number;
  // A caller guard, such as readiness or a modal scope: false ignores presses and keys and ends a
  // drag.
  readonly active?: () => boolean;
  // Plays the cue on a refused slider's press or step key.
  readonly refusal?: { readonly cue: RefusalCue; readonly reducedMotion: () => boolean };
  readonly className?: string;
}

export interface SliderView {
  readonly element: HTMLElement;
  readonly label: HTMLElement;
  readonly note: HTMLElement;
  // The value word.
  readonly value: HTMLElement;
  readonly track: HTMLElement;
  readonly thumb: HTMLElement;
  setLabel(label: string): void;
  setNote(note: string | undefined): void;
  // Applies layout. Throws, before any change, on an invalid layout.
  setLayout(layout: SliderLayout): void;
  // Reads the state and updates the value, the thumb and the row's state.
  refresh(): void;
  dispose(): void;
}

let sliders = 0;

function span(document: Document, className: string): HTMLElement {
  const element = document.createElement("span");
  element.className = className;
  return element;
}

interface Press {
  readonly id: number;
  readonly start: { readonly x: number; readonly y: number };
  // A touch is pending until it travels slop or lifts; vertical is left to scroll.
  mode: "pending" | "sliding" | "vertical" | "refused";
}

export function createSlider(document: Document, options: SliderOptions): SliderView {
  const { className, icon, steps } = options;
  checkSliderSteps(steps);
  if (!Number.isFinite(options.slop) || options.slop < 0) {
    throw new RangeError("slop must be finite and nonnegative");
  }
  sliders += 1;
  const id = `ui-slider-${sliders}`;
  const element = document.createElement("div");
  element.className = `${className ?? ""} ${FORM_ROW_CLASS} ${SLIDER_CLASS}`.trim();
  element.tabIndex = 0;
  element.setAttribute("role", "slider");
  element.setAttribute("aria-orientation", "horizontal");
  element.setAttribute("aria-valuemin", "0");
  element.setAttribute("aria-valuemax", String(steps));
  writeLayoutProperties({ "--ui-slider-steps": steps }, element);

  const iconCell = icon === undefined ? undefined : span(document, FORM_ROW_ICON_CLASS);
  if (icon !== undefined) {
    icon.setAttribute("aria-hidden", "true");
    iconCell!.append(icon);
  }
  const text = span(document, FORM_ROW_TEXT_CLASS);
  const label = span(document, FORM_ROW_LABEL_CLASS);
  label.id = `${id}-label`;
  label.setAttribute(REFUSAL_ATTRIBUTES.label, "");
  element.setAttribute("aria-labelledby", label.id);
  const note = span(document, FORM_ROW_NOTE_CLASS);
  note.id = `${id}-note`;
  note.setAttribute("aria-hidden", "true");
  text.append(label, note);
  const valueCell = span(document, FORM_ROW_VALUE_CLASS);
  const value = span(document, FORM_ROW_STATE_CLASS);
  value.setAttribute("aria-hidden", "true");
  value.setAttribute(REFUSAL_ATTRIBUTES.label, "");
  valueCell.append(value);
  const lane = span(document, SLIDER_LANE_CLASS);
  lane.setAttribute("aria-hidden", "true");
  const track = span(document, SLIDER_TRACK_CLASS);
  const thumb = span(document, SLIDER_THUMB_CLASS);
  track.append(span(document, SLIDER_EMPTY_CLASS), span(document, SLIDER_FILL_CLASS), thumb);
  lane.append(track);
  element.append(...(iconCell === undefined ? [] : [iconCell]), text, valueCell, lane);

  let layout = options.layout;
  let written: readonly string[] = [];
  const setLayout = (next: SliderLayout) => {
    const properties = sliderPresentation(next);
    for (const name of written) {
      if (!Object.hasOwn(properties, name)) {
        element.style.removeProperty(name);
      }
    }
    writeLayoutProperties(properties, element);
    written = Object.keys(properties);
    layout = next;
  };
  setLayout(layout);

  const setLabel = (next: string) => {
    if (next.trim() === "") {
      throw new RangeError("A slider requires a nonempty label");
    }
    label.textContent = next;
  };
  setLabel(options.label);
  const setNote = (next: string | undefined) => {
    const shown = next !== undefined && next !== "";
    note.textContent = shown ? next : "";
    note.hidden = !shown;
    if (shown) {
      element.setAttribute("aria-describedby", note.id);
    } else {
      element.removeAttribute("aria-describedby");
    }
  };
  setNote(options.note);

  let disposed = false;
  const state = () => {
    const current = options.getState();
    checkSliderStep(steps, current.step);
    return current;
  };
  const refresh = () => {
    const { refused, step, value: word } = state();
    element.setAttribute("aria-valuenow", String(step));
    element.setAttribute("aria-valuetext", word);
    if (refused === true) {
      element.setAttribute("aria-disabled", "true");
    } else {
      element.removeAttribute("aria-disabled");
    }
    if (value.textContent !== word) {
      value.textContent = word;
    }
    writeLayoutProperties({ "--ui-slider-step": step }, element);
  };
  refresh();

  const admitted = () =>
    !disposed &&
    element.isConnected &&
    element.closest("[inert], [hidden]") === null &&
    options.active?.() !== false;
  const playRefusal = () => {
    if (options.refusal !== undefined) {
      refuse(options.refusal.cue, options.refusal.reducedMotion(), element);
    }
  };
  // Sets the step unless refused, and returns whether the slider took it.
  const apply = (step: number): boolean => {
    const current = state();
    if (current.refused === true) {
      playRefusal();
      return false;
    }
    if (step !== current.step) {
      options.change(step);
      refresh();
    }
    return true;
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey || !admitted()) {
      return;
    }
    const before = state().step;
    const next = sliderStepForKey(steps, before, event.key);
    if (next === undefined) {
      return;
    }
    event.preventDefault();
    if (apply(next) && state().step !== before) {
      options.commit?.(state().step);
    }
  };

  // The step at a pointer's x, from the track as drawn: its width is a whole number of units.
  const stepAt = (event: PointerEvent) => {
    const unit = readUnit(element);
    const box = track.getBoundingClientRect();
    const width = Math.max(layout.art.thumb.width, Math.round(box.width / unit));
    return sliderStepAt({ art: layout.art, steps, width }, (event.clientX - box.left) / unit);
  };
  let press: Press | undefined;
  const listening = { capture: true } as const;
  const end = (cancelled: boolean) => {
    const ended = press;
    press = undefined;
    element.removeAttribute("data-ui-pressed");
    document.removeEventListener("pointermove", onMove, listening);
    document.removeEventListener("pointerup", onUp, listening);
    document.removeEventListener("pointercancel", onUp, listening);
    if (!cancelled && ended?.mode === "sliding") {
      options.commit?.(state().step);
    }
  };
  // Starts sliding, focused as a press focuses, without a keyboard ring.
  const slide = (current: Press, event: PointerEvent) => {
    current.mode = "sliding";
    focusTarget(element);
    if (apply(stepAt(event))) {
      element.setAttribute("data-ui-pressed", "");
    } else {
      current.mode = "refused";
    }
  };
  function onMove(event: PointerEvent) {
    const current = press;
    if (current === undefined || event.pointerId !== current.id) {
      return;
    }
    if (!admitted()) {
      end(true);
      return;
    }
    if (current.mode === "pending") {
      const unit = readUnit(element);
      const dx = Math.abs(event.clientX - current.start.x);
      const dy = Math.abs(event.clientY - current.start.y);
      if (Math.max(dx, dy) > options.slop * unit) {
        if (dy >= dx) {
          current.mode = "vertical";
        } else {
          slide(current, event);
        }
      }
    } else if (current.mode === "sliding" && !apply(stepAt(event))) {
      current.mode = "refused";
    }
  }
  function onUp(event: PointerEvent) {
    const current = press;
    if (current === undefined || event.pointerId !== current.id) {
      return;
    }
    const cancelled = event.type === "pointercancel" || !admitted();
    if (!cancelled && current.mode === "pending") {
      slide(current, event);
    } else if (!cancelled && current.mode === "sliding") {
      apply(stepAt(event));
    }
    end(cancelled);
  }
  const onDown = (event: PointerEvent) => {
    if (press !== undefined || event.button !== 0 || !admitted()) {
      return;
    }
    const current: Press = {
      id: event.pointerId,
      mode: "pending",
      start: { x: event.clientX, y: event.clientY },
    };
    press = current;
    document.addEventListener("pointermove", onMove, listening);
    document.addEventListener("pointerup", onUp, listening);
    document.addEventListener("pointercancel", onUp, listening);
    if (event.pointerType !== "touch") {
      // No text selection or native drag.
      event.preventDefault();
      slide(current, event);
    }
  };
  element.addEventListener("pointerdown", onDown);
  element.addEventListener("keydown", onKey);

  return {
    dispose() {
      if (disposed) {
        return;
      }
      end(true);
      disposed = true;
      element.removeEventListener("pointerdown", onDown);
      element.removeEventListener("keydown", onKey);
    },
    element,
    label,
    note,
    refresh() {
      if (!disposed) {
        refresh();
      }
    },
    setLabel,
    setLayout,
    setNote,
    thumb,
    track,
    value,
  };
}
