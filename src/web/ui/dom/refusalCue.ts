// The refusal cue for a control that cannot act. For steps steps of stepMs each its text turns red
// on every even step, and for the same time the control shakes shake base px, one stroke every
// shakeMs, in one of two shapes: alternate holds left and right in turn, and yoyo glides out to
// the right and back. A negative shake mirrors it. With reduced motion it holds red for the same
// time and does not move. The cue sets attributes and custom properties only; ui.css draws it, in
// the --ui-refusal-colour the game sets, on the control and on each label inside it that carries
// data-ui-refusal-label.

export interface RefusalCue {
  readonly shake: number;
  // Alternate when undefined.
  readonly shakeShape?: "alternate" | "yoyo";
  // One stroke's time; stepMs when undefined.
  readonly shakeMs?: number;
  readonly stepMs: number;
  readonly steps: number;
}

export const REFUSAL_ATTRIBUTES = {
  label: "data-ui-refusal-label",
  red: "data-ui-refusal-red",
  shake: "data-ui-refusal-shake",
};
export const REFUSAL_SHAKE = "--ui-refusal-shake";
export const REFUSAL_SHAKE_MS = "--ui-refusal-shake-ms";

// The shake attribute's value on each stroke, in turn.
const STROKES = { alternate: ["left", "right"], yoyo: ["out", "back"] } as const;

const running = new WeakMap<Element, () => void>();

// Plays the cue on element, restarting it if one is already playing there. Returns a function
// that stops it at once; reducedMotion is read when the cue starts.
export function refuse(cue: RefusalCue, reducedMotion: boolean, element: HTMLElement): () => void {
  running.get(element)?.();
  const shakeMs = cue.shakeMs ?? cue.stepMs;
  const strokes = STROKES[cue.shakeShape ?? "alternate"];
  const timers: ReturnType<typeof setTimeout>[] = [];
  const stop = () => {
    timers.forEach(clearTimeout);
    element.removeAttribute(REFUSAL_ATTRIBUTES.red);
    element.removeAttribute(REFUSAL_ATTRIBUTES.shake);
    element.style.removeProperty(REFUSAL_SHAKE);
    element.style.removeProperty(REFUSAL_SHAKE_MS);
    if (running.get(element) === stop) {
      running.delete(element);
    }
  };
  const flash = (index: number) => {
    if (index < cue.steps) {
      element.toggleAttribute(REFUSAL_ATTRIBUTES.red, index % 2 === 0);
      timers.push(setTimeout(() => flash(index + 1), cue.stepMs));
    }
  };
  const stroke = (index: number) => {
    element.setAttribute(REFUSAL_ATTRIBUTES.shake, index % 2 === 0 ? strokes[0] : strokes[1]);
    timers.push(setTimeout(() => stroke(index + 1), shakeMs));
  };
  running.set(element, stop);
  timers.push(setTimeout(stop, cue.steps * cue.stepMs));
  if (reducedMotion) {
    element.setAttribute(REFUSAL_ATTRIBUTES.red, "");
  } else {
    element.style.setProperty(REFUSAL_SHAKE, String(cue.shake));
    element.style.setProperty(REFUSAL_SHAKE_MS, String(shakeMs));
    flash(0);
    stroke(0);
  }
  return stop;
}
