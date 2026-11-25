import { type FormRowLayout, formRowPresentation } from "../../../ui/index.ts";
import { type ButtonOptions, type ButtonState, type ButtonView, createButton } from "./button.ts";
import { writeLayoutProperties } from "./layoutProperties.ts";
import { REFUSAL_ATTRIBUTES } from "./refusalCue.ts";

// The HTML form rows (formRow.css): a list element whose grid columns its rows share, and rows
// that are each one standard button (button.ts), so the whole row is the press target with the
// kit's hold, availability and refusal paths. A row holds an optional icon (one state-free frame
// of the game's art), its label and optional note, and a trailing value stack: a switch (the
// game's two ui-switch frames as --ui-switch-on-image and --ui-switch-off-image) over its state
// word, or a value. A switch row is role switch with aria-checked; the stack is decorative and
// the label is the row's name. Rows take the theme's button state slots with a clear idle face,
// controls.css's one focus fill and no press dip.

export const FORM_ROWS_CLASS = "ui-form-rows";
export const FORM_ROW_CLASS = "ui-form-row";
export const FORM_ROW_ICON_CLASS = "ui-form-row-icon";
export const FORM_ROW_TEXT_CLASS = "ui-form-row-text";
export const FORM_ROW_LABEL_CLASS = "ui-form-row-label";
export const FORM_ROW_NOTE_CLASS = "ui-form-row-note";
export const FORM_ROW_VALUE_CLASS = "ui-form-row-value";
export const FORM_ROW_STATE_CLASS = "ui-form-row-state";
export const SWITCH_CLASS = "ui-switch";

export interface FormRowsView {
  readonly element: HTMLElement;
  // Applies layout to the list. Throws, before any change, on an invalid layout.
  setLayout(layout: FormRowLayout): void;
}

export function createFormRows(
  document: Document,
  layout: FormRowLayout,
  options: { readonly className?: string } = {},
): FormRowsView {
  const element = document.createElement("div");
  element.className = `${options.className ?? ""} ${FORM_ROWS_CLASS}`.trim();
  let written: readonly string[] = [];
  const setLayout = (next: FormRowLayout) => {
    const { attributes, properties } = formRowPresentation(next);
    for (const name of written) {
      if (!Object.hasOwn(properties, name)) {
        element.style.removeProperty(name);
      }
    }
    writeLayoutProperties(properties, element);
    written = Object.keys(properties);
    for (const [name, value] of Object.entries(attributes)) {
      element.setAttribute(name, value);
    }
  };
  setLayout(layout);
  return { element, setLayout };
}

// A row's state: the button's availability and selection, whether a switch is on, and the
// visible value text (a switch's state word, such as On or Shown; a value row's value).
export interface FormRowState extends Omit<ButtonState, "toggled"> {
  readonly checked?: boolean;
  readonly value?: string;
}

export interface FormRowOptions extends Omit<ButtonOptions, "appearance" | "content" | "getState"> {
  // Player text: the row's name, and its note, read as its description.
  readonly label: string;
  readonly note?: string;
  // The game's decorative icon art, one state-free frame.
  readonly icon?: Element;
  // Makes the row a switch.
  readonly switch?: boolean;
  readonly getState?: (element: HTMLButtonElement) => FormRowState;
  readonly className?: string;
}

export interface FormRowView {
  readonly element: HTMLButtonElement;
  readonly label: HTMLElement;
  readonly note: HTMLElement;
  readonly value: HTMLElement;
  readonly state: HTMLElement;
  // The switch track, on a switch row.
  readonly switch?: HTMLElement;
  setLabel(label: string): void;
  setNote(note: string | undefined): void;
  refresh(): void;
  setPressed(pressed: boolean): void;
  holdAction: ButtonView["holdAction"];
  dispose(): void;
}

let rows = 0;

function span(document: Document, className: string): HTMLElement {
  const element = document.createElement("span");
  element.className = className;
  return element;
}

export function createFormRow(document: Document, options: FormRowOptions): FormRowView {
  const { className, getState, icon, label, note: noteText, ...button } = options;
  rows += 1;
  const id = `ui-form-row-${rows}`;
  const iconCell = icon === undefined ? undefined : span(document, FORM_ROW_ICON_CLASS);
  if (icon !== undefined) {
    icon.setAttribute("aria-hidden", "true");
    iconCell!.append(icon);
  }
  const text = span(document, FORM_ROW_TEXT_CLASS);
  const note = span(document, FORM_ROW_NOTE_CLASS);
  note.id = `${id}-note`;
  note.setAttribute("aria-hidden", "true");
  const value = span(document, FORM_ROW_VALUE_CLASS);
  const track = options.switch === true ? span(document, SWITCH_CLASS) : undefined;
  const state = span(document, FORM_ROW_STATE_CLASS);
  state.id = `${id}-value`;
  state.setAttribute("aria-hidden", "true");
  state.setAttribute(REFUSAL_ATTRIBUTES.label, "");
  value.append(...(track === undefined ? [] : [track]), state);
  let noteShown = false;
  const describe = (element: HTMLElement, valueShown: boolean) => {
    const ids = [
      ...(noteShown ? [note.id] : []),
      ...(valueShown && track === undefined ? [state.id] : []),
    ];
    if (ids.length === 0) {
      element.removeAttribute("aria-describedby");
    } else {
      element.setAttribute("aria-describedby", ids.join(" "));
    }
  };
  let valueShown = false;
  const view = createButton(document, {
    ...button,
    appearance: { className: `${className ?? ""} ${FORM_ROW_CLASS}`.trim(), layout: "caller" },
    content: { kind: "text", label },
    getState: (element) => {
      const { checked, value: shown, ...rest } = getState?.(element) ?? {};
      if (track !== undefined) {
        element.setAttribute("role", "switch");
        element.setAttribute("aria-checked", String(checked === true));
      }
      if (state.textContent !== (shown ?? "")) {
        state.textContent = shown ?? "";
      }
      state.hidden = shown === undefined;
      valueShown = shown !== undefined;
      describe(element, valueShown);
      return rest;
    },
  });
  const labelSlot = view.face.firstElementChild as HTMLElement;
  const markLabel = () => {
    labelSlot.classList.remove("ui-control-label");
    labelSlot.classList.add(FORM_ROW_LABEL_CLASS);
    labelSlot.setAttribute(REFUSAL_ATTRIBUTES.label, "");
  };
  markLabel();
  text.append(labelSlot, note);
  view.element.append(...(iconCell === undefined ? [] : [iconCell]), text, value);
  const setNote = (next: string | undefined) => {
    noteShown = next !== undefined && next !== "";
    note.textContent = noteShown ? next! : "";
    note.hidden = !noteShown;
    describe(view.element, valueShown);
  };
  setNote(noteText);
  return {
    dispose: () => view.dispose(),
    element: view.element,
    holdAction: () => view.holdAction(),
    label: labelSlot,
    note,
    refresh: () => view.refresh(),
    setLabel(next) {
      view.setContent({ kind: "text", label: next });
      markLabel();
    },
    setNote,
    setPressed: (pressed) => view.setPressed(pressed),
    state,
    ...(track === undefined ? {} : { switch: track }),
    value,
  };
}
