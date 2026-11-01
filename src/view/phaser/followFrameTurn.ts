import type { Game, Input } from "phaser";

import type { Rect } from "../../rect";
import { needsRefit } from "../fitCheck";
import type { FrameTurnWatch } from "../frameTurn";
import { pageToGame } from "../pagePoint";
import { settleFit } from "../settleFit";

// How often the fit is checked while the page is visible (needsRefit), in ms.
export const FIT_CHECK_MS = 250;

// The CSS property on <html> that the turned-frame stylesheets cap the page's height at: the
// visible area's height.
export const PAGE_HEIGHT_PROPERTY = "--page-height";

// The page's visible area, in CSS pixels: the visual viewport where the browser has one.
function visibleArea(): Rect {
  const view = window.visualViewport;
  return view
    ? { height: view.height, width: view.width, x: view.offsetLeft, y: view.offsetTop }
    : { height: window.innerHeight, width: window.innerWidth, x: 0, y: 0 };
}

// Has Phaser fit, place and read pointers on a canvas whose page frame watch turns
// (frameTurn.ts), and keeps the fit right as the page changes. Phaser measures the parent and
// the canvas, and maps pointers, by their bounding rects on the page, which a turn swaps, so
// while turned it measures the parent's own layout size, leaves the canvas's placement to the
// page's stylesheet (Phaser's autoCenter measures the turned canvas), and maps each pointer
// through the turn with pageToGame. gameSize is the game's size in game pixels, read on each
// pointer, so a game whose size changes passes Phaser's own.
//
// Phaser measures the parent on window resizes only, but its size also changes without one: an
// installed app learns its safe-area insets after the first layout, page UI can change its
// height just after the game starts, the frame turns, and a page coming back from the
// background can report sizes before it has laid itself out again. So it keeps
// PAGE_HEIGHT_PROPERTY at the visible area's height for the stylesheets, refits whenever parent
// changes size, and on every signal that the visible area or the turn may have changed (a
// resize, the visual viewport, the phone turning, fullscreen, a return from the background or
// the back-forward cache, or focus) rechecks the turn and refits until the sizes settle
// (settleFit). While the page is visible, a check every FIT_CHECK_MS rechecks the turn and does
// the same for a fit gone stale with no signal at all (needsRefit).
export function followFrameTurn(
  game: Game,
  parent: HTMLElement,
  watch: Pick<FrameTurnWatch, "onChange" | "recheck" | "turn">,
  gameSize: Pick<Rect, "height" | "width">,
): void {
  const scale = game.scale;
  const measureParent = scale.getParentBounds.bind(scale);
  scale.getParentBounds = () => {
    if (watch.turn() === 0) {
      return measureParent();
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
    if (watch.turn() === 0) {
      centre();
      return;
    }
    game.canvas.style.marginLeft = "";
    game.canvas.style.marginTop = "";
  };
  const input = game.input;
  const transform = input.transformPointer.bind(input);
  input.transformPointer = (pointer: Input.Pointer, pageX: number, pageY: number, wasMove) => {
    const now = watch.turn();
    if (now === 0) {
      transform(pointer, pageX, pageY, wasMove);
      return;
    }
    const client = { x: pageX - window.scrollX, y: pageY - window.scrollY };
    const point = pageToGame(now, game.canvas.getBoundingClientRect(), gameSize, client);
    pointer.prevPosition.copy(pointer.position);
    pointer.position.set(point.x, point.y);
  };

  const root = document.documentElement.style;
  const publish = () => {
    const value = `${visibleArea().height}px`;
    if (root.getPropertyValue(PAGE_HEIGHT_PROPERTY) !== value) {
      root.setProperty(PAGE_HEIGHT_PROPERTY, value);
    }
  };
  const refit = () => {
    publish();
    scale.getParentBounds();
    scale.refresh();
  };
  const measure = () => {
    const { height, width } = visibleArea();
    return [width, height, parent.offsetWidth, parent.offsetHeight, watch.turn()].join();
  };
  let stopSettling: () => void = () => undefined;
  const settle = () => {
    stopSettling();
    stopSettling = settleFit((callback) => requestAnimationFrame(callback), measure, refit);
  };
  const onSignal = () => {
    watch.recheck();
    settle();
  };
  watch.onChange(settle);
  new ResizeObserver(refit).observe(parent);
  for (const type of ["resize", "orientationchange", "pageshow", "focus"]) {
    window.addEventListener(type, onSignal);
  }
  document.addEventListener("fullscreenchange", onSignal);
  window.visualViewport?.addEventListener("resize", onSignal);
  window.visualViewport?.addEventListener("scroll", onSignal);

  const check = () => {
    watch.recheck();
    publish();
    const canvas = game.canvas.getBoundingClientRect();
    const playArea = { height: parent.offsetHeight, width: parent.offsetWidth };
    if (needsRefit(visibleArea(), canvas, playArea, scale.parentSize)) {
      settle();
    }
  };
  let timer: ReturnType<typeof setInterval> | undefined;
  const followVisibility = () => {
    const visible = document.visibilityState === "visible";
    if (visible && timer === undefined) {
      timer = setInterval(check, FIT_CHECK_MS);
    } else if (!visible && timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };
  document.addEventListener("visibilitychange", () => {
    followVisibility();
    onSignal();
  });
  followVisibility();
  publish();
}
