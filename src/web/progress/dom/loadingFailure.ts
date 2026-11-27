import { LOADING_FAILURE_TEXT, type LoadingAttemptState } from "../../../load/index.ts";
import { colourProperty, type TextRole, type UiColourRole } from "../../../ui/uiTheme.ts";
import type { HoldActionBinding } from "../../input/dom/index.ts";
import type { ForegroundInput } from "../../ui/dom/foregroundInput.ts";
import { createNativeButton } from "../../ui/dom/nativeButton.ts";
import { paintRetryFocus } from "./retryFocus.ts";

export interface LoadingFailureLayout {
  readonly actionAlign: "start" | "center" | "end";
  readonly gapPx: number;
  readonly minActionSizePx: number;
  readonly paddingPx: number;
}

export interface LoadingFailureTextStyle {
  readonly sizePx: number;
  readonly weight: number;
  readonly lineHeight: number;
}

export interface LoadingFailureActionTextStyle extends LoadingFailureTextStyle {
  readonly synthesis?: "none" | "weight";
}

export interface LoadingFailurePresentation<Width extends number | "content" = number> {
  readonly panel: {
    readonly maxWidthPx: number;
    readonly safeInsetPx: number;
    readonly paddingTopPx: number;
    readonly paddingXPx: number;
    readonly paddingBottomPx: number;
    readonly titleBodyGapPx: number;
    readonly bodyActionGapPx: number;
    readonly borderWidthPx: number;
    readonly lipHeightPx: number;
    readonly shadowOffsetPx: number;
    // The bevel row under the top border, in palette.panelHighlight. Give both or neither; unset,
    // the panel draws no highlight.
    readonly highlightHeightPx?: number;
  };
  readonly text: {
    readonly title: LoadingFailureTextStyle;
    readonly body: LoadingFailureTextStyle;
    readonly action: LoadingFailureActionTextStyle;
  };
  readonly action: {
    // Content uses the label, horizontal padding and borders, capped by the panel.
    readonly widthPx: Width;
    readonly heightPx: number;
    readonly paddingXPx: number;
    readonly paddingBottomPx: number;
    readonly borderWidthPx: number;
    readonly highlightHeightPx: number;
    readonly shadeHeightPx: number;
  };
  readonly palette: {
    readonly panel: string;
    readonly text: string;
    readonly action: string;
    readonly actionText: string;
    readonly border: string;
    readonly lip: string;
    readonly shadow: string;
    readonly highlight: string;
    readonly shade: string;
    readonly panelHighlight?: string;
  };
}

type Presentation = LoadingFailurePresentation<number | "content">;

export interface LoadingFailureContext<Width extends number | "content" = number> {
  readonly bindHoldAction?: HoldActionBinding;
  readonly foregroundInput?: ForegroundInput;
  readonly layout?: LoadingFailureLayout;
  readonly presentation?: LoadingFailurePresentation<Width>;
  readonly onRetry: () => void | PromiseLike<void>;
}

type Context = LoadingFailureContext<number | "content">;

export interface LoadingFailureNoticeContext<Width extends number | "content" = number> {
  readonly bindHoldAction?: never;
  readonly body: string;
  readonly foregroundInput?: ForegroundInput;
  readonly layout?: LoadingFailureLayout;
  readonly onRetry?: never;
  readonly presentation?: LoadingFailurePresentation<Width>;
}

type NoticeContext = LoadingFailureNoticeContext<number | "content">;

export interface LoadingFailureView {
  readonly element: HTMLDivElement;
  dispose(): void;
  update(state: LoadingAttemptState): void;
}

export interface LoadingFailurePresentationView extends LoadingFailureView {
  setPresentation(next: Presentation): void;
}

// CSSOM fallback styling works without a stylesheet, custom font or game artwork. System
// colours and native font sizing preserve readability independently of the failed UI assets.
function fallback(element: HTMLElement): void {
  for (const [name, value] of Object.entries({
    all: "revert",
    "background-color": "Canvas",
    color: "CanvasText",
    font: "medium sans-serif",
    "overflow-wrap": "anywhere",
    "pointer-events": "auto",
    "user-select": "none",
    "white-space": "normal",
  })) {
    element.style.setProperty(name, value, "important");
  }
}

