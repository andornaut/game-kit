import type { Point } from "../../../../rect.ts";
import type { ActionProjection } from "../../../../ui/actions/actionGroup.ts";
import type { ButtonRole } from "../../../../ui/actions/buttonLayout.ts";
import {
  type FormRowLayout,
  formRowPresentation,
  type FormRowsGeometry,
  formRowsGeometry,
} from "../../../../ui/layout/formRow.ts";
import { writeLayoutProperties } from "../layoutProperties.ts";
import { REFUSAL_ATTRIBUTES } from "../refusalCue.ts";
import { type ButtonOptions, type ButtonState, type ButtonView, createButton } from "./button.ts";
import { placedBoxes, rowHooks } from "./placedRows.ts";

// The HTML form rows (formRow.css): a list element whose grid columns its rows share, and rows
// that are each one standard button (button.ts), so the whole row is the press target with the
// kit's hold, availability and refusal paths. A row holds an optional icon (one state-free frame
// of the game's art), its label and optional note, and a trailing value stack: a switch (the
// game's two ui-switch frames as --ui-switch-on-image and --ui-switch-off-image) over its state
// word, or a value. A switch row is role switch with aria-checked; the stack is decorative and
// the label is the row's name. Rows take the theme's button state slots with a clear idle face,
// controls.css's one focus fill and no press dip unless the row sets pressDip, which moves its art
// down while pressed and never while disabled. A one-action row hosts one standard button face
// (the label, and the icon before it) centred in the whole row, padding included; the row stays
// the button and its whole press target, and the face dips by the theme's --ui-button-press-dip,
// as a standard button's does.
// A placed list (place) writes every track and part in whole CSS px from the game's projected
// edges instead, so pixel art lands on the game's grid, and with artPixel keeps art at its size.

export const FORM_ROWS_CLASS = "ui-form-rows";
export const FORM_ROW_CLASS = "ui-form-row";
export const FORM_ROW_ICON_CLASS = "ui-form-row-icon";
export const FORM_ROW_TEXT_CLASS = "ui-form-row-text";
export const FORM_ROW_LABEL_CLASS = "ui-form-row-label";
export const FORM_ROW_NOTE_CLASS = "ui-form-row-note";
export const FORM_ROW_VALUE_CLASS = "ui-form-row-value";
export const FORM_ROW_STATE_CLASS = "ui-form-row-state";
export const SWITCH_CLASS = "ui-switch";
export const FORM_ROW_FACE_CLASS = "ui-form-row-face";
export const FORM_ROWS_PROJECTED_ATTRIBUTE = "data-ui-form-projected";
export const FORM_ROW_ACTION_ATTRIBUTE = "data-ui-form-action";
export const FORM_ROW_PRESS_DIP_ATTRIBUTE = "data-ui-form-press-dip";

// Where a placed list is: its width and corner in the game's units, the projection to the
// caller's CSS px, as for arrangeActions, and artPixel, the whole CSS px of one art pixel, which
// keeps the icons, switches and slider art at their art size from their projected corners. The
// list element's corner is at the projected origin.
export interface DomFormRowsContext {
  readonly project: ActionProjection;
  readonly width: number;
  readonly origin?: Point;
  readonly artPixel?: number;
}

// A row to place: the list's own kit row, the gap above it from the previous shown row in whole
// units, the layout's gap by default, and its height in whole units, by default a slider's
// layout.height or the layout's height.
export interface PlacedFormRowEntry {
  readonly element: HTMLElement;
  readonly gap?: number;
  readonly height?: number;
}

export interface FormRowsView {
  readonly element: HTMLElement;
  // Applies layout to the list, and on a placed list places it again. Throws, before any change,
  // on an invalid layout.
  setLayout(layout: FormRowLayout): void;
  // Places the list on the game's grid (formRowsGeometry): rows, the list's own kit rows
  // (createFormRow, createSlider) in its order, each its own height (the entry's, a slider's or the
  // layout's), the shown ones each its gap below the one before (the layout's gap by default);
  // every track and part in whole CSS px from the projected edges. The layout needs value.track
  // and a slider row its layout's line. Place again after rows show, hide or change their layout,
  // and after the projection changes. Returns the projected layout and units, the layout before
  // projection, for the game's own ink. Throws RangeError before any change.
  place(
    context: DomFormRowsContext,
    rows: readonly PlacedFormRowEntry[],
  ): { readonly placed: FormRowsGeometry; readonly units: FormRowsGeometry };
}

