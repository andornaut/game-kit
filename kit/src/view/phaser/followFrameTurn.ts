import type { Game, Input } from "phaser";

import type { Rect } from "../../rect";
import { type FrameTurn, pageToGame } from "../pagePoint";

// Has Phaser fit, place and read pointers on a canvas whose page frame turn() turns (frameTurn.ts),
// and refit whenever parent, the canvas's parent, changes size. Phaser measures the parent and
// the canvas, and maps pointers, by their bounding rects on the page, which a turn swaps, so
// while turned it measures the parent's own layout size, leaves the canvas's placement to the
// page's stylesheet (Phaser's autoCenter measures the turned canvas), and maps each pointer
// through the turn with pageToGame. gameSize is the game's size in game pixels. Phaser measures
// the parent on window resizes only, but its size also changes without one: an installed app
// learns its safe-area insets after the first layout, page UI can change its height just after
// the game starts, and the frame turns.
export function followFrameTurn(
  game: Game,
  parent: HTMLElement,
  turn: () => FrameTurn,
  gameSize: Pick<Rect, "height" | "width">,
): void {
  const scale = game.scale;
  const measure = scale.getParentBounds.bind(scale);
  scale.getParentBounds = () => {
    if (turn() === 0) {
      return measure();
    }
    const { offsetHeight: height, offsetWidth: width } = parent;
    if (scale.parentSize.width === width && scale.parentSize.height === height) {
      return false;
    }
    scale.parentSize.setSize(width, height);
    return true;
  };
  const centre = scale.updateCenter.bind(scale);
  scale.updateCenter = () => {
    if (turn() === 0) {
      centre();
      return;
    }
    game.canvas.style.marginLeft = "";
    game.canvas.style.marginTop = "";
  };
  const input = game.input;
  const transform = input.transformPointer.bind(input);
  input.transformPointer = (pointer: Input.Pointer, pageX: number, pageY: number, wasMove) => {
    const now = turn();
    if (now === 0) {
      transform(pointer, pageX, pageY, wasMove);
      return;
    }
    const client = { x: pageX - window.scrollX, y: pageY - window.scrollY };
    const point = pageToGame(now, game.canvas.getBoundingClientRect(), gameSize, client);
    pointer.prevPosition.copy(pointer.position);
    pointer.position.set(point.x, point.y);
  };
  new ResizeObserver(() => {
    scale.getParentBounds();
    scale.refresh();
  }).observe(parent);
}