// The uiTheme text roles and colour slots a game sets on an ancestor, such as the document root,
// replace the renderer's type and colours; each var() falls back to the renderer's own value, so a
// page that sets none renders as before. A role's lengths are base px at --ui-unit. Each
// --loading-failure-<role>-* length is invalid while its role is unset, which selects the
// fallback.
type CardRole = Extract<TextRole, "body" | "heading" | "label">;

const CARD_ROLES: readonly CardRole[] = ["body", "heading", "label"];

function roleLengths(element: HTMLElement): void {
  for (const role of CARD_ROLES) {
    for (const field of ["size", "line-height"]) {
      element.style.setProperty(
        `--loading-failure-${role}-${field}`,
        `calc(var(--ui-text-${role}-${field}) * var(--ui-unit, 1) * 1px)`,
        "important",
      );
    }
  }
}

interface RoleFallback {
  readonly family: string;
  readonly lineHeight: string;
  readonly size: string;
  readonly weight: string;
}

function roleFont(role: CardRole, fallback: RoleFallback): Record<string, string> {
  return {
    "font-family": fallback.family,
    "font-size": `var(--loading-failure-${role}-size, ${fallback.size})`,
    "font-weight": `var(--ui-text-${role}-weight, ${fallback.weight})`,
    "line-height": `var(--loading-failure-${role}-line-height, ${fallback.lineHeight})`,
  };
}

// A colour slot, or fallback while the game leaves it unset.
const slot = (role: UiColourRole, fallback: string) => `var(${colourProperty(role)}, ${fallback})`;

// Retry is the card's one action, so it takes the primary face slots, as uiTheme.css does.
const actionFace = (fallback: string) => slot("buttonPrimaryFace", slot("buttonFace", fallback));
const actionText = (fallback: string) => slot("buttonPrimaryText", slot("buttonText", fallback));

// Values are CSS pixels at mount time, not game units. Keep layout independent of later caller
// mutations and validate before creating or appending any fallback DOM.
function checkedLayout(layout: LoadingFailureLayout | undefined): LoadingFailureLayout | undefined {
  if (layout === undefined) {
    return undefined;
  }
  if (typeof layout !== "object" || layout === null) {
    throw new RangeError("Loading failure layout must be an object");
  }
  const result = {
    actionAlign: layout.actionAlign,
    gapPx: layout.gapPx,
    minActionSizePx: layout.minActionSizePx,
    paddingPx: layout.paddingPx,
  };
  for (const name of ["gapPx", "minActionSizePx", "paddingPx"] as const) {
    if (!Number.isFinite(result[name]) || result[name] < 0) {
      throw new RangeError(`layout.${name} must be finite and nonnegative`);
    }
  }
  if (
    result.actionAlign !== "start" &&
    result.actionAlign !== "center" &&
    result.actionAlign !== "end"
  ) {
    throw new RangeError("Unknown loading failure action alignment");
  }
  return result;
}

function presentationRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new RangeError("Loading failure presentation requires complete groups");
  }
  return value as Record<string, unknown>;
}

function presentationNumbers<K extends string>(
  name: string,
  fields: readonly K[],
  value: unknown,
): Record<K, number> {
  const record = presentationRecord(value);
  return Object.fromEntries(
    fields.map((field) => {
      const number = record[field];
      if (typeof number !== "number" || !Number.isFinite(number) || number < 0) {
        throw new RangeError(`presentation.${name}.${field} must be finite and nonnegative`);
      }
      return [field, number];
    }),
  ) as Record<K, number>;
}

function hexColour(name: string, colour: unknown): string {
  if (
    typeof colour !== "string" ||
    !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(colour)
  ) {
    throw new RangeError(`presentation.palette.${name} must be a hex colour`);
  }
  return colour;
}

