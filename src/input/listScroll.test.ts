import { describe, expect, it } from "vitest";

import {
  dragScroll,
  isDragging,
  type ListScroll,
  listScroll,
  pageKeyScroll,
  pressScroll,
  releaseScroll,
  resizeScroll,
  scrollBy,
  scrollMax,
  type ScrollRule,
  scrollTo,
  scrollToShow,
  stepScroll,
  wheelScroll,
} from "./listScroll.ts";
import { pressDown, pressUp, type TargetPressRule } from "./targetPress.ts";

const RULE: ScrollRule = {
  decayMs: 300,
  dragSlopPx: 10,
  flingWindowMs: 100,
  stopPxPerMs: 0.02,
  wheelScale: 0.5,
};
const MAX = 200;
const VIEW = { height: 400, y: 100 };

describe("a list's scroll", () => {
  it.each<[string, (scroll: ListScroll) => ListScroll, number]>([
    ["scrolls to a y inside the list", (s) => scrollTo(120, s), 120],
    ["stops at the top", (s) => scrollTo(-50, s), 0],
    ["stops at the bottom", (s) => scrollTo(MAX + 50, s), MAX],
    ["moves by an amount", (s) => scrollBy(30, scrollTo(50, s)), 80],
    ["moves by the wheel times its scale", (s) => wheelScroll(RULE, 100, s), 50],
    ["keeps a shrunk list inside it", (s) => resizeScroll(40, scrollTo(150, s)), 40],
    ["goes to the bottom on End", (s) => pageKeyScroll(60, "End", s) ?? s, MAX],
    ["goes to the top on Home", (s) => pageKeyScroll(60, "Home", scrollTo(120, s)) ?? s, 0],
    ["moves a page down on PageDown", (s) => pageKeyScroll(60, "PageDown", s) ?? s, 60],
    ["moves a page up on PageUp", (s) => pageKeyScroll(60, "PageUp", scrollTo(100, s)) ?? s, 40],
  ])("%s", (_, act, y) => {
    expect(act(listScroll(MAX)).y).toBe(y);
  });

  it("leaves every other key to the scene", () => {
    expect(pageKeyScroll(60, "ArrowDown", listScroll(MAX))).toBeUndefined();
  });

  it.each<[string, number, number]>([
    ["can move as far as the content runs past the view", 700, 200],
    ["cannot move content that fits the view", 450, 0],
  ])("%s", (_, contentBottom, max) => {
    expect(scrollMax(VIEW, contentBottom)).toBe(max);
  });

  // y: the scroll before. rect: a row as laid out at scroll 0. The view runs 100 to 500.
  it.each<[string, number, number, number]>([
    ["leaves a row in view alone", 0, 200, 0],
    ["scrolls up to a row above the view", 150, 180, 80],
    ["scrolls down to a row below the view", 0, 520, 60],
  ])("%s", (_, y, rectY, shown) => {
    const rect = { height: 40, y: rectY };
    expect(scrollToShow(VIEW, rect, scrollTo(y, listScroll(MAX))).y).toBe(shown);
  });
});

// A press at y 300 moves through moves (each [y, ms]) and lifts at liftMs.
function dragThrough(moves: readonly (readonly [number, number])[], from = 100): ListScroll {
  let scroll = pressScroll(300, 0, scrollTo(from, listScroll(MAX)));
  for (const [y, ms] of moves) {
    scroll = dragScroll(RULE, y, ms, scroll);
  }
  return scroll;
}

describe("a drag on a list", () => {
  // moves: the finger's y and time after a press at 300 with the list at 100.
  it.each<[string, readonly (readonly [number, number])[], boolean, number]>([
    ["stays a press within the slop", [[310, 50]], false, 100],
    ["drags once past the slop, from where it passed it", [[311, 50]], true, 100],
    [
      "moves the list against the finger",
      [
        [311, 50],
        [261, 100],
      ],
      true,
      150,
    ],
    [
      "stops at the top",
      [
        [311, 50],
        [600, 100],
      ],
      true,
      0,
    ],
    [
      "stops at the bottom",
      [
        [289, 50],
        [0, 100],
      ],
      true,
      MAX,
    ],
  ])("%s", (_, moves, dragging, y) => {
    const scroll = dragThrough(moves);
    expect(isDragging(scroll)).toBe(dragging);
    expect(scroll.y).toBe(y);
  });

  // A press on a row that lifts over the same row taps it, unless the drag took it.
  const tapRule: TargetPressRule<string> = {
    dipMs: () => 0,
    opens: () => false,
    same: (a, b) => a === b,
  };
  it.each<[string, readonly (readonly [number, number])[], string]>([
    ["a still press taps its row", [], "tap"],
    ["a press that wobbles within the slop taps its row", [[308, 40]], "tap"],
    [
      "a drag past the slop taps nothing",
      [
        [311, 40],
        [300, 80],
      ],
      "none",
    ],
  ])("%s", (_, moves, release) => {
    let press = pressDown(0, "row");
    const scroll = dragThrough(moves);
    if (isDragging(scroll)) {
      press = undefined;
    }
    expect(pressUp(tapRule, 120, false, press, "row").kind).toBe(release);
  });
});

describe("a fling", () => {
  // A drag up 60 pixels in 100ms, 0.6 pixels a millisecond, lifted at liftMs.
  const flung = (reducedMotion: boolean, liftMs: number) =>
    releaseScroll(
      RULE,
      reducedMotion,
      liftMs,
      dragThrough([
        [289, 0],
        [229, 100],
      ]),
    );

  it.each<[string, boolean, number, number]>([
    ["carries a drag's speed on", false, 100, 0.6],
    ["carries nothing with reduced motion", true, 100, 0],
    ["carries nothing once the finger rested", false, 201, 0],
  ])("%s", (_, reducedMotion, liftMs, velocity) => {
    expect(flung(reducedMotion, liftMs).velocity).toBeCloseTo(velocity);
  });

  it("slows each step and comes to rest inside the list", () => {
    let scroll = flung(false, 100);
    const speeds = [scroll.velocity];
    for (let i = 0; i < 200 && scroll.velocity !== 0; i++) {
      scroll = stepScroll(RULE, 16, scroll);
      speeds.push(Math.abs(scroll.velocity));
    }
    expect(scroll.velocity).toBe(0);
    expect(speeds.slice(1).every((speed, i) => speed < (speeds[i] ?? 0))).toBe(true);
    expect(scroll.y).toBeGreaterThan(160);
    expect(scroll.y).toBeLessThanOrEqual(MAX);
  });

  it("stops at an end", () => {
    const fast = { ...listScroll(MAX, 190), velocity: 5 };
    expect(stepScroll(RULE, 16, fast)).toMatchObject({ velocity: 0, y: MAX });
  });

  it("stops when a finger catches it", () => {
    const moving = { ...listScroll(MAX, 50), velocity: 1 };
    const caught = pressScroll(300, 0, moving);
    expect(stepScroll(RULE, 16, caught)).toMatchObject({ velocity: 0, y: 50 });
  });
});
