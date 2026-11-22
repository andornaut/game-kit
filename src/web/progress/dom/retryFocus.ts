// Paint native button states under Retry's inline reset and without stylesheets.
export function paintRetryFocus(
  button: HTMLButtonElement,
  paintPress: boolean,
): {
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
  let pressed = false;
  const { style } = button;
  let restore: (() => void) | undefined;
  const clear = () => {
    restore?.();
    restore = undefined;
    pressed = false;
  };
  const paint = () => {
    clear();
    const focused = document.activeElement === button && button.matches(":focus-visible");
    pressed = paintPress && !button.disabled && button.matches(":active");
    if (!focused && !pressed) {
      return;
    }
    if (forced.matches && !view.CSS.supports("forced-color-adjust", "none")) {
      return;
    }
    // Reuse the caller's colour pair so both cues retain its text-to-face contrast.
    const invert = focused !== pressed;
    const systemFill = focused ? "Highlight" : "ButtonFace";
    const systemText = focused ? "HighlightText" : "ButtonText";
    const properties: Record<string, string> = forced.matches
      ? {
          "background-color": pressed ? systemText : systemFill,
          "border-color": "ButtonBorder",
          "box-shadow": "none",
          color: pressed ? systemFill : systemText,
          "forced-color-adjust": "none",
          outline: "none",
        }
      : {
          "background-color": invert ? style.color : style.backgroundColor,
          color: invert ? style.backgroundColor : style.color,
          outline: "none",
          ...(pressed ? { "text-decoration": "underline" } : {}),
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
  const schedule = (event?: Event) => {
    // Native focus-visible can change on a key or pointer event with stable DOM focus.
    if (
      frame === undefined &&
      (document.activeElement === button ||
        (paintPress && (pressed || event?.composedPath().includes(button))))
    ) {
      frame = view.requestAnimationFrame(() => {
        frame = undefined;
        paint();
      });
    }
  };
  const releaseEvents = ["pointerup", "pointercancel", "pointerout", "dragstart", "keyup"] as const;
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
  if (paintPress) {
    for (const type of releaseEvents) {
      view.addEventListener(type, schedule, true);
    }
    view.addEventListener("blur", blur);
  }
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
      if (paintPress) {
        for (const type of releaseEvents) {
          view.removeEventListener(type, schedule, true);
        }
        view.removeEventListener("blur", blur);
      }
      forced.removeEventListener("change", schedule);
      blur();
    },
    refresh: paint,
  };
}