function checkedPresentation(value: Presentation | undefined): Presentation | undefined {
  if (value === undefined) {
    return undefined;
  }
  const record = presentationRecord(value);
  const panel = presentationNumbers(
    "panel",
    [
      "maxWidthPx",
      "safeInsetPx",
      "paddingTopPx",
      "paddingXPx",
      "paddingBottomPx",
      "titleBodyGapPx",
      "bodyActionGapPx",
      "borderWidthPx",
      "lipHeightPx",
      "shadowOffsetPx",
    ] as const,
    record.panel,
  );
  const actionRecord = presentationRecord(record.action);
  const widthPx: number | "content" =
    actionRecord.widthPx === "content"
      ? "content"
      : presentationNumbers("action", ["widthPx"], actionRecord).widthPx;
  const action = {
    ...presentationNumbers(
      "action",
      [
        "heightPx",
        "paddingXPx",
        "paddingBottomPx",
        "borderWidthPx",
        "highlightHeightPx",
        "shadeHeightPx",
      ],
      actionRecord,
    ),
    widthPx,
  };
  const textRecord = presentationRecord(record.text);
  const textStyle = (name: string) => {
    const style = presentationNumbers(
      `text.${name}`,
      ["sizePx", "weight", "lineHeight"] as const,
      textRecord[name],
    );
    if (style.sizePx === 0 || style.lineHeight === 0 || style.weight < 1 || style.weight > 1000) {
      throw new RangeError(
        `presentation.text.${name} requires positive size/lineHeight and weight 1..1000`,
      );
    }
    return style;
  };
  const synthesis = presentationRecord(textRecord.action).synthesis;
  if (synthesis !== undefined && synthesis !== "none" && synthesis !== "weight") {
    throw new RangeError("presentation.text.action.synthesis must be none or weight");
  }
  const actionText: LoadingFailureActionTextStyle = {
    ...textStyle("action"),
    ...(synthesis === undefined ? {} : { synthesis }),
  };
  const text = { action: actionText, body: textStyle("body"), title: textStyle("title") };
  if (!Number.isFinite(panel.safeInsetPx * 2)) {
    throw new RangeError("Presentation safe inset must have a finite combined extent");
  }
  if (panel.maxWidthPx === 0 || action.widthPx === 0 || action.heightPx === 0) {
    throw new RangeError("Presentation panel maximum width and action dimensions must be positive");
  }
  const panelEdges = 2 * (panel.paddingXPx + panel.borderWidthPx);
  const actionEdgesX = 2 * (action.paddingXPx + action.borderWidthPx);
  const actionEdgesY = action.paddingBottomPx + 2 * action.borderWidthPx;
  if (
    ![panelEdges, actionEdgesX, actionEdgesY].every(Number.isFinite) ||
    panel.maxWidthPx < panelEdges ||
    (typeof action.widthPx === "number" && action.widthPx < actionEdgesX) ||
    action.heightPx < actionEdgesY
  ) {
    throw new RangeError("Presentation dimensions must contain their border and padding");
  }
  const paletteRecord = presentationRecord(record.palette);
  const palette = Object.fromEntries(
    ["panel", "text", "action", "actionText", "border", "lip", "shadow", "highlight", "shade"].map(
      (name) => [name, hexColour(name, paletteRecord[name])],
    ),
  ) as unknown as LoadingFailurePresentation["palette"];
  const panelRecord = presentationRecord(record.panel);
  const highlightColour = paletteRecord.panelHighlight;
  if ((panelRecord.highlightHeightPx === undefined) !== (highlightColour === undefined)) {
    throw new RangeError(
      "presentation.panel.highlightHeightPx and presentation.palette.panelHighlight go together",
    );
  }
  if (panelRecord.highlightHeightPx === undefined) {
    return { action, palette, panel, text };
  }
  return {
    action,
    palette: { ...palette, panelHighlight: hexColour("panelHighlight", highlightColour) },
    panel: { ...panel, ...presentationNumbers("panel", ["highlightHeightPx"], panelRecord) },
    text,
  };
}

