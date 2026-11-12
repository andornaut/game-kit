import type { GameObjects } from "phaser";

import {
  checkProgressBarStyle,
  type ProgressBarLayout,
  progressBarLayout,
  type ProgressBarStyle,
  type ProgressDisplay,
  progressDisplayLayout,
  type ProgressMotion,
} from "../../progress.ts";
import type { Rect } from "../../rect.ts";

type ProgressGraphics = Pick<GameObjects.Graphics, "fillRect" | "fillStyle">;

// Each rect's alpha is its style alpha times the layout's opacity, and a rect at alpha zero is
// not drawn. Rects blend separately rather than as one group, which differs from the DOM bar's
// whole-element opacity only where a translucent track overlaps a visible frame.
const drawLayout = (
  graphics: ProgressGraphics,
  style: ProgressBarStyle,
  layout: ProgressBarLayout,
) => {
  const opacity = layout.opacity ?? 1;
  const draw = (colour: number, alpha: number, rect: Rect) => {
    const shown = alpha * opacity;
    if (shown > 0 && rect.width > 0 && rect.height > 0) {
      graphics.fillStyle(colour, shown);
      graphics.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
  };
  draw(style.frame, style.frameAlpha ?? 1, layout.frame);
  draw(style.track, style.trackAlpha ?? 1, layout.track);
  layout.fills.forEach((rect, index) => draw(style.fills[index] ?? style.track, 1, rect));
};

// A measured bar, such as a gameplay meter. The caller clears its graphics when needed; this
// draws no animation and owns no clock. Throws as checkProgressBarStyle does.
export function drawProgressBar(
  graphics: ProgressGraphics,
  style: ProgressBarStyle,
  frame: Rect,
  progress: number,
): void {
  checkProgressBarStyle(style);
  drawLayout(graphics, style, progressBarLayout(style, frame, progress));
}

// A loading bar as display shows it, drawing nothing while hidden. The caller clears its
// graphics and redraws each frame with display from createProgressDisplay's at(nowMs), so the
// indeterminate segment travels and a finished bar fades on the caller's clock; this owns no
// clock. Throws as checkProgressBarStyle does.
export function drawProgressDisplay(
  graphics: ProgressGraphics,
  style: ProgressBarStyle,
  motion: ProgressMotion,
  frame: Rect,
  display: ProgressDisplay,
): void {
  checkProgressBarStyle(style);
  const layout = progressDisplayLayout(style, motion, frame, display);
  if (layout !== undefined) {
    drawLayout(graphics, style, layout);
  }
}
