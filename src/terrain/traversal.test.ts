import { describe, expect, it } from "vitest";

import type { Rect } from "../rect";
import {
  findTraversal,
  stepTraversal,
  type TraversalCollider,
  type TraversalCommand,
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
    Object.freeze(before);
    Object.freeze(middle);
    Object.freeze(after);
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
    expect(result.state.supportId).toBe(ground);
    expect(Object.keys(result.state)).toEqual([
      "grounded",
      "vy",
      "x",
      "y",
      "supportId",
      "fallFromY",
    ]);
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
    expect(Object.keys(result.state)).toEqual(["grounded", "vy", "x", "y", "fallFromY"]);
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
    const timelines = [
      [],
      [{ endSeconds: 0, from: floor, startSeconds: 0, to: floor }],
      [{ endSeconds: 0.1 + 1e-8, from: floor, startSeconds: 0, to: floor }],
      [
        { endSeconds: 0.04, from: floor, startSeconds: 0, to: floor },
        { endSeconds: 0.1, from: floor, startSeconds: 0.05, to: floor },
      ],
    ];
    for (const segments of timelines) {
      const invalid = { ...fixed(ground, floor), segments };
      expect(stepTraversal(context([invalid]), input, start).status).toBe("geometry-unavailable");
    }
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
    expect(() =>
      findTraversal(
        {
          ...context([]),
          sampleColliders: () => {
            throw new Error("Invalid state must be rejected before sampling");
          },
        },
        { ...request, start: { ...start, vy: Infinity } },
      ),
    ).toThrow(RangeError);
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
  it("preserves collapsed clocks with accepted empty segments and without colliders", () => {
    const time = 2 ** 53;
    const tick = { ...input, timeSeconds: time };
    const supported = stepTraversal(
      context([{ ...fixed(ground, floor), segments: [] }]),
      tick,
      start,
    );
    expect(supported.status).toBe("ok");
    expect(supported.state).toEqual(start);
    expect(supported.segments).toEqual([
      {
        endSeconds: time,
        from: rect(start.x, start.y, 2, 2),
        phase: "landing",
        startSeconds: time,
        to: rect(start.x, start.y, 2, 2),
      },
    ]);
    const unsupported = stepTraversal(context([]), tick, { ...start, grounded: false });
    expect(unsupported.status).toBe("ok");
    expect(unsupported.state.x).toBe(start.x);
    expect(unsupported.state.y).toBe(start.y);
    expect(Object.hasOwn(unsupported.state, "supportId")).toBe(false);
    expect(unsupported.segments).toEqual([]);
  });
});

it.each([
  { corridor: 96, speed: 360, width: 60 },
  { corridor: 72, speed: 336, width: 48 },
])(
  "orders a bounded full-body ground-corridor jump for width $width",
  ({ corridor, speed, width }) => {
    const ground = 0;
    const block = { height: 168, width: 48, x: -48, y: -48 };
    const landing = { height: 120, width: corridor, x: -48 - corridor, y: ground };
    const floor = { height: 120, width: 144, x: 0, y: ground };
    const ledge = { height: 12, width: 72, x: -144, y: -72 };
    const solids = [
      floor,
      block,
      landing,
      { height: 192, width: 72, x: -48 - corridor - 72, y: -72 },
    ];
    const colliders = [
      ...solids.map((rect) => ({
        after: rect,
        before: rect,
        kind: "solid" as const,
        supportId: rect,
      })),
      ...(width === 60
        ? [{ after: ledge, before: ledge, kind: "ledge" as const, supportId: ledge }]
        : []),
    ];
    const context: TraversalContext<object> = {
      body: { height: 48, offset: { x: 0, y: 0 }, width },
      bounds: { height: 720, width: 720, x: -240, y: -600 },
      dtSeconds: 1 / 120,
      epsilon: 1e-6,
      maxCollisionSteps: 16,
      maxDrop: 720,
      profile: { gravity: 1780, jumpSpeed: 535, maxFallSpeed: 275, walkSpeed: speed },
      safe: () => true,
      sampleColliders: (_time, _dt, q) => ({
        colliders: colliders.filter(
          (c) =>
            c.before.x <= q.x + q.width &&
            c.before.x + c.before.width >= q.x &&
            c.before.y <= q.y + q.height &&
            c.before.y + c.before.height >= q.y,
        ),
        complete: true,
      }),
    };
    const start: TraversalState<object> = {
      fallFromY: 0,
      grounded: true,
      supportId: floor,
      vy: 0,
      x: 0,
      y: -48,
    };
    const goal = { height: 48.000002, width: corridor, x: landing.x, y: -48.000001 };
    const result = findTraversal(context, {
      goal,
      horizonSteps: 120,
      maxStates: 256,
      maxSteps: 4096,
      start,
      timeSeconds: 0,
    });
    expect(result.status).toBe("found");
    if (result.status !== "found") {
      return;
    }
    expect(result.work.states).toBeLessThanOrEqual(256);
    expect(result.work.steps).toBeLessThanOrEqual(4096);
    expect(result.inputs.length).toBeLessThanOrEqual(120);
    let state = start;
    for (const input of result.inputs) {
      const step = stepTraversal(context, input, state);
      expect(step.status).toBe("ok");
      state = step.state;
    }
    expect(state).toEqual(result.state);
    expect(state.grounded).toBe(true);
    expect(state.y).toBeCloseTo(-48);
    expect(state.x).toBeGreaterThanOrEqual(goal.x - context.epsilon);
    expect(state.x + width).toBeLessThanOrEqual(goal.x + goal.width + context.epsilon);
  },
);