// Mount in a visible, non-inert caller-owned parent outside any font/art reveal gate. The
// caller wires update to onState and onRetry to retry, retaining its existing single top bar.
export function mountLoadingFailure(
  context: Context & { readonly presentation: Presentation },
  parent: HTMLElement,
): LoadingFailurePresentationView;
export function mountLoadingFailure(context: Context, parent: HTMLElement): LoadingFailureView;
export function mountLoadingFailure(
  context: NoticeContext & { readonly presentation: Presentation },
  parent: HTMLElement,
): LoadingFailurePresentationView;
export function mountLoadingFailure(
  context: NoticeContext,
  parent: HTMLElement,
): LoadingFailureView;
export function mountLoadingFailure(
  context: Context | NoticeContext,
  parent: HTMLElement,
): LoadingFailureView | LoadingFailurePresentationView {
  if (context.layout !== undefined && context.presentation !== undefined) {
    throw new RangeError("Loading failure layout and presentation are mutually exclusive");
  }
  const layout = checkedLayout(context.layout);
  const presentation = checkedPresentation(context.presentation);
  const document = parent.ownerDocument;
  const element = document.createElement("div");
  element.className = "loading-failure";
  element.setAttribute("role", "alert");
  element.setAttribute("aria-atomic", "true");
  const title = document.createElement("h2");
  title.textContent = LOADING_FAILURE_TEXT.title;
  const body = document.createElement("p");
  body.textContent = context.onRetry === undefined ? context.body : LOADING_FAILURE_TEXT.body;
  const retry =
    context.onRetry === undefined
      ? undefined
      : createNativeButton(document, LOADING_FAILURE_TEXT.retry);
  const contents = retry === undefined ? [title, body] : [title, body, retry];
  element.append(...contents);
  for (const node of [element, ...contents]) {
    fallback(node);
  }
  roleLengths(element);
  const styles = (properties: Record<string, string>, node: HTMLElement) => {
    for (const [name, value] of Object.entries(properties)) {
      node.style.setProperty(name, value, "important");
    }
  };
  if (presentation === undefined) {
    const native = { family: "sans-serif", lineHeight: "normal", size: "medium", weight: "normal" };
    for (const node of [element, title, body]) {
      styles(
        {
          "background-color": slot("cardFace", "Canvas"),
          color: slot("textPrimary", "CanvasText"),
        },
        node,
      );
    }
    styles(roleFont("heading", native), title);
    styles(roleFont("body", native), body);
    if (retry !== undefined) {
      styles(
        {
          "background-color": actionFace("Canvas"),
          color: actionText("CanvasText"),
          ...roleFont("label", native),
        },
        retry,
      );
    }
  }
  if (layout !== undefined) {
    for (const [name, value] of Object.entries({
      "box-sizing": "border-box",
      "flex-direction": "column",
      gap: `${layout.gapPx}px`,
      padding: `${layout.paddingPx}px`,
    })) {
      element.style.setProperty(name, value, "important");
    }
    for (const node of contents) {
      node.style.setProperty("margin", "0", "important");
    }
    for (const [name, value] of Object.entries({
      "align-items": "center",
      "align-self": { center: "center", end: "flex-end", start: "flex-start" }[layout.actionAlign],
      "box-sizing": "border-box",
      display: "flex",
      "flex-shrink": "0",
      "justify-content": "center",
      "min-height": `${layout.minActionSizePx}px`,
      "min-width": `${layout.minActionSizePx}px`,
      "text-align": "center",
    })) {
      retry?.style.setProperty(name, value, "important");
    }
  }
  const applyPresentation = (next: Presentation) => {
    const { action, palette, panel, text } = next;
    const font = (
      role: CardRole,
      style: LoadingFailureTextStyle,
      colour: string,
      node: HTMLElement,
    ) => {
      styles(
        {
          color: colour,
          ...roleFont(role, {
            family: "system-ui, sans-serif",
            lineHeight: `${style.lineHeight}`,
            size: `${style.sizePx}px`,
            weight: `${style.weight}`,
          }),
          "text-align": "center",
        },
        node,
      );
    };
    // The frame slot goes in border-color itself: a longhand of a shorthand holding var() reads as
    // empty, and Retry's focus paint saves and restores border-color.
    const border = slot("frame", palette.border);
    styles(
      {
        "align-items": "center",
        "background-color": slot("cardFace", palette.panel),
        border: `${panel.borderWidthPx}px solid`,
        "border-color": border,
        "box-shadow": [
          ...(panel.highlightHeightPx === undefined
            ? []
            : [`inset 0 ${panel.highlightHeightPx}px 0 ${palette.panelHighlight}`]),
          `inset 0 -${panel.lipHeightPx}px 0 ${palette.lip}`,
          `${panel.shadowOffsetPx}px ${panel.shadowOffsetPx}px 0 ${palette.shadow}`,
        ].join(", "),
        "box-sizing": "border-box",
        "flex-direction": "column",
        margin: "0",
        "max-height": `calc(100% - ${panel.safeInsetPx * 2}px)`,
        "max-width": `${panel.maxWidthPx}px`,
        overflow: "auto",
        padding: `${panel.paddingTopPx}px ${panel.paddingXPx}px ${panel.paddingBottomPx}px`,
        width: `calc(100% - ${panel.safeInsetPx * 2}px)`,
      },
      element,
    );
    for (const node of contents) {
      styles({ "box-sizing": "border-box", flex: "none", margin: "0" }, node);
    }
    for (const node of [title, body]) {
      styles({ "background-color": "transparent", "max-width": "100%" }, node);
    }
    font("heading", text.title, slot("textPrimary", palette.text), title);
    font("body", text.body, slot("textPrimary", palette.text), body);
    styles(
      {
        margin: `${panel.titleBodyGapPx}px 0 ${retry === undefined ? 0 : panel.bodyActionGapPx}px`,
        "text-wrap": "balance",
      },
      body,
    );
    if (retry === undefined) {
      return;
    }
    font("label", text.action, actionText(palette.actionText), retry);
    if (text.action.synthesis === undefined) {
      retry.style.removeProperty("font-synthesis");
    } else {
      retry.style.setProperty("font-synthesis", text.action.synthesis, "important");
    }
    if (action.widthPx === "content") {
      retry.style.setProperty("max-width", "100%", "important");
    } else {
      retry.style.removeProperty("max-width");
    }
    styles(
      {
        "align-items": "center",
        "background-color": actionFace(palette.action),
        border: `${action.borderWidthPx}px solid`,
        "border-color": border,
        "border-radius": "0",
        "box-shadow": [
          `inset 0 ${action.highlightHeightPx}px 0 ${palette.highlight}`,
          `inset 0 -${action.shadeHeightPx}px 0 ${palette.shade}`,
        ].join(", "),
        cursor: "pointer",
        display: "flex",
        height: `${action.heightPx}px`,
        "justify-content": "center",
        "min-height": "0",
        "min-width": "0",
        padding: `0 ${action.paddingXPx}px ${action.paddingBottomPx}px`,
        width: action.widthPx === "content" ? "max-content" : `${action.widthPx}px`,
      },
      retry,
    );
  };
  if (presentation !== undefined) {
    applyPresentation(presentation);
  }
  let state: LoadingAttemptState = { attempt: 0, kind: "idle" };
  let disposed = false;
  let busy = false;
  let stopHold: (() => void) | undefined;
  let stopForeground: (() => void) | undefined;
  let generation = 0;
  const render = () => {
    element.hidden = state.kind !== "failed";
    element.style.setProperty(
      "display",
      element.hidden
        ? "none"
        : layout === undefined && presentation === undefined
          ? "block"
          : "flex",
      "important",
    );
    if (retry !== undefined) {
      retry.disabled = state.kind !== "failed" || busy;
    }
  };
  const bindRetryEvents = (retry: HTMLButtonElement, onRetry: Context["onRetry"]) => {
    const onClick = () => {
      if (disposed || state.kind !== "failed" || busy) {
        return;
      }
      busy = true;
      const token = ++generation;
      render();
      const finish = () => {
        if (!disposed && generation === token) {
          busy = false;
          render();
        }
      };
      try {
        // Failed retry callbacks retain the same friendly error; never render the raw rejection.
        void Promise.resolve(onRetry()).then(finish, finish);
      } catch {
        finish();
      }
    };
    const available = () => !disposed && state.kind === "failed" && !busy;
    const action = { activate: onClick, available, element: retry };
    retry.addEventListener("click", onClick);
    if (context.foregroundInput !== undefined) {
      return { action, dispose: () => retry.removeEventListener("click", onClick) };
    }
    const heldKeys = new Set<string>();
    const keyTypes = ["keydown", "keypress", "keyup"] as const;
    const neutralTarget = (target: EventTarget | null) =>
      target === document || target === document.body || target === document.documentElement;
    // Keep native activation defaults. Ancestor capture listeners still observe these keys.
    // Disabling Retry can move focus to the body before the same press repeats or releases.
    const onKey = (event: KeyboardEvent) => {
      const key = event.key === "Spacebar" ? " " : event.key;
      if (key !== "Enter" && key !== " ") {
        return;
      }
      if (!event.composedPath().includes(retry)) {
        if (
          !heldKeys.has(key) ||
          !neutralTarget(event.target) ||
          (document.activeElement !== retry && !neutralTarget(document.activeElement)) ||
          (event.type === "keydown" && !event.repeat)
        ) {
          heldKeys.delete(key);
          return;
        }
      }
      if (event.type === "keydown") {
        heldKeys.add(key);
      } else if (event.type === "keyup") {
        heldKeys.delete(key);
      }
      event.stopPropagation();
    };
    const clearKeys = () => heldKeys.clear();
    const onFocus = (event: FocusEvent) => {
      if (event.target !== retry && !neutralTarget(event.target)) {
        clearKeys();
      }
    };
    for (const type of keyTypes) {
      retry.addEventListener(type, onKey);
      document.addEventListener(type, onKey);
    }
    document.addEventListener("focusin", onFocus);
    document.defaultView?.addEventListener("blur", clearKeys);
    return {
      action,
      dispose() {
        clearKeys();
        for (const type of keyTypes) {
          retry.removeEventListener(type, onKey);
          document.removeEventListener(type, onKey);
        }
        document.removeEventListener("focusin", onFocus);
        document.defaultView?.removeEventListener("blur", clearKeys);
        retry.removeEventListener("click", onClick);
      },
    };
  };
  const events =
    retry === undefined ? undefined : bindRetryEvents(retry, () => context.onRetry?.());
  render();
  parent.append(element);
  const focus =
    retry === undefined ? undefined : paintRetryFocus(retry, presentation !== undefined);
  const view: LoadingFailureView = {
    dispose() {
      disposed = true;
      generation += 1;
      events?.dispose();
      stopForeground?.();
      focus?.dispose();
      element.remove();
      const stop = stopHold;
      stopHold = undefined;
      stop?.();
    },
    element,
    update(next) {
      if (disposed || next.attempt < state.attempt) {
        return;
      }
      state = next;
      render();
    },
  };
  try {
    stopForeground = context.foregroundInput?.register({
      layer: "recovery",
      resolve: (target) =>
        target === retry && events !== undefined
          ? { ...events.action, identity: `${state.attempt}:${generation}`, native: true }
          : undefined,
      root: element,
    });
    if (events !== undefined) {
      stopHold = context.bindHoldAction?.(events.action);
    }
  } catch (error) {
    view.dispose();
    throw error;
  }
  return presentation === undefined
    ? view
    : {
        ...view,
        setPresentation(next) {
          if (disposed) {
            return;
          }
          const snapshot = checkedPresentation(next);
          if (snapshot === undefined) {
            throw new RangeError("A configured presentation requires a complete replacement");
          }
          focus?.clear();
          applyPresentation(snapshot);
          focus?.refresh();
        },
      };
}
