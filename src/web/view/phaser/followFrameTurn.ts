import { type Game, type Input, Scale } from "phaser";

import type { Rect } from "../../../rect.ts";
import { needsRefit } from "../../../view/fitCheck.ts";
import { pageToGame } from "../../../view/pagePoint.ts";
import { renderScale } from "../../../view/renderScale.ts";
import { settleFit } from "../../../view/settleFit.ts";
import type { FrameTurnWatch } from "../dom/watchFrameTurn.ts";

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

// Has Phaser fit, place and read pointers on game's canvas in parent, whose page frame watch
// turns (dom/watchFrameTurn.ts), and keeps the fit right as the page changes. Phaser measures the
// parent and the canvas, and maps pointers, by their bounding rects on the page, which a turn
// swaps, so
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
// the same for a fit gone stale with no signal at all (needsRefit). The returned disposer and
// game destruction release this installation; the page retains its CSS property ownership.
//
// With deviceResolution, the canvas's backing is in device pixels. With r = renderScale(max,
// devicePixelRatio), installation and each refit set Scale.NONE, resize the game to
// round(parent CSS size x r) and zoom it by 1 / r, so the canvas keeps the parent's CSS size while
// gameSize, pointers and cameras are in device pixels. Above max the browser upscales the canvas
// by devicePixelRatio / r, with image-rendering: pixelated. Scale.refresh does not resize in NONE
// mode, so a devicePixelRatio change (browser zoom, a move to another screen) refits through a
// matchMedia resolution listener, re-armed at each change.
export function followFrameTurn(
  watch: Pick<FrameTurnWatch, "onChange" | "recheck" | "turn">,
  gameSize: Pick<Rect, "height" | "width">,
  parent: HTMLElement,
  game: Game,
  options: { readonly deviceResolution?: { readonly max: number } } = {},
): () => void {
  const { deviceResolution } = options;
  let disposed = false;
  const scale = game.scale;
  const originalBounds = scale.getParentBounds;
  const measureParent = originalBounds.bind(scale);
  const wrappedBounds = () => {
    if (disposed || watch.turn() === 0) {
      return measureParent();
    }
    const { offsetHeight: height, offsetWidth: width } = parent;
    if (scale.parentSize.width === width && scale.parentSize.height === height) {
      return false;
    }
    scale.parentSize.setSize(width, height);
    return true;
  };
  scale.getParentBounds = wrappedBounds;
  const originalCentre = scale.updateCenter;
  const centre = originalCentre.bind(scale);
  const wrappedCentre = () => {
    if (disposed || watch.turn() === 0) {
      centre();
      return;
    }
    game.canvas.style.marginLeft = "";
    game.canvas.style.marginTop = "";
  };
  scale.updateCenter = wrappedCentre;
  const input = game.input;
  const originalTransform = input.transformPointer;
  const transform = originalTransform.bind(input);
  const wrappedTransform: typeof input.transformPointer = (
    pointer: Input.Pointer,
    pageX: number,
    pageY: number,
    wasMove,
  ) => {
    const now = disposed ? 0 : watch.turn();
    if (now === 0) {
      transform(pointer, pageX, pageY, wasMove);
      return;
    }
    const client = { x: pageX - window.scrollX, y: pageY - window.scrollY };
    const point = pageToGame(now, game.canvas.getBoundingClientRect(), gameSize, client);
    pointer.prevPosition.copy(pointer.position);
    pointer.position.set(point.x, point.y);
  };

  input.transformPointer = wrappedTransform;
  const root = document.documentElement.style;
  const publish = () => {
    const value = `${visibleArea().height}px`;
    if (root.getPropertyValue(PAGE_HEIGHT_PROPERTY) !== value) {
      root.setProperty(PAGE_HEIGHT_PROPERTY, value);
    }
  };
  const fitDevice = (max: number) => {
    const r = renderScale(max, window.devicePixelRatio);
    const { height, width } = scale.parentSize;
    if (!(width > 0 && height > 0)) {
      return;
    }
    game.canvas.style.imageRendering = "pixelated";
    scale.scaleMode = Scale.ScaleModes.NONE;
    scale.resize(Math.round(width * r), Math.round(height * r));
    // After resize: setZoom rewrites the canvas's CSS size from the new game size, which resize
    // leaves stale at zoom 1, and refreshes the bounds.
    scale.setZoom(1 / r);
  };
  const refit = () => {
    if (disposed) {
      return;
    }
    publish();
    scale.getParentBounds();
    if (deviceResolution) {
      fitDevice(deviceResolution.max);
    } else {
      scale.refresh();
    }
  };
  const measure = () => {
    const { height, width } = visibleArea();
    return [width, height, parent.offsetWidth, parent.offsetHeight, watch.turn()].join();
  };
  let stopSettling: () => void = () => undefined;
  const settle = () => {
    if (disposed) {
      return;
    }
    stopSettling();
    stopSettling = settleFit((callback) => requestAnimationFrame(callback), measure, refit);
  };
  const onSignal = () => {
    if (disposed) {
      return;
    }
    watch.recheck();
    settle();
  };
  const stopWatching = watch.onChange(settle);
  let density: MediaQueryList | undefined;
  const onDensity = () => {
    if (disposed) {
      return;
    }
    watchDensity();
    onSignal();
  };
  const watchDensity = () => {
    density?.removeEventListener("change", onDensity);
    density = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    density.addEventListener("change", onDensity);
  };
  if (deviceResolution) {
    watchDensity();
  }
  const observer = new ResizeObserver(refit);
  observer.observe(parent);
  const signals = ["resize", "orientationchange", "pageshow", "focus"] as const;
  for (const type of signals) {
    window.addEventListener(type, onSignal);
  }
  document.addEventListener("fullscreenchange", onSignal);
  const viewport = window.visualViewport;
  viewport?.addEventListener("resize", onSignal);
  viewport?.addEventListener("scroll", onSignal);

  const check = () => {
    if (disposed) {
      return;
    }
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
    if (disposed) {
      return;
    }
    const visible = document.visibilityState === "visible";
    if (visible && timer === undefined) {
      timer = setInterval(check, FIT_CHECK_MS);
    } else if (!visible && timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };
  const onVisibility = () => {
    followVisibility();
    onSignal();
  };
  document.addEventListener("visibilitychange", onVisibility);
  // Release only the callbacks and method wrappers owned by this installation.
  const dispose = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    stopSettling();
    stopWatching();
    observer.disconnect();
    density?.removeEventListener("change", onDensity);
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
    for (const type of signals) {
      window.removeEventListener(type, onSignal);
    }
    document.removeEventListener("fullscreenchange", onSignal);
    document.removeEventListener("visibilitychange", onVisibility);
    viewport?.removeEventListener("resize", onSignal);
    viewport?.removeEventListener("scroll", onSignal);
    game.events.off("destroy", dispose);
    if (scale.getParentBounds === wrappedBounds) {
      scale.getParentBounds = originalBounds;
    }
    if (scale.updateCenter === wrappedCentre) {
      scale.updateCenter = originalCentre;
    }
    if (input.transformPointer === wrappedTransform) {
      input.transformPointer = originalTransform;
    }
  };
  game.events.once("destroy", dispose);
  followVisibility();
  publish();
  if (deviceResolution) {
    refit();
  }
  return dispose;
}
