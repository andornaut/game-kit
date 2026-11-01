import { describe, expect, it } from "vitest";

import type { Rect } from "../rect";
import {
  findTraversal,
  stepTraversal,
  type TraversalCollider,
  type TraversalContext,
  type TraversalState,
} from "./traversal";

const rect = (x: number, y: number, width: number, height: number): Rect => ({
  height,
  width,
  x,
  y,
});
const floor = rect(-20, 10, 100, 5);
const fixed = (
  supportId: object,
  before: Rect,
  kind: "solid" | "ledge" = "solid",
): TraversalCollider<object> => ({ after: before, before, kind, supportId });
const ground = {};
function context(colliders: readonly TraversalCollider<object>[]): TraversalContext<object> {
  return {
    body: { height: 2, offset: { x: 0, y: 0 }, width: 2 },
    bounds: rect(-20, -30, 100, 80),
    dtSeconds: 0.1,
    epsilon: 1e-7,
    maxCollisionSteps: 32,
    maxDrop: 20,
    profile: { gravity: 20, jumpSpeed: 10, maxFallSpeed: 20, walkSpeed: 10 },
    safe: () => true,
    sampleColliders: () => ({ colliders, complete: true }),
  };
}
const start: TraversalState<object> = {
  fallFromY: 10,
  grounded: true,
  supportId: ground,
  vy: 0,
  x: 0,
  y: 8,
};
const input = { jump: false, move: 1, timeSeconds: 0 } as const;

