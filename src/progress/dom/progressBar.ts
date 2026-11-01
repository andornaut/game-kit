import { progressBarLayout, type ProgressBarStyle, type ProgressValue } from "../../progress.ts";
import type { Rect } from "../../rect.ts";

const cssColour = (colour: number) => `#${colour.toString(16).padStart(6, "0")}`;

// The caller owns the coordinate space, scaling, visibility and accessible label. This adapter
// imports no renderer and can mount before the game's Phaser module is loaded.
export function createDomProgressBar(
  parent: HTMLElement,
  style: ProgressBarStyle,
  frame: Rect,
): { element: HTMLDivElement; remove(): void; update(value: ProgressValue): void } {
  const document = parent.ownerDocument;
  const element = document.createElement("div");
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
  const add = (colour: number) => {
    const child = document.createElement("div");
    child.style.position = "absolute";
    child.style.backgroundColor = cssColour(colour);
    element.append(child);
    return child;
  };
  const track = add(style.track);
  const fills = style.fills.map(add);
  const place = (child: HTMLElement, rect: Rect) => {
    Object.assign(child.style, {
      height: `${rect.height}px`,
      left: `${rect.x - frame.x}px`,
      top: `${rect.y - frame.y}px`,
      width: `${rect.width}px`,
    });
  };
  const update = (value: ProgressValue) => {
    const layout = progressBarLayout(style, frame, value);
    place(track, layout.track);
    fills.forEach((child, index) => {
      const rect = layout.fills[index];
      if (rect !== undefined) {
        place(child, rect);
      }
    });
    element.dataset.state = layout.value === undefined ? "pending" : "determinate";
    if (layout.value === undefined) {
      element.removeAttribute("aria-valuenow");
    } else {
      element.setAttribute("aria-valuenow", String(layout.value));
    }
  };
  update(undefined);
  parent.append(element);
  return { element, remove: () => element.remove(), update };
}
