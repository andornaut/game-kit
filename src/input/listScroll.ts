// A list taller than its view, moved by a finger or mouse drag, the wheel or keys. y is how far
// the list has moved up, from 0 at its top to max at its bottom. A press that travels further
// than dragSlopPx up or down drags the list, and its release taps nothing. A drag's release
// flings the list on at the drag's speed, slowing until it stops or reaches an end; with
// reduced motion it stops where the finger lifts.
export interface ScrollRule {
  // A fling's speed falls by a factor of e every decayMs.
  readonly decayMs: number;
  readonly dragSlopPx: number;
  // A release more than this long after the last move flings nothing.
  readonly flingWindowMs: number;
  // A fling slower than this, in pixels per millisecond, stops.
  readonly stopPxPerMs: number;
  // Screen pixels the list moves per pixel the wheel reports.
  readonly wheelScale: number;
}

// A finger on the list: where it went down and the list's y then, where it last was, and its
// speed in list pixels per millisecond. dragging: it has passed the slop, so it moves the list.
interface ScrollDrag {
  readonly dragging: boolean;
  readonly fromY: number;
  readonly lastMs: number;
  readonly lastY: number;
  readonly startY: number;
  readonly velocity: number;
}

export interface ListScroll {
  readonly drag: ScrollDrag | null;
  readonly max: number;
  readonly velocity: number;
  readonly y: number;
}

function clampScroll(max: number, y: number): number {
  return Math.min(Math.max(0, max), Math.max(0, y));
}

// A list max pixels taller than its view, at y.
export function listScroll(max: number, y = 0): ListScroll {
  return { drag: null, max: Math.max(0, max), velocity: 0, y: clampScroll(max, y) };
}

// How far a list whose content runs from the view's top to contentBottom can move.
export function scrollMax(view: { height: number; y: number }, contentBottom: number): number {
  return Math.max(0, contentBottom - (view.y + view.height));
}

// The list grown or shrunk to max, kept inside it.
export function resizeScroll(max: number, scroll: ListScroll): ListScroll {
  const most = Math.max(0, max);
  return { ...scroll, max: most, y: clampScroll(most, scroll.y) };
}

export function isDragging(scroll: ListScroll): boolean {
  return scroll.drag?.dragging === true;
}

// The list at y, its fling stopped.
export function scrollTo(y: number, scroll: ListScroll): ListScroll {
  return { ...scroll, velocity: 0, y: clampScroll(scroll.max, y) };
}

export function scrollBy(dy: number, scroll: ListScroll): ListScroll {
  return scrollTo(scroll.y + dy, scroll);
}

export function wheelScroll(rule: ScrollRule, deltaY: number, scroll: ListScroll): ListScroll {
  return scrollBy(deltaY * rule.wheelScale, scroll);
}

// The list moved by a page key: Home and End to its ends, PageUp and PageDown by page. undefined
// for any other key.
export function pageKeyScroll(
  page: number,
  key: string,
  scroll: ListScroll,
): ListScroll | undefined {
  switch (key) {
    case "End":
      return scrollTo(scroll.max, scroll);
    case "Home":
      return scrollTo(0, scroll);
    case "PageDown":
      return scrollBy(page, scroll);
    case "PageUp":
      return scrollBy(-page, scroll);
    default:
      return undefined;
  }
}

// The least move that brings rect, laid out with the list at its top, inside the view.
export function scrollToShow(
  view: { height: number; y: number },
  rect: { height: number; y: number },
  scroll: ListScroll,
): ListScroll {
  const top = rect.y - view.y;
  const bottom = rect.y + rect.height - (view.y + view.height);
  if (top < scroll.y) {
    return scrollTo(top, scroll);
  }
  return bottom > scroll.y ? scrollTo(bottom, scroll) : scroll;
}

// A finger goes down at pointerY, catching any fling.
export function pressScroll(pointerY: number, nowMs: number, scroll: ListScroll): ListScroll {
  const drag: ScrollDrag = {
    dragging: false,
    fromY: scroll.y,
    lastMs: nowMs,
    lastY: pointerY,
    startY: pointerY,
    velocity: 0,
  };
  return { ...scroll, drag, velocity: 0 };
}

// The finger moves to pointerY. Once past the slop the list follows it from there, so it does
// not jump by the slop.
export function dragScroll(
  rule: ScrollRule,
  pointerY: number,
  nowMs: number,
  scroll: ListScroll,
): ListScroll {
  const drag = scroll.drag;
  if (drag === null) {
    return scroll;
  }
  if (!drag.dragging) {
    if (Math.abs(pointerY - drag.startY) <= rule.dragSlopPx) {
      return scroll;
    }
    const started = { ...drag, dragging: true, lastMs: nowMs, lastY: pointerY, startY: pointerY };
    return { ...scroll, drag: started };
  }
  const elapsed = nowMs - drag.lastMs;
  const velocity = elapsed > 0 ? (drag.lastY - pointerY) / elapsed : drag.velocity;
  const y = clampScroll(scroll.max, drag.fromY - (pointerY - drag.startY));
  return { ...scroll, drag: { ...drag, lastMs: nowMs, lastY: pointerY, velocity }, y };
}

// The finger lifts: a drag flings on at its speed, unless the finger rested first or motion
// is reduced.
export function releaseScroll(
  rule: ScrollRule,
  reducedMotion: boolean,
  nowMs: number,
  scroll: ListScroll,
): ListScroll {
  const drag = scroll.drag;
  const flings =
    drag !== null && drag.dragging && !reducedMotion && nowMs - drag.lastMs <= rule.flingWindowMs;
  return { ...scroll, drag: null, velocity: flings ? drag.velocity : 0 };
}

// A fling dtMs on: it moves the list at its speed, slowing, and stops at an end or once slow.
export function stepScroll(rule: ScrollRule, dtMs: number, scroll: ListScroll): ListScroll {
  if (scroll.drag !== null || scroll.velocity === 0) {
    return scroll;
  }
  const y = clampScroll(scroll.max, scroll.y + scroll.velocity * dtMs);
  const slowed = scroll.velocity * Math.exp(-dtMs / rule.decayMs);
  const atEnd = y === 0 || y === scroll.max;
  const velocity = atEnd || Math.abs(slowed) < rule.stopPxPerMs ? 0 : slowed;
  return { ...scroll, velocity, y };
}
