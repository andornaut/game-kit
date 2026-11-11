// What the player's keys do on a screen or card with keyboard focus: Tab and the arrows move the
// focus through its controls, Shift+Tab, Up and Left back through them; Enter and Space press the
// focused one; Escape and P close a card.
export type FocusKeyAction = "close" | "next" | "press" | "previous";

const KEY_ACTIONS: Readonly<Record<string, FocusKeyAction>> = {
  " ": "press",
  ArrowDown: "next",
  ArrowLeft: "previous",
  ArrowRight: "next",
  ArrowUp: "previous",
  Enter: "press",
  Escape: "close",
  P: "close",
  Tab: "next",
  p: "close",
};

// A key's action (KeyboardEvent key, shiftKey and repeat), or undefined for any other key. Shift
// turns Tab back. A held key's repeats move the focus on, but never press or close again.
export function focusKeyAction(
  key: string,
  shift: boolean,
  repeat: boolean,
): FocusKeyAction | undefined {
  const action = key === "Tab" && shift ? "previous" : KEY_ACTIONS[key];
  return repeat && action !== "next" && action !== "previous" ? undefined : action;
}

// The focus after a step through targets, in order and wrapping round, from focus: the first
// (next) or last (previous) target when focus is none of them. Undefined when there are none.
export function stepFocus<Target>(
  targets: readonly Target[],
  focus: Target | undefined,
  step: "next" | "previous",
): Target | undefined {
  const by = step === "next" ? 1 : -1;
  const at = focus === undefined ? -1 : targets.indexOf(focus);
  const from = at < 0 ? (by > 0 ? -1 : 0) : at;
  return targets[(from + by + targets.length) % targets.length];
}
