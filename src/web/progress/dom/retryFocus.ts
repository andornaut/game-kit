// Keep the keyboard cue available under Retry's inline reset and without stylesheets.
export function paintRetryFocus(button: HTMLButtonElement): {
  clear(): void;
  dispose(): void;
  refresh(): void;
} {
  const document = button.ownerDocument;
  const view = document.defaultView;
  if (
    !view?.CSS?.supports?.("selector(:focus-visible)") ||
    !view.matchMedia ||
    !view.requestAnimationFrame
  ) {
    return { clear() {}, dispose() {}, refresh() {} };
  }
  const forced = view.matchMedia("(forced-colors: active)");
  if (!forced.addEventListener) {
    return { clear() {}, dispose() {}, refresh() {} };
  }
  let frame: number | undefined;
  const { style } = button;
  let restore: (() => void) | undefined;
  const clear = () => {
    restore?.();
    restore = undefined;
  };
  const paint = () => {
    clear();
    if (document.activeElement !== button || !button.matches(":focus-visible")) {
      return;
    }
    if (forced.matches && !view.CSS.supports("forced-color-adjust", "none")) {
      return;
    }
    const properties: Record<string, string> = forced.matches
      ? {
          "background-color": "Highlight",
          "border-color": "ButtonBorder",
          "box-shadow": "none",
          color: "HighlightText",
          "forced-color-adjust": "none",
          outline: "none",
        }
      : {
          "background-color": style.color,
          color: style.backgroundColor,
          outline: "none",
        };
    const previous = Object.keys(properties).map((name) => ({
      name,
      priority: style.getPropertyPriority(name),
      value: style.getPropertyValue(name),
    }));
    for (const [name, value] of Object.entries(properties)) {
      style.setProperty(name, value, "important");
    }
    restore = () => {
      for (const { name, priority, value } of previous) {
        // The inline all: revert still supplies any reset longhands after removal.
        if (value === "" || value === "revert") {
          style.removeProperty(name);
        } else {
          style.setProperty(name, value, priority);
        }
      }
    };
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
  return {
    clear,
    dispose() {
      button.removeEventListener("focus", schedule);
      button.removeEventListener("blur", blur);
      view.removeEventListener("keydown", schedule, true);
      view.removeEventListener("pointerdown", schedule, true);
      view.removeEventListener("focus", schedule);
      forced.removeEventListener("change", schedule);
      blur();
    },
    refresh: paint,
  };
}
