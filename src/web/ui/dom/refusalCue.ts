// The refusal cue for a control that cannot act: for steps steps of stepMs each, the control
// shakes shake base px left then right, and its text turns red on each left step. With reduced
// motion it holds red for the same time and does not move. The cue sets attributes and one custom
// property only; ui.css draws it, in the --ui-refusal-colour the game sets.

export interface RefusalCue {
  readonly shake: number;
  readonly stepMs: number;
  readonly steps: number;
}

export const REFUSAL_ATTRIBUTES = { red: "data-ui-refusal-red", shake: "data-ui-refusal-shake" };
export const REFUSAL_SHAKE = "--ui-refusal-shake";

const running = new WeakMap<Element, () => void>();

function show(element: HTMLElement, red: boolean, shake: "left" | "right" | undefined): void {
  element.toggleAttribute(REFUSAL_ATTRIBUTES.red, red);
  if (shake === undefined) {
    element.removeAttribute(REFUSAL_ATTRIBUTES.shake);
  } else {
    element.setAttribute(REFUSAL_ATTRIBUTES.shake, shake);
  }
}

// Plays the cue on element, restarting it if one is already playing there. Returns a function
// that stops it at once; reducedMotion is read when the cue starts.
export function refuse(cue: RefusalCue, reducedMotion: boolean, element: HTMLElement): () => void {
  running.get(element)?.();
  const steps = reducedMotion ? 1 : cue.steps;
  const stepMs = reducedMotion ? cue.stepMs * cue.steps : cue.stepMs;
  element.style.setProperty(REFUSAL_SHAKE, String(cue.shake));
  const timers: ReturnType<typeof setTimeout>[] = [];
  const stop = () => {
    timers.forEach(clearTimeout);
    show(element, false, undefined);
    element.style.removeProperty(REFUSAL_SHAKE);
    if (running.get(element) === stop) {
      running.delete(element);
    }
  };
  const step = (index: number) => {
    if (index >= steps) {
      stop();
      return;
    }
    const left = index % 2 === 0;
    show(element, reducedMotion || left, reducedMotion ? undefined : left ? "left" : "right");
    timers.push(setTimeout(() => step(index + 1), stepMs));
  };
  running.set(element, stop);
  step(0);
  return stop;
}
