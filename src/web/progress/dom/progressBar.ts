import {
  checkProgressMotion,
  progressBarLayout,
  type ProgressBarStyle,
  type ProgressMotion,
  type ProgressValue,
} from "../../../progress.ts";
import type { ProgressSnapshot } from "../../../progressState.ts";
import type { Rect } from "../../../rect.ts";

// The names progressBar.css reads. The bar is PROGRESS_BAR_CLASS with its data-state; each fill
// band is a PROGRESS_BAR_BAND_CLASS clip holding one coloured segment.
export const PROGRESS_BAR_CLASS = "progress-bar";
export const PROGRESS_BAR_BAND_CLASS = "progress-bar-band";
export const PROGRESS_BAR_PROPERTIES = {
  cycle: "--progress-bar-cycle",
  full: "--progress-bar-full",
  segment: "--progress-bar-segment",
} as const;

// pending: unknown total, the segment travels; determinate: a measured share; complete: full,
// then hidden after the full hold; idle: hidden.
export type ProgressBarState = "complete" | "determinate" | "idle" | "pending";

// The indeterminate motion and how long a finished measured bar stays full. Without it the
// stylesheet's defaults apply.
export interface DomProgressTiming extends ProgressMotion {
  readonly fullMs: number;
}

const cssColour = (colour: number) => `#${colour.toString(16).padStart(6, "0")}`;

// A progress bar whose indeterminate segment and full hold run from progressBar.css alone, so the
// same markup animates before any script runs; script writes geometry as CSSOM properties, the
// timing as custom properties and the state as attributes, never style text, and drives no
// frames. update shows a value; report follows a progress state, hiding the bar while idle. The
// caller owns the coordinate space, scaling and accessible label. This adapter imports no
// renderer and can mount before the game's Phaser module is loaded.
export function createDomProgressBar(
  parent: HTMLElement,
  style: ProgressBarStyle,
  frame: Rect,
  timing?: DomProgressTiming,
): {
  element: HTMLDivElement;
  remove(): void;
  report(snapshot: ProgressSnapshot): void;
  update(value: ProgressValue): void;
} {
  if (timing !== undefined) {
    checkProgressMotion(timing);
    if (!(Number.isFinite(timing.fullMs) && timing.fullMs >= 0)) {
      throw new RangeError(`Full hold must be nonnegative and finite: ${timing.fullMs}`);
    }
  }
  const document = parent.ownerDocument;
  const element = document.createElement("div");
  element.className = PROGRESS_BAR_CLASS;
  element.setAttribute("role", "progressbar");
  element.setAttribute("aria-valuemin", "0");
  element.setAttribute("aria-valuemax", "1");
  Object.assign(element.style, {
    backgroundColor: cssColour(style.frame),
    height: `${frame.height}px`,
    left: `${frame.x}px`,
    pointerEvents: "none",
    position: "absolute",
    top: `${frame.y}px`,
    width: `${frame.width}px`,
  });
  if (timing !== undefined) {
    element.style.setProperty(PROGRESS_BAR_PROPERTIES.cycle, `${timing.cycleMs}ms`);
    element.style.setProperty(PROGRESS_BAR_PROPERTIES.full, `${timing.fullMs}ms`);
    element.style.setProperty(PROGRESS_BAR_PROPERTIES.segment, String(timing.segment));
  }
  const track = document.createElement("div");
  track.style.position = "absolute";
  track.style.backgroundColor = cssColour(style.track);
  element.append(track);
  const bands = style.fills.map((colour) => {
    const band = document.createElement("div");
    band.className = PROGRESS_BAR_BAND_CLASS;
    band.style.position = "absolute";
    band.style.overflow = "hidden";
    const segment = document.createElement("div");
    segment.style.height = "100%";
    segment.style.backgroundColor = cssColour(colour);
    band.append(segment);
    element.append(band);
    return band;
  });
  const place = (child: HTMLElement, rect: Rect) => {
    Object.assign(child.style, {
      height: `${rect.height}px`,
      left: `${rect.x - frame.x}px`,
      top: `${rect.y - frame.y}px`,
      width: `${rect.width}px`,
    });
  };
  const show = (state: ProgressBarState, value: number) => {
    const layout = progressBarLayout(style, frame, value);
    place(track, layout.track);
    bands.forEach((band, index) => {
      const rect = layout.fills[index];
      if (rect !== undefined) {
        place(band, rect);
      }
    });
    element.hidden = false;
    element.dataset.state = state;
    if (state === "pending") {
      element.removeAttribute("aria-valuenow");
    } else {
      element.setAttribute("aria-valuenow", String(layout.value));
    }
  };
  const update = (value: ProgressValue) => {
    if (value !== undefined && Number.isFinite(value)) {
      show("determinate", value);
    } else {
      show("pending", 1);
    }
  };
  update(undefined);
  parent.append(element);
  return {
    element,
    remove: () => element.remove(),
    report(snapshot) {
      if (snapshot.active) {
        update(snapshot.value);
      } else if (element.dataset.state === "determinate") {
        show("complete", 1);
      } else if (element.dataset.state !== "complete") {
        element.hidden = true;
        element.dataset.state = "idle";
        element.removeAttribute("aria-valuenow");
      }
    },
    update,
  };
}
