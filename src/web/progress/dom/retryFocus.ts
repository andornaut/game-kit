// Keep the keyboard cue available under Retry's inline reset and without stylesheets.
export function paintRetryFocus(button: HTMLButtonElement): () => void {
  const document = button.ownerDocument;
  const view = document.defaultView;
  if (
    !view?.CSS?.supports?.("selector(:focus-visible)") ||
    !view.matchMedia ||
    !view.requestAnimationFrame
  ) {
    return () => {};
  }
  const forced = view.matchMedia("(forced-colors: active)");
  if (!forced.addEventListener) {
    return () => {};
  }
  let frame: number | undefined;
  const clear = () => {
    button.style.removeProperty("outline");
    button.style.removeProperty("outline-offset");
  };
  const paint = () => {
    if (document.activeElement !== button || !button.matches(":focus-visible")) {
      clear();
      return;
    }
    // Match the shared double stroke and system Highlight fallback in controls.css.
    button.style.setProperty(
      "outline",
      forced.matches ? "2px solid Highlight" : "3px double currentColor",
      "important",
    );
    button.style.setProperty("outline-offset", forced.matches ? "2px" : "1px", "important");
  };
  const schedule = () => {
    // Native focus-visible can change on a key or pointer event with stable DOM focus.
    if (frame === undefined && document.activeElement === button) {
      frame = view.requestAnimationFrame(() => {
        frame = undefined;
        paint();
      });
    }
  };
  const blur = () => {
    if (frame !== undefined) {
      view.cancelAnimationFrame(frame);
      frame = undefined;
    }
    clear();
  };
  button.addEventListener("focus", schedule);
  button.addEventListener("blur", blur);
  view.addEventListener("keydown", schedule, true);
  view.addEventListener("pointerdown", schedule, true);
  view.addEventListener("focus", schedule);
  forced.addEventListener("change", schedule);
  schedule();
  return () => {
    button.removeEventListener("focus", schedule);
    button.removeEventListener("blur", blur);
    view.removeEventListener("keydown", schedule, true);
    view.removeEventListener("pointerdown", schedule, true);
    view.removeEventListener("focus", schedule);
    forced.removeEventListener("change", schedule);
    blur();
  };
}
