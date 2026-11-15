import { LOADING_FAILURE_TEXT, type LoadingAttemptState } from "../../../load/loadingAttempts.ts";

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

export interface LoadingFailurePresentation {
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
  };
  readonly text: {
    readonly title: LoadingFailureTextStyle;
    readonly body: LoadingFailureTextStyle;
    readonly action: LoadingFailureTextStyle;
  };
  readonly action: {
    readonly widthPx: number;
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
  };
}

export interface LoadingFailureContext {
  readonly layout?: LoadingFailureLayout;
  readonly presentation?: LoadingFailurePresentation;
  readonly onRetry: () => void | PromiseLike<void>;
}

export interface LoadingFailureView {
  readonly element: HTMLDivElement;
  dispose(): void;
  update(state: LoadingAttemptState): void;
}

export interface LoadingFailurePresentationView extends LoadingFailureView {
  setPresentation(next: LoadingFailurePresentation): void;
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

function checkedPresentation(
  value: LoadingFailurePresentation | undefined,
): LoadingFailurePresentation | undefined {
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
  const action = presentationNumbers(
    "action",
    [
      "widthPx",
      "heightPx",
      "paddingXPx",
      "paddingBottomPx",
      "borderWidthPx",
      "highlightHeightPx",
      "shadeHeightPx",
    ] as const,
    record.action,
  );
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
  const text = { action: textStyle("action"), body: textStyle("body"), title: textStyle("title") };
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
    action.widthPx < actionEdgesX ||
    action.heightPx < actionEdgesY
  ) {
    throw new RangeError("Presentation dimensions must contain their border and padding");
  }
  const paletteRecord = presentationRecord(record.palette);
  const palette = Object.fromEntries(
    ["panel", "text", "action", "actionText", "border", "lip", "shadow", "highlight", "shade"].map(
      (name) => {
        const colour = paletteRecord[name];
        if (
          typeof colour !== "string" ||
          !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(colour)
        ) {
          throw new RangeError(`presentation.palette.${name} must be a hex colour`);
        }
        return [name, colour];
      },
    ),
  ) as unknown as LoadingFailurePresentation["palette"];
  return { action, palette, panel, text };
}

// Mount in a visible, non-inert caller-owned parent outside any font/art reveal gate. The
// caller wires update to onState and onRetry to retry, retaining its existing single top bar.
export function mountLoadingFailure(
  context: LoadingFailureContext & { readonly presentation: LoadingFailurePresentation },
  parent: HTMLElement,
): LoadingFailurePresentationView;
export function mountLoadingFailure(
  context: LoadingFailureContext,
  parent: HTMLElement,
): LoadingFailureView;
export function mountLoadingFailure(
  context: LoadingFailureContext,
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
  body.textContent = LOADING_FAILURE_TEXT.body;
  const retry = document.createElement("button");
  retry.type = "button";
  retry.textContent = LOADING_FAILURE_TEXT.retry;
  element.append(title, body, retry);
  for (const node of [element, title, body, retry]) {
    fallback(node);
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
    for (const node of [title, body, retry]) {
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
      retry.style.setProperty(name, value, "important");
    }
  }
  const applyPresentation = (next: LoadingFailurePresentation) => {
    const { action, palette, panel, text } = next;
    const styles = (properties: Record<string, string>, node: HTMLElement) => {
      for (const [name, value] of Object.entries(properties)) {
        node.style.setProperty(name, value, "important");
      }
    };
    const font = (style: LoadingFailureTextStyle, colour: string, node: HTMLElement) => {
      styles(
        {
          color: colour,
          "font-family": "system-ui, sans-serif",
          "font-size": `${style.sizePx}px`,
          "font-weight": `${style.weight}`,
          "line-height": `${style.lineHeight}`,
          "text-align": "center",
        },
        node,
      );
    };
    styles(
      {
        "align-items": "center",
        "background-color": palette.panel,
        border: `${panel.borderWidthPx}px solid ${palette.border}`,
        "box-shadow": [
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
    for (const node of [title, body, retry]) {
      styles({ "box-sizing": "border-box", flex: "none", margin: "0" }, node);
    }
    for (const node of [title, body]) {
      styles({ "background-color": "transparent", "max-width": "100%" }, node);
    }
    font(text.title, palette.text, title);
    font(text.body, palette.text, body);
    styles(
      {
        margin: `${panel.titleBodyGapPx}px 0 ${panel.bodyActionGapPx}px`,
        "text-wrap": "balance",
      },
      body,
    );
    font(text.action, palette.actionText, retry);
    styles(
      {
        "align-items": "center",
        "background-color": palette.action,
        border: `${action.borderWidthPx}px solid ${palette.border}`,
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
        width: `${action.widthPx}px`,
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
    retry.disabled = state.kind !== "failed" || busy;
  };
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
      void Promise.resolve(context.onRetry()).then(finish, finish);
    } catch {
      finish();
    }
  };
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
  retry.addEventListener("click", onClick);
  render();
  parent.append(element);
  const view: LoadingFailureView = {
    dispose() {
      disposed = true;
      generation += 1;
      clearKeys();
      for (const type of keyTypes) {
        retry.removeEventListener(type, onKey);
        document.removeEventListener(type, onKey);
      }
      document.removeEventListener("focusin", onFocus);
      document.defaultView?.removeEventListener("blur", clearKeys);
      retry.removeEventListener("click", onClick);
      element.remove();
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
          applyPresentation(snapshot);
        },
      };
}
