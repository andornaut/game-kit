import type { Point } from "../rect";

// The parts of a PointerEvent that the listener and its callers read.
export interface PagePointerEvent {
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerId: number;
  readonly pointerType: string;
  readonly target: EventTarget | null;
  readonly timeStamp: number;
}

// One press of a pointer, from its pointerdown until it lifts or the browser cancels it. downTime,
// its pointerdown's timeStamp, tells it from the same pointer's next press.
export interface PagePress {
  readonly downTime: number;
  readonly pointerId: number;
}

// What a followed press does at each of its events. cancel: the browser called the press off (a
// system gesture, an incoming call).
export interface PagePressHandlers {
  cancel?: (press: PagePress, event: PagePointerEvent) => void;
  down: (press: PagePress, event: PagePointerEvent) => void;
  move?: (press: PagePress, event: PagePointerEvent) => void;
  up?: (press: PagePress, event: PagePointerEvent) => void;
}

const POINTER_EVENTS = ["pointerdown", "pointermove", "pointerup", "pointercancel"] as const;

// Page UI that keeps its own presses: links, buttons and the nav bar, as a CSS selector.
export const PAGE_CONTROLS = "a, button, nav";

// The event's point on the page, in client pixels.
export function clientPoint(event: PagePointerEvent): Point {
  return { x: event.clientX, y: event.clientY };
}

// Whether target is one of the bare page's own elements, such as its root, its body and the
// game's container around the canvas: not the canvas, and not page UI.
export function onBarePage(
  bare: readonly (EventTarget | null)[],
  target: EventTarget | null,
): boolean {
  return target !== null && bare.includes(target);
}

// Whether target is a link, a button or the nav bar, or inside one.
export function onPageControl(target: EventTarget | null): boolean {
  const element = target as { closest?: (selectors: string) => unknown } | null;
  return typeof element?.closest === "function" && element.closest(PAGE_CONTROLS) !== null;
}

// Follows each press on eventTarget (the page's document or window) that accepts takes at its
// pointerdown, wherever it then travels, until it lifts or the browser cancels it. A press
// accepts refuses is never followed. Returns a function that removes the listeners.
export function listenPagePresses(
  accepts: (event: PagePointerEvent) => boolean,
  handlers: PagePressHandlers,
  eventTarget: EventTarget,
): () => void {
  const presses = new Map<number, PagePress>();
  const end = (event: PagePointerEvent, handler: PagePressHandlers["up"]) => {
    const press = presses.get(event.pointerId);
    presses.delete(event.pointerId);
    if (press !== undefined) {
      handler?.(press, event);
    }
  };
  const listeners: Record<(typeof POINTER_EVENTS)[number], (event: PagePointerEvent) => void> = {
    pointercancel: (event) => end(event, handlers.cancel),
    pointerdown: (event) => {
      if (!accepts(event)) {
        return;
      }
      const press = { downTime: event.timeStamp, pointerId: event.pointerId };
      presses.set(event.pointerId, press);
      handlers.down(press, event);
    },
    pointermove: (event) => {
      const press = presses.get(event.pointerId);
      if (press !== undefined) {
        handlers.move?.(press, event);
      }
    },
    pointerup: (event) => end(event, handlers.up),
  };
  // Each listener is added for a pointer event only.
  const asListener = (listener: (event: PagePointerEvent) => void) =>
    listener as unknown as EventListener;
  for (const type of POINTER_EVENTS) {
    eventTarget.addEventListener(type, asListener(listeners[type]));
  }
  return () => {
    for (const type of POINTER_EVENTS) {
      eventTarget.removeEventListener(type, asListener(listeners[type]));
    }
  };
}