it("retains waits at the same position until a moving wall opens", () => {
  const floor = { height: 2, width: 40, x: -10, y: 10 };
  const owner = {};
  const wall = (time: number) => ({
    height: 10,
    width: 1,
    x: 3,
    y: -10 * Math.max(0, Math.min(1, (time - 0.3) / 0.1)),
  });
  const context: TraversalContext<object> = {
    body: { height: 2, offset: { x: 0, y: 0 }, width: 2 },
    bounds: { height: 32, width: 40, x: -10, y: -20 },
    dtSeconds: 0.1,
    epsilon: 1e-7,
    maxCollisionSteps: 16,
    maxDrop: 20,
    profile: { gravity: 20, jumpSpeed: 0, maxFallSpeed: 20, walkSpeed: 10 },
    safe: () => true,
    sampleColliders: (t, dt) => ({
      colliders: [
        { after: floor, before: floor, kind: "solid", supportId: floor },
        { after: wall(t + dt), before: wall(t), kind: "solid", supportId: owner },
      ],
      complete: true,
    }),
  };
  const start: TraversalState<object> = {
    fallFromY: 10,
    grounded: true,
    supportId: floor,
    vy: 0,
    x: 0,
    y: 8,
  };
  const request = {
    goal: { height: 2, width: 4, x: 5, y: 8 },
    horizonSteps: 12,
    maxStates: 256,
    maxSteps: 4096,
    start,
    timeSeconds: 0,
  };
  const result = findTraversal(context, request);
  expect(result.status).toBe("found");
  if (result.status !== "found") {
    return;
  }
  // Exact ties retain the existing stable-sort/pop witness and work accounting.
  expect(result.inputs.map(({ move }) => move)).toEqual([1, 0, 0, 0, 1, 1, 1, 1]);
  expect(result.inputs.every(({ jump }) => !jump)).toBe(true);
  expect(result.work).toEqual({ states: 22, steps: 48 });
  expect(
    findTraversal(context, {
      ...request,
      start: { ...start, vy: -0, x: -0 },
      timeSeconds: -0,
    }),
  ).toEqual(result);
  let state = start;
  let repeats = 0;
  for (const input of result.inputs) {
    const step = stepTraversal(context, input, state);
    expect(step.status).toBe("ok");
    if (step.state.x === state.x && step.state.y === state.y) {
      repeats++;
    }
    state = step.state;
  }
  expect(repeats).toBeGreaterThan(0);
  expect(state).toEqual(result.state);
  expect(result.inputs.length).toBeGreaterThan(5);
});

it("does not turn horizontal progress through a hazardous goal into a found witness", () => {
  const floor = { height: 2, width: 40, x: -10, y: 10 };
  const context: TraversalContext<object> = {
    body: { height: 2, offset: { x: 0, y: 0 }, width: 2 },
    bounds: { height: 12, width: 40, x: -10, y: 0 },
    dtSeconds: 0.1,
    epsilon: 1e-7,
    maxCollisionSteps: 16,
    maxDrop: 20,
    profile: { gravity: 20, jumpSpeed: 0, maxFallSpeed: 20, walkSpeed: 10 },
    safe: ({ from, to }) => Math.max(from.x + from.width, to.x + to.width) <= 3,
    sampleColliders: () => ({
      colliders: [{ after: floor, before: floor, kind: "solid", supportId: floor }],
      complete: true,
    }),
  };
  const start: TraversalState<object> = {
    fallFromY: 10,
    grounded: true,
    supportId: floor,
    vy: 0,
    x: 0,
    y: 8,
  };
  const result = findTraversal(context, {
    goal: { height: 2, width: 4, x: 4, y: 8 },
    horizonSteps: 3,
    maxStates: 256,
    maxSteps: 4096,
    start,
    timeSeconds: 0,
  });
  expect(result.status).toBe("unreachable");
});

