// The page's visibility, as document reports it, so tests can pass a fake.
export interface VisibilitySource extends EventTarget {
  readonly visibilityState: DocumentVisibilityState;
}

// Calls onChange with whether the page is visible, once per change, until the returned function
// is called. pagehide counts as hidden and pageshow rechecks, for a page leaving or returning
// from the back-forward cache without a visibilitychange. eventTarget is the page's window.
export function watchVisibility(
  eventTarget: EventTarget,
  visibilitySource: VisibilitySource,
  onChange: (visible: boolean) => void,
): () => void {
  let lastHidden = visibilitySource.visibilityState === "hidden";
  const report = (hidden: boolean) => {
    if (hidden === lastHidden) {
      return;
    }
    lastHidden = hidden;
    onChange(!hidden);
  };
  const recheck = () => report(visibilitySource.visibilityState === "hidden");
  const hide = () => report(true);
  visibilitySource.addEventListener("visibilitychange", recheck);
  eventTarget.addEventListener("pagehide", hide);
  eventTarget.addEventListener("pageshow", recheck);
  return () => {
    visibilitySource.removeEventListener("visibilitychange", recheck);
    eventTarget.removeEventListener("pagehide", hide);
    eventTarget.removeEventListener("pageshow", recheck);
  };
}
