import { describe, expect, it } from "vitest";

import type { Rect } from "../rect.ts";
import {
  stepTraversal,
  type TraversalCollider,
  type TraversalContext,
  type TraversalInput,
  type TraversalState,
} from "./traversal.ts";
import { stepStaticTraversal } from "./traversalStep.ts";

const rect = (x: number, y: number, width: number, height: number): Rect => ({
  height,
  width,
  x,
  y,
});
const fixed = (id: string, r: Rect, kind: "solid" | "ledge"): TraversalCollider<string> => ({
  after: r,
  before: r,
  kind,
  supportId: id,
});
const colliders = [
  fixed("floor", rect(-20, 10, 60, 5), "solid"),
  fixed("step", rect(6, 8.5, 4, 1.5), "solid"),
  fixed("wall", rect(16, 2, 1, 8), "solid"),
  fixed("shelf", rect(-4, 5, 5, 1), "ledge"),
  fixed("roof", rect(2, -2, 12, 1), "solid"),
];
const context = (blocked: (r: Readonly<Rect>) => boolean): TraversalContext<string> => ({
  body: { height: 2, offset: { x: 0.5, y: -0.25 }, width: 1.5 },
  bounds: rect(-20, -30, 60, 60),
  dtSeconds: 0.1,
  epsilon: 1e-7,
  maxCollisionSteps: 32,
  maxDrop: 12,
  profile: { gravity: 20, jumpSpeed: 11, maxFallSpeed: 18, walkSpeed: 7 },
  safe: (request) => !blocked(request.to),
  sampleColliders: () => ({ colliders, complete: true }),
});

describe("static traversal step", () => {
  it("matches stepTraversal over static geometry along random walks", () => {
    let seed = 7;
    const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    const c = context((r) => r.x > 30);
    let checked = 0;
    for (let walk = 0; walk < 40; walk++) {
      let state: TraversalState<string> = {
        fallFromY: 10,
        grounded: true,
        supportId: "floor",
        vy: 0,
        x: -10 + next() * 30,
        y: 10 - 2 + 0.25,
      };
      for (let tick = 0; tick < 40; tick++) {
        const input: TraversalInput = {
          jump: next() < 0.3,
          move: ([-1, 0, 1] as const)[Math.floor(next() * 3)]!,
          timeSeconds: tick * 0.1,
        };
        const expected = stepTraversal(c, input, state);
        expect(stepStaticTraversal(c, input, state)).toEqual(expected);
        checked++;
        if (expected.status !== "ok") {
          break;
        }
        state = expected.state;
      }
    }
    expect(checked).toBeGreaterThan(400);
  });

  it("fails a sample with colliders when the clock span collapses, as validation does", () => {
    const c = context(() => false);
    const state: TraversalState<string> = {
      fallFromY: 10,
      grounded: true,
      supportId: "floor",
      vy: 0,
      x: 0,
      y: 8.25,
    };
    const input: TraversalInput = { jump: false, move: 1, timeSeconds: 2 ** 60 };
    expect(stepTraversal(c, input, state).status).toBe("geometry-unavailable");
    expect(stepStaticTraversal(c, input, state)).toEqual(stepTraversal(c, input, state));
    expect(() => stepStaticTraversal(c, { ...input, move: 2 as 1 }, state)).toThrow(RangeError);
    expect(() => stepStaticTraversal(c, input, { ...state, vy: Number.NaN })).toThrow(RangeError);
  });
});