export function createFormRows(
  document: Document,
  layout: FormRowLayout,
  options: { readonly className?: string } = {},
): FormRowsView {
  const element = document.createElement("div");
  element.className = `${options.className ?? ""} ${FORM_ROWS_CLASS}`.trim();
  let written: readonly string[] = [];
  let current = layout;
  let placement: { context: DomFormRowsContext; rows: readonly PlacedFormRowEntry[] } | undefined;
  const placeRows = (
    next: FormRowLayout,
    context: DomFormRowsContext,
    rows: readonly PlacedFormRowEntry[],
  ) => {
    for (const row of rows) {
      if (row.element.parentElement !== element || !rowHooks.has(row.element)) {
        throw new RangeError("Placed rows must be the list's own kit rows");
      }
    }
    const shown = rows.filter((row) => row.element.hidden === false);
    const { artPixel, project } = context;
    const base = {
      ...(context.origin === undefined ? {} : { origin: context.origin }),
      rows: shown.map((row) => ({
        ...rowHooks.get(row.element)!.entry(),
        ...(row.gap === undefined ? {} : { gap: row.gap }),
        ...(row.height === undefined ? {} : { height: row.height }),
      })),
      width: context.width,
    };
    const units = formRowsGeometry(next, base);
    const placed = formRowsGeometry(next, {
      ...base,
      ...(artPixel === undefined ? {} : { artPixel }),
      project,
    });
    // The columns follow the edges, not the art: an art-locked icon starts its column.
    const tracks = listTracks(
      artPixel === undefined ? placed : formRowsGeometry(next, { ...base, project }),
    );
    const writes = shown.map((row, i) => {
      const lane = units.rows[i]!.lane;
      return rowHooks.get(row.element)!.place({
        box: placed.rows[i]!.row,
        properties: rowLengths(next, project, placed.rows[i]!, units.rows[i]!),
        ...(lane === undefined
          ? {}
          : { lane: { ...(artPixel === undefined ? {} : { artPixel }), project, units: lane } }),
      });
    });
    return {
      result: { placed, units },
      write() {
        writeLayoutProperties(tracks, element);
        element.setAttribute(FORM_ROWS_PROJECTED_ATTRIBUTE, "");
        for (const row of rows) {
          placedBoxes.delete(row.element);
        }
        shown.forEach((row, i) => {
          placedBoxes.set(row.element, placed.rows[i]!.row);
          writes[i]!();
        });
      },
    };
  };
  const setLayout = (next: FormRowLayout) => {
    const { attributes, properties } = formRowPresentation(next);
    const placing =
      placement === undefined ? undefined : placeRows(next, placement.context, placement.rows);
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
    current = next;
    placing?.write();
  };
  setLayout(layout);
  return {
    element,
    place(context, rows) {
      const placing = placeRows(current, context, rows);
      placement = { context, rows: [...rows] };
      placing.write();
      return placing.result;
    },
    setLayout,
  };
}

// The list's explicit tracks, in CSS px between projected edges: the columns with the padding,
// the icon slot's sides and the gaps as their own tracks, and each row's pitch to the next row.
function listTracks(placed: FormRowsGeometry): Record<string, string> {
  const first = placed.rows[0];
  if (first === undefined) {
    return { "--ui-form-columns": "none", "--ui-form-rows": "none" };
  }
  const { icon, label, row, slot, value } = first;
  const px = (length: number) => `${length}px`;
  const right = (rect: { width: number; x: number }) => rect.x + rect.width;
  const columns =
    icon === undefined || slot === undefined
      ? [px(label.x - row.x), "[label]"]
      : [
          px(slot.x - row.x),
          px(icon.x - slot.x),
          "[icon]",
          px(icon.width),
          px(label.x - right(icon)),
          "[label]",
        ];
  columns.push(
    px(label.width),
    px(value.x - right(label)),
    "[value]",
    px(value.width),
    px(right(row) - right(value)),
  );
  const rows = placed.rows.map((entry, i) => {
    const next = placed.rows[i + 1];
    return px(next === undefined ? entry.row.height : next.row.y - entry.row.y);
  });
  return { "--ui-form-columns": columns.join(" "), "--ui-form-rows": rows.join(" ") };
}

