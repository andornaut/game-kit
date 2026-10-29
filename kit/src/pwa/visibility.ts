import type { VisibilitySource } from "./wakeLock";

// Calls onChange with whether the page is visible, once per change. pagehide counts as hidden and
// pageshow rechecks, for a page leaving or returning from the back-forward cache without a
// visibilitychange. eventTarget is the page's window.
export function watchVisibility(
  onChange: (visible: boolean) => void,
  eventTarget: EventTarget,
  visibilitySource: VisibilitySource,
): void {
  let lastHidden = visibilitySource.visibilityState === "hidden";
  const report = (hidden: boolean) => {
    if (hidden === lastHidden) {
      return;
    }
    lastHidden = hidden;
    onChange(!hidden);
  };
  const recheck = () => report(visibilitySource.visibilityState === "hidden");
  visibilitySource.addEventListener("visibilitychange", recheck);
  eventTarget.addEventListener("pagehide", () => report(true));
  eventTarget.addEventListener("pageshow", recheck);
}
