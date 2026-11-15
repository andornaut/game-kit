import { LOADING_FAILURE_TEXT, type LoadingAttemptState } from "../../../load/loadingAttempts.ts";

export interface LoadingFailureLayout {
  readonly actionAlign: "start" | "center" | "end";
  readonly gapPx: number;
  readonly minActionSizePx: number;
  readonly paddingPx: number;
}

export interface LoadingFailureContext {
  readonly layout?: LoadingFailureLayout;
  readonly onRetry: () => void | PromiseLike<void>;
}

export interface LoadingFailureView {
  readonly element: HTMLDivElement;
  dispose(): void;
  update(state: LoadingAttemptState): void;
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

// Mount in a visible, non-inert caller-owned parent outside any font/art reveal gate. The
// caller wires update to onState and onRetry to retry, retaining its existing single top bar.
export function mountLoadingFailure(
  context: LoadingFailureContext,
  parent: HTMLElement,
): LoadingFailureView {
  const layout = checkedLayout(context.layout);
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
  let state: LoadingAttemptState = { attempt: 0, kind: "idle" };
  let disposed = false;
  let busy = false;
  let generation = 0;
  const render = () => {
    element.hidden = state.kind !== "failed";
    element.style.setProperty(
      "display",
      element.hidden ? "none" : layout === undefined ? "block" : "flex",
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
  return {
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
}