describe("terrain traversal", () => {
  it("sweeps thin walls and ceilings without passing through them", () => {
    const wall = fixed({}, rect(3, -10, 0.1, 20));
    const c = {
      ...context([fixed(ground, floor), wall]),
      profile: { gravity: 20, jumpSpeed: 100, maxFallSpeed: 100, walkSpeed: 100 },
    };
    const result = stepTraversal(c, input, start);
    expect(result.status).toBe("ok");
    expect(result.state.x).toBeCloseTo(1);
    const ceiling = stepTraversal(
      context([fixed(ground, floor), fixed({}, rect(-5, 6.5, 20, 1))]),
      { ...input, jump: true, move: 0 },
      start,
    );
    expect(ceiling.status).toBe("ok");
    expect(ceiling.state.y).toBeCloseTo(7.5);
    expect(ceiling.state.vy).toBe(0);
  });
  it("carries along piecewise absolute-time support motion including a rising lift", () => {
    const before = rect(-5, 10, 20, 2),
      middle = rect(-3, 8, 20, 2),
      after = rect(-5, 6, 20, 2);
    const c = context([
      {
        after,
        before,
        kind: "solid",
        segments: [
          { endSeconds: 4.05, from: before, startSeconds: 4, to: middle },
          { endSeconds: 4.1, from: middle, startSeconds: 4.05, to: after },
        ],
        supportId: ground,
      },
    ]);
    const result = stepTraversal(c, { jump: false, move: 0, timeSeconds: 4 }, start);
    expect(result.status).toBe("ok");
    expect(result.state.x).toBeCloseTo(0);
    expect(Math.max(...result.segments.map((segment) => segment.to.x))).toBeCloseTo(2);
    expect(result.state.y).toBeCloseTo(4);
    expect(result.state.grounded).toBe(true);
  });
  it("a moving side pushes the body and crushing fails atomically", () => {
    const mover: TraversalCollider<object> = {
      after: rect(0, 0, 2, 10),
      before: rect(-4, 0, 2, 10),
      kind: "solid",
      supportId: {},
    };
    const c = context([fixed(ground, floor), mover]);
    const result = stepTraversal(c, { ...input, move: 0 }, start);
    expect(result.status).toBe("ok");
    expect(result.state.x).toBeCloseTo(2);
    const crushed = stepTraversal(
      context([...c.sampleColliders(0, 0.1, floor).colliders, fixed({}, rect(3, 0, 2, 10))]),
      { ...input, move: 0 },
      start,
    );
    expect(crushed.status).toBe("blocked");
    expect(crushed.state).toBe(start);
    expect(crushed.segments).toEqual([]);
  });
  it("falls across a gap and only grounds on full-foot support", () => {
    const c = context([fixed(ground, rect(-5, 10, 7, 2))]);
    const result = stepTraversal(c, { ...input, move: 1 }, { ...start, grounded: false, x: 2 });
    expect(result.status).toBe("ok");
    expect(result.state.grounded).toBe(false);
    expect(result.state.y).toBeGreaterThan(8);
    const narrow = stepTraversal(
      context([fixed({}, rect(1, 10, 0.5, 2))]),
      { ...input, move: 0 },
      { ...start, grounded: false, vy: 5, y: 7.9 },
    );
    expect(narrow.status).toBe("ok");
    expect(narrow.state.grounded).toBe(false);
  });
  it("ledges block only downward crossings and never snap from below", () => {
    const c = context([fixed({}, rect(-5, 5, 20, 1), "ledge")]);
    const ascent = stepTraversal(
      c,
      { ...input, move: 0 },
      { ...start, grounded: false, vy: -30, y: 6 },
    );
    expect(ascent.status).toBe("ok");
    expect(ascent.state.y).toBeLessThan(5);
    const below = stepTraversal(
      c,
      { ...input, move: 0 },
      { ...start, grounded: false, vy: 0, y: 5.1 },
    );
    expect(below.state.grounded).toBe(false);
    expect(below.state.y).toBeGreaterThan(5.1);
    const landing = stepTraversal(
      c,
      { ...input, move: 0 },
      { ...start, grounded: false, vy: 5, y: 2.9 },
    );
    expect(landing.state.y).toBeCloseTo(3);
    expect(landing.state.grounded).toBe(true);
  });
  it("distinguishes unknown geometry from budgets and finite-domain failure", () => {
    const c = { ...context([]), sampleColliders: () => ({ colliders: [], complete: false }) };
    const request = {
      goal: rect(10, 0, 4, 10),
      horizonSteps: 5,
      maxStates: 100,
      maxSteps: 100,
      start,
      timeSeconds: 0,
    };
    expect(stepTraversal(c, input, start)).toEqual({
      segments: [],
      state: start,
      status: "geometry-unavailable",
    });
    expect(findTraversal(c, request).status).toBe("geometry-unavailable");
    expect(
      findTraversal(context([fixed(ground, floor)]), { ...request, maxSteps: 0 }),
    ).toMatchObject({ reason: "steps", status: "budget-exhausted" });
    expect(
      findTraversal(context([fixed(ground, floor)]), { ...request, maxStates: 1 }),
    ).toMatchObject({ reason: "states", status: "budget-exhausted" });
    expect(findTraversal(context([]), { ...request, horizonSteps: 0 }).status).toBe("unreachable");
  });
  it("rejects incomplete segment timelines and safety/drop failures atomically", () => {
    const invalid = { ...fixed(ground, floor), segments: [] };
    expect(stepTraversal(context([invalid]), input, start).status).toBe("geometry-unavailable");
    const unsafe = stepTraversal(
      { ...context([fixed(ground, floor)]), safe: () => false },
      input,
      start,
    );
    expect(unsafe.state).toBe(start);
    expect(unsafe.segments).toEqual([]);
    expect(unsafe.status).toBe("unsafe");
    const drop = stepTraversal({ ...context([]), maxDrop: 0.01 }, input, {
      ...start,
      grounded: false,
    });
    expect(drop.status).toBe("unsafe");
    expect(drop.segments).toEqual([]);
  });
  it("replays a found jump witness through the runtime kernel", () => {
    const c = context([fixed(ground, rect(-5, 10, 8, 3)), fixed({}, rect(5, 10, 20, 3))]);
    const result = findTraversal(c, {
      goal: rect(5, 6, 6, 4),
      horizonSteps: 20,
      maxStates: 4000,
      maxSteps: 12000,
      start,
      timeSeconds: 0,
    });
    expect(result.status).toBe("found");
    if (result.status !== "found") {
      return;
    }
    expect(result.inputs.some((i) => i.jump)).toBe(true);
    let state = start;
    for (const i of result.inputs) {
      const step = stepTraversal(c, i, state);
      expect(step.status).toBe("ok");
      state = step.state;
    }
    expect(state).toEqual(result.state);
    expect(state.grounded).toBe(true);
  });
  it("validates moving landings at arrival and detaches disappeared support", () => {
    const mover: TraversalCollider<object> = {
      after: rect(20, 10, 20, 2),
      before: rect(-5, 10, 20, 2),
      kind: "ledge",
      supportId: ground,
    };
    const result = stepTraversal(
      context([mover]),
      { ...input, move: 0 },
      { ...start, grounded: false, vy: 5, y: 7.9 },
    );
    expect(result.status).toBe("ok");
    expect(result.state.grounded).toBe(false);
    const detached = stepTraversal(context([]), { ...input, move: 0 }, start);
    expect(detached.state.grounded).toBe(false);
    expect(detached.state.y).toBeGreaterThan(start.y);
  });
  it("preserves caller state when the collision budget ends", () => {
    const result = stepTraversal(
      { ...context([fixed(ground, floor)]), maxCollisionSteps: 1 },
      input,
      start,
    );
    expect(result.status).toBe("budget-exhausted");
    expect(result.state).toBe(start);
    expect(result.segments).toEqual([]);
  });
  it("requires finite explicit budgets and checks geometry at a zero-step horizon", () => {
    const request = {
      goal: rect(10, 0, 4, 10),
      horizonSteps: 0,
      maxStates: 10,
      maxSteps: 10,
      start,
      timeSeconds: 0,
    };
    expect(() => findTraversal(context([]), { ...request, maxStates: Infinity })).toThrow(
      RangeError,
    );
    expect(() => findTraversal(context([]), { ...request, horizonSteps: 1.5 })).toThrow(RangeError);
    expect(
      findTraversal(
        { ...context([]), sampleColliders: () => ({ colliders: [], complete: false }) },
        request,
      ).status,
    ).toBe("geometry-unavailable");
  });
  it("does not ground while rising exactly through a ledge top", () => {
    const result = stepTraversal(
      context([fixed({}, rect(-5, 5, 20, 1), "ledge")]),
      { ...input, move: 0 },
      { ...start, grounded: false, vy: -10, y: 3.8 },
    );
    expect(result.status).toBe("ok");
    expect(result.state.y).toBeCloseTo(3);
    expect(result.state.grounded).toBe(false);
    expect(result.state.vy).toBeLessThan(0);
  });
});