describe("preferred traversal commands", () => {
  const forward: TraversalCommand = { jump: false, move: 1 };
  const backward: TraversalCommand = { jump: false, move: -1 };
  const request = {
    goal: rect(1, 8, 2, 2),
    horizonSteps: 1,
    maxStates: 32,
    maxSteps: 32,
    start,
    timeSeconds: 0,
  };

  it("validates the whole command sequence before any callback", () => {
    const c = {
      ...context([]),
      safe: () => {
        throw new Error("Unexpected safety call");
      },
      sampleColliders: () => {
        throw new Error("Unexpected geometry call");
      },
    };
    const inherited = Object.assign(Object.create({ timeSeconds: undefined }), forward);
    const invalid: unknown[] = [
      [forward, forward],
      [{ jump: false, move: 2 }],
      [{ jump: 1, move: 1 }],
      [null],
      new Array(1),
      [{ ...forward, timeSeconds: 0 }],
      [{ ...forward, timeSeconds: undefined }],
      [inherited],
    ];
    for (const commands of invalid) {
      expect(() =>
        findTraversal(c, { ...request, preferredInputs: commands as readonly TraversalCommand[] }),
      ).toThrow(RangeError);
    }
  });

  it("accepts command metadata, derives the clock and stops at the earliest valid goal", () => {
    const c = context([fixed(ground, floor)]);
    const result = findTraversal(c, {
      ...request,
      horizonSteps: 2,
      preferredInputs: [{ ...forward, label: "first" }, backward] as readonly TraversalCommand[],
      timeSeconds: 3,
    });
    expect(result.status).toBe("found");
    if (result.status !== "found") {
      return;
    }
    expect(result.inputs).toEqual([{ ...forward, timeSeconds: 3 }]);
    expect(result.work).toEqual({ states: 2, steps: 1 });
    const physical = stepTraversal(c, { ...forward, timeSeconds: 3 }, start);
    expect(result.state).toEqual(physical.state);
  });

  it("checks an already valid initial goal before spending preferred steps", () => {
    const result = findTraversal(context([fixed(ground, floor)]), {
      ...request,
      goal: rect(0, 8, 2, 2),
      maxStates: 1,
      maxSteps: 0,
      preferredInputs: [forward],
    });
    expect(result).toEqual({
      inputs: [],
      state: start,
      status: "found",
      work: { states: 1, steps: 0 },
    });
  });

  it("falls back from a completed prefix without poisoning regular seen or charging overlap twice", () => {
    const c = context([fixed(ground, floor)]);
    const result = findTraversal(c, {
      ...request,
      goal: rect(2, 8, 2, 2),
      horizonSteps: 2,
      maxStates: 16,
      maxSteps: 16,
      preferredInputs: [forward],
    });
    expect(result.status).toBe("found");
    if (result.status !== "found") {
      return;
    }
    expect(result.inputs).toEqual(
      [forward, forward].map((command, i) => ({ ...command, timeSeconds: i * c.dtSeconds })),
    );
    expect(result.work).toEqual({ states: 16, steps: 16 });
    expect(result.state.x).toBe(2);
  });

  it("retains unsafe-prefix step cost while falling back from the original start", () => {
    const result = findTraversal(
      { ...context([fixed(ground, floor)]), safe: ({ to }) => to.x >= 0 },
      {
        ...request,
        preferredInputs: [backward],
      },
    );
    expect(result.status).toBe("found");
    if (result.status !== "found") {
      return;
    }
    expect(result.inputs).toEqual([{ ...forward, timeSeconds: 0 }]);
    expect(result.work).toEqual({ states: 5, steps: 7 });
  });

  it("retains successful-prefix costs and enforces state and step caps in existing order", () => {
    const c = context([fixed(ground, floor)]);
    expect(
      findTraversal(c, { ...request, maxStates: 1, preferredInputs: [forward] }),
    ).toMatchObject({
      reason: "states",
      status: "budget-exhausted",
      work: { states: 1, steps: 1 },
    });
    expect(
      findTraversal(c, { ...request, maxStates: 6, preferredInputs: [backward] }),
    ).toMatchObject({
      reason: "states",
      status: "budget-exhausted",
      work: { states: 6, steps: 7 },
    });
    expect(
      findTraversal(c, { ...request, maxSteps: 6, preferredInputs: [backward] }),
    ).toMatchObject({ reason: "steps", status: "budget-exhausted", work: { states: 6, steps: 6 } });
  });

  it("propagates incomplete geometry and collision budgets without a fallback", () => {
    const c = context([fixed(ground, floor)]);
    let samples = 0;
    const unknown = findTraversal(
      { ...c, sampleColliders: () => ({ colliders: [], complete: ++samples !== 2 }) },
      { ...request, preferredInputs: [forward] },
    );
    expect(unknown).toEqual({ status: "geometry-unavailable", work: { states: 1, steps: 1 } });
    expect(samples).toBe(2);
    const collision = findTraversal(
      { ...c, maxCollisionSteps: 1 },
      { ...request, preferredInputs: [forward] },
    );
    expect(collision).toEqual({
      reason: "collision",
      status: "budget-exhausted",
      work: { states: 1, steps: 1 },
    });
  });

  it("does not accept an unsupported initial goal or skip terminal geometry revalidation", () => {
    const c = context([]);
    expect(
      findTraversal(c, { ...request, goal: rect(0, 8, 2, 2), horizonSteps: 0, preferredInputs: [] })
        .status,
    ).toBe("unreachable");
    let samples = 0;
    const supported = context([fixed(ground, floor)]);
    const result = findTraversal(
      {
        ...supported,
        sampleColliders: (...args) => ({
          ...supported.sampleColliders(...args),
          complete: ++samples !== 4,
        }),
      },
      { ...request, preferredInputs: [forward] },
    );
    expect(result).toEqual({ status: "geometry-unavailable", work: { states: 2, steps: 1 } });
    expect(samples).toBe(4);
  });

  it("proves a static walk-off landing through the shared kernel within the existing limits", () => {
    const solids = [
      rect(2400, 960, 120, 480),
      rect(2544, 888, 48, 552),
      rect(2592, 960, 288, 480),
      rect(2520, 960, 24, 480),
      rect(2880, 960, 120, 480),
    ];
    const c: TraversalContext<Rect> = {
      body: { height: 46, offset: { x: 2, y: 2 }, width: 44 },
      bounds: rect(0, 0, 6840, 1440),
      dtSeconds: 1 / 120,
      epsilon: 1e-6,
      maxCollisionSteps: 16,
      maxDrop: 1440,
      profile: { gravity: 1780, jumpSpeed: 535, maxFallSpeed: 275, walkSpeed: 336 },
      safe: () => true,
      sampleColliders: () => ({
        colliders: solids.map((r) => ({ after: r, before: r, kind: "solid", supportId: r })),
        complete: true,
      }),
    };
    const r = {
      goal: rect(2593.600000000003, 911.999999, 286.3999999999969, 48.000002),
      horizonSteps: 120,
      maxStates: 256,
      maxSteps: 4096,
      start: {
        fallFromY: 888,
        grounded: true,
        supportId: solids[1]!,
        vy: 0,
        x: 2545.600000000003,
        y: 840,
      },
      timeSeconds: 2.341666666666661,
    };
    expect(findTraversal(c, r)).toMatchObject({
      reason: "states",
      status: "budget-exhausted",
      work: { states: 256, steps: 256 },
    });
    const result = findTraversal(c, {
      ...r,
      preferredInputs: Array.from({ length: r.horizonSteps }, () => forward),
    });
    expect(result.status).toBe("found");
    if (result.status !== "found") {
      return;
    }
    expect(result.inputs).toHaveLength(57);
    expect(result.work).toEqual({ states: 58, steps: 57 });
    let state: TraversalState<Rect> = r.start;
    for (const input of result.inputs) {
      const checked = stepTraversal(c, input, state);
      expect(checked.status).toBe("ok");
      state = checked.state;
    }
    expect(state).toEqual(result.state);
    expect(state.grounded).toBe(true);
    expect(state.y).toBe(912);
  });
});
