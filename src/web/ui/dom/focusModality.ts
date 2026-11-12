// Script focus that shows a focus ring only to keyboard players. Chrome matches :focus-visible for
// a script's focus() while no pointer has pressed the page yet, so a screen that focuses its
// default action on open shows the ring on touch until the first tap. Each document's last input
// modality is tracked from keydown (keyboard) and pointerdown (pointer; touchstart where the
// browser has no pointer events), in the capture phase, so a listener that stops the event does
// not hide it. focusTarget hides the ring until a key is pressed and after any later press.

export type InputModality = "keyboard" | "pointer";

interface Tracking {
  readonly dispose: () => void;
  readonly last: { modality: InputModality | undefined };
}

const tracked = new WeakMap<Document, Tracking>();

// Tracks document's last input modality until the returned function removes the listeners and
// forgets it. Tracking a document already tracked changes nothing and returns its disposer.
export function trackInputModality(document: Document): () => void {
  const existing = tracked.get(document);
  if (existing !== undefined) {
    return existing.dispose;
  }
  const pointerType =
    typeof document.defaultView?.PointerEvent === "function" ? "pointerdown" : "touchstart";
  const options = { capture: true, passive: true } as const;
  const last: Tracking["last"] = { modality: undefined };
  const onKey = () => {
    last.modality = "keyboard";
  };
  const onPointer = () => {
    last.modality = "pointer";
  };
  const dispose = () => {
    if (tracked.get(document)?.dispose !== dispose) {
      return;
    }
    tracked.delete(document);
    document.removeEventListener("keydown", onKey, options);
    document.removeEventListener(pointerType, onPointer, options);
  };
  document.addEventListener("keydown", onKey, options);
  document.addEventListener(pointerType, onPointer, options);
  tracked.set(document, { dispose, last });
  return dispose;
}

// The last input modality seen on document, or undefined before any input or while untracked.
export function inputModality(document: Document): InputModality | undefined {
  return tracked.get(document)?.last.modality;
}

// FocusOptions.focusVisible, typed here for DOM libraries that predate it.
type ModalFocusOptions = FocusOptions & { readonly focusVisible?: boolean };

// Focuses element, tracking its document from now on if it is not tracked yet. After keyboard
// input it calls focus() with no options, so the browser shows the ring and scrolls the element
// into view as for any keyboard focus. Before any key, or after a later press, it calls
// focus({ focusVisible: false, preventScroll: true }). A browser that ignores focusVisible
// applies its own :focus-visible heuristic.
export function focusTarget(element: HTMLElement): void {
  const document = element.ownerDocument;
  trackInputModality(document);
  if (inputModality(document) === "keyboard") {
    element.focus();
    return;
  }
  const options: ModalFocusOptions = { focusVisible: false, preventScroll: true };
  element.focus(options);
}
