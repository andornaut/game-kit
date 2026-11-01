import type { GameObjects } from "phaser";

import { progressBarLayout, type ProgressBarStyle, type ProgressValue } from "../../progress.ts";
import type { Rect } from "../../rect.ts";

// The caller clears its graphics when needed; this draws no animation and owns no clock.
export function drawProgressBar(
  graphics: Pick<GameObjects.Graphics, "fillRect" | "fillStyle">,
  style: ProgressBarStyle,
  frame: Rect,
  progress: ProgressValue,
): void {
  const layout = progressBarLayout(style, frame, progress);
  const draw = (colour: number, rect: Rect) => {
    if (rect.width > 0 && rect.height > 0) {
      graphics.fillStyle(colour, 1);
      graphics.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
  };
  draw(style.frame, layout.frame);
  draw(style.track, layout.track);
  layout.fills.forEach((rect, index) => draw(style.fills[index] ?? style.track, rect));
}
