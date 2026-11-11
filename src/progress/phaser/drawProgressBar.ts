import type { GameObjects } from "phaser";

import {
  type ProgressBarLayout,
  progressBarLayout,
  type ProgressBarStyle,
  type ProgressDisplay,
  progressDisplayLayout,
  type ProgressMotion,
} from "../../progress.ts";
import type { Rect } from "../../rect.ts";

type ProgressGraphics = Pick<GameObjects.Graphics, "fillRect" | "fillStyle">;

const drawLayout = (
  graphics: ProgressGraphics,
  style: ProgressBarStyle,
  layout: ProgressBarLayout,
) => {
  const draw = (colour: number, rect: Rect) => {
    if (rect.width > 0 && rect.height > 0) {
      graphics.fillStyle(colour, 1);
      graphics.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
  };
  draw(style.frame, layout.frame);
  draw(style.track, layout.track);
  layout.fills.forEach((rect, index) => draw(style.fills[index] ?? style.track, rect));
};

// A measured bar, such as a gameplay meter. The caller clears its graphics when needed; this
// draws no animation and owns no clock.
export function drawProgressBar(
  graphics: ProgressGraphics,
  style: ProgressBarStyle,
  frame: Rect,
  progress: number,
): void {
  drawLayout(graphics, style, progressBarLayout(style, frame, progress));
}

// A loading bar as display shows it, drawing nothing while hidden. The caller clears its
// graphics and redraws each frame with display from createProgressDisplay's at(nowMs), so the
// indeterminate segment travels on the caller's clock; this owns no clock.
export function drawProgressDisplay(
  graphics: ProgressGraphics,
  style: ProgressBarStyle,
  motion: ProgressMotion,
  frame: Rect,
  display: ProgressDisplay,
): void {
  const layout = progressDisplayLayout(style, motion, frame, display);
  if (layout !== undefined) {
    drawLayout(graphics, style, layout);
  }
}
