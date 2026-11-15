import { LOADING_FAILURE_TEXT, type LoadingAttemptState } from "../../../load/loadingAttempts.ts";

export interface LoadingFailureContext {
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

// Mount in a visible, non-inert caller-owned parent outside any font/art reveal gate. The
// caller wires update to onState and onRetry to retry, retaining its existing single top bar.
export function mountLoadingFailure(
  context: LoadingFailureContext,
  parent: HTMLElement,
): LoadingFailureView {
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
  let state: LoadingAttemptState = { attempt: 0, kind: "idle" };
  let disposed = false;
  let busy = false;
  let generation = 0;
  const render = () => {
    element.hidden = state.kind !== "failed";
    element.style.setProperty("display", element.hidden ? "none" : "block", "important");
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
  retry.addEventListener("click", onClick);
  render();
  parent.append(element);
  return {
    dispose() {
      disposed = true;
      generation += 1;
      retry.removeEventListener("click", onClick);
      element.remove();
    },
    element,
    update(next) {
      if (disposed || next.attempt < state.attempt) {
        return;
      }
      state = next;
      if (state.kind !== "loading") {
        busy = false;
        generation += 1;
      }
      render();
    },
  };
}
