// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { refuse } from "./refusalCue.ts";

const CUE = { shake: 3, stepMs: 80, steps: 4 };

// The cue's state on element: red or not, and its shake.
const state = (element: HTMLElement) => [
  element.hasAttribute("data-ui-refusal-red"),
  element.getAttribute("data-ui-refusal-shake"),
];

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("refuse", () => {
  it("shakes left in red, then right, each step, then rests", () => {
    const element = document.createElement("button");
    refuse(CUE, false, element);
    expect(element.style.getPropertyValue("--ui-refusal-shake")).toBe("3");
    const states = [state(element)];
    for (let step = 1; step <= 4; step++) {
      vi.advanceTimersByTime(80);
      states.push(state(element));
    }
    expect(states).toEqual([
      [true, "left"],
      [false, "right"],
      [true, "left"],
      [false, "right"],
      [false, null],
    ]);
    expect(element.style.getPropertyValue("--ui-refusal-shake")).toBe("");
  });

  it("holds red without moving under reduced motion", () => {
    const element = document.createElement("button");
    refuse(CUE, true, element);
    vi.advanceTimersByTime(319);
    const held = state(element);
    vi.advanceTimersByTime(1);
    expect([held, state(element)]).toEqual([
      [true, null],
      [false, null],
    ]);
  });

  it("restarts a cue already playing on the element", () => {
    const element = document.createElement("button");
    refuse(CUE, false, element);
    vi.advanceTimersByTime(240);
    refuse(CUE, false, element);
    vi.advanceTimersByTime(240);
    expect(state(element)).toEqual([false, "right"]);
  });

  it("stops at once when asked", () => {
    const element = document.createElement("button");
    const stop = refuse(CUE, false, element);
    stop();
    vi.advanceTimersByTime(80);
    expect(state(element)).toEqual([false, null]);
  });
});