// A placed row's lengths in CSS px, each between projected edges, written on the row over the
// list's base px. Its padding across is in the list's tracks.
function rowLengths(
  layout: FormRowLayout,
  project: ActionProjection,
  placed: FormRowsGeometry["rows"][number],
  units: FormRowsGeometry["rows"][number],
): Record<string, number> {
  const { content, face, icon, line, row, stack, value } = placed;
  const bottom = (rect: { height: number; y: number }) => rect.y + rect.height;
  const valueRight = units.value.x + units.value.width;
  const lengths: Record<string, number> = {
    "--ui-form-row-height": row.height,
    "--ui-form-row-padding-bottom": bottom(row) - bottom(content),
    "--ui-form-row-padding-left": 0,
    "--ui-form-row-padding-right": 0,
    "--ui-form-row-padding-top": content.y - row.y,
    "--ui-form-state-bearing":
      project.x(valueRight) - project.x(valueRight - (layout.value?.bearing ?? 0)),
    "--ui-form-switch-end": 0,
    "--ui-form-value-gap": 0,
    "--ui-form-value-offset": stack.y - line.y,
    "--ui-switch-height": 0,
    "--ui-switch-width": 0,
  };
  if (icon !== undefined) {
    lengths["--ui-form-icon-height"] = icon.height;
    lengths["--ui-form-icon-offset"] = icon.y - line.y;
    lengths["--ui-form-icon-size"] = icon.width;
  }
  if (placed.switch !== undefined && units.switch !== undefined) {
    const end = bottom(units.switch);
    lengths["--ui-form-switch-end"] =
      value.x + value.width - (placed.switch.x + placed.switch.width);
    lengths["--ui-form-value-gap"] = project.y(end + (layout.value?.gap ?? 0)) - project.y(end);
    lengths["--ui-switch-height"] = placed.switch.height;
    lengths["--ui-switch-width"] = placed.switch.width;
  }
  if (face !== undefined) {
    lengths["--ui-form-action-height"] = face.height;
    lengths["--ui-form-action-left"] = face.x - row.x;
    lengths["--ui-form-action-top"] = face.y - row.y;
    lengths["--ui-form-action-width"] = face.width;
  }
  if (placed.pressDip !== undefined) {
    lengths["--ui-form-row-press-dip"] = placed.pressDip;
  }
  if (placed.lane !== undefined) {
    lengths["--ui-slider-gap"] = placed.lane.y - bottom(line);
    lengths["--ui-slider-inset-left"] = placed.lane.x - row.x;
    lengths["--ui-slider-inset-right"] = row.x + row.width - (placed.lane.x + placed.lane.width);
    lengths["--ui-slider-line"] = line.height;
  }
  return lengths;
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
  // Makes the row a one-action row: the label (and the icon before it) on one standard button
  // face of this whole-unit size, in the game's className and role, centred in the whole row, its
  // padding included. It takes no switch, note or value.
  readonly action?: {
    readonly size: { readonly height: number; readonly width: number };
    readonly className?: string;
    readonly role?: ButtonRole;
  };
  // Whole units the row's art (every child but a one-action row's face) moves down while it is
  // pressed and not disabled.
  readonly pressDip?: number;
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
  // The face, on a one-action row.
  readonly face?: HTMLElement;
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

// A whole number of units, at least 0. Throws RangeError otherwise.
function checkWhole(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a whole number of units, at least 0`);
  }
}

export function createFormRow(document: Document, options: FormRowOptions): FormRowView {
  const { action, className, getState, icon, label, note: noteText, pressDip, ...button } = options;
  if (pressDip !== undefined) {
    checkWhole("pressDip", pressDip);
  }
  if (action !== undefined) {
    checkWhole("action.size.width", action.size.width);
    checkWhole("action.size.height", action.size.height);
    if (action.size.width < 1 || action.size.height < 1) {
      throw new RangeError("A one-action row's face must be at least 1 unit across and down");
    }
    if (options.switch === true || (noteText !== undefined && noteText !== "")) {
      throw new RangeError("A one-action row takes no switch or note");
    }
  }
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
  const rowClass = `${className ?? ""} ${FORM_ROW_CLASS}`.trim();
  const view = createButton(document, {
    ...button,
    appearance:
      action === undefined
        ? { className: rowClass, layout: "caller" }
        : {
            className: rowClass,
            face: { className: `${action.className ?? ""} ${FORM_ROW_FACE_CLASS}`.trim() },
            layout: "caller",
            ...(action.role === undefined ? {} : { role: action.role }),
          },
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
      valueShown = action === undefined && shown !== undefined;
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
  if (action === undefined) {
    text.append(labelSlot, note);
    view.element.append(...(iconCell === undefined ? [] : [iconCell]), text, value);
  } else {
    view.element.setAttribute(FORM_ROW_ACTION_ATTRIBUTE, "");
    writeLayoutProperties(
      {
        "--ui-form-action-height": action.size.height,
        "--ui-form-action-width": action.size.width,
      },
      view.element,
    );
    if (iconCell !== undefined) {
      view.face.prepend(iconCell);
    }
  }
  if (pressDip !== undefined) {
    view.element.setAttribute(FORM_ROW_PRESS_DIP_ATTRIBUTE, "");
    writeLayoutProperties({ "--ui-form-row-press-dip": pressDip }, view.element);
  }
  const setNote = (next: string | undefined) => {
    if (action !== undefined && next !== undefined && next !== "") {
      throw new RangeError("A one-action row takes no note");
    }
    noteShown = next !== undefined && next !== "";
    note.textContent = noteShown ? next! : "";
    note.hidden = !noteShown;
    describe(view.element, valueShown);
  };
  setNote(noteText);
  rowHooks.set(view.element, {
    entry: () => ({
      switch: track !== undefined,
      ...(action === undefined ? {} : { action: action.size }),
      ...(pressDip === undefined ? {} : { pressDip }),
    }),
    place: (placement) => () => writeLayoutProperties(placement.properties, view.element),
  });
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
    ...(action === undefined ? {} : { face: view.face }),
    value,
  };
}
