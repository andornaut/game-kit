import { describe, expect, it } from "vitest";

import { seededRandom } from "../random.ts";
import {
  candidateScore,
  curveValue,
  type Hysteresis,
  scoreActions,
  type ScoreCandidate,
  type ScoreCurve,
} from "./utility.ts";

type Input = "near" | "seen";
type Action = "a" | "b" | "c";

const HYSTERESIS: Hysteresis = { bonus: 0, epsilon: 0, minHoldSeconds: 0 };

// A random that fails the test when called.
const noDraw = () => {
  throw new Error("unexpected draw");
};

// A candidate whose score is exactly base: no considerations and an open gate.
function candidate(
  action: Action,
  base: number,
  overrides: Partial<ScoreCandidate<Input, Action>> = {},
): ScoreCandidate<Input, Action> {
  return {
    action,
    base,
    considerations: [],
    gate: true,
    values: { near: 0, seen: 0 },
    ...overrides,
  };
}

describe("curveValue", () => {
  const rising = (kind: ScoreCurve["kind"]): ScoreCurve => ({ from: 2, kind, to: 6 });

  it.each([
    { kind: "linear", values: [0, 0, 0.25, 0.5, 1, 1] },
    { kind: "inverse", values: [1, 1, 0.75, 0.5, 0, 0] },
    { kind: "smooth", values: [0, 0, 0.15625, 0.5, 1, 1] },
    { kind: "step", values: [0, 0, 0, 0, 1, 1] },
  ] as const)(
    "maps $kind over below, from, quarter, midpoint, to and above",
    ({ kind, values }) => {
      expect([0, 2, 3, 4, 6, 9].map((x) => curveValue(rising(kind), x))).toEqual(values);
    },
  );

  it("follows a falling range when from exceeds to", () => {
    const falling: ScoreCurve = { from: 6, kind: "linear", to: 2 };
    expect([6, 4, 2, 0].map((x) => curveValue(falling, x))).toEqual([0, 0.5, 1, 1]);
    expect(curveValue({ from: 6, kind: "step", to: 2 }, 2)).toBe(1);
    expect(curveValue({ from: 6, kind: "step", to: 2 }, 2.5)).toBe(0);
  });

  it("treats an empty range as a step at its point", () => {
    const point = (kind: ScoreCurve["kind"]): ScoreCurve => ({ from: 3, kind, to: 3 });
    expect([2, 3, 4].map((x) => curveValue(point("linear"), x))).toEqual([0, 1, 1]);
    expect([2, 3, 4].map((x) => curveValue(point("inverse"), x))).toEqual([1, 0, 0]);
  });

  it("reaches the ends for infinite input and rejects NaN and non-finite ends", () => {
    expect(curveValue(rising("linear"), Infinity)).toBe(1);
    expect(curveValue(rising("inverse"), Infinity)).toBe(0);
    expect(curveValue(rising("linear"), -Infinity)).toBe(0);
    expect(() => curveValue(rising("linear"), Number.NaN)).toThrow(RangeError);
    expect(() => curveValue({ from: 0, kind: "linear", to: Infinity }, 1)).toThrow(RangeError);
  });
});

describe("candidateScore", () => {
  const near: ScoreCurve = { from: 0, kind: "linear", to: 10 };

  it("multiplies gate, base, each curve value and the multiplier", () => {
    const scored = candidate("a", 2, {
      considerations: [
        { curve: near, input: "near" },
        { curve: { from: 0, kind: "step", to: 1 }, input: "seen" },
      ],
      multiplier: 1.5,
      values: { near: 5, seen: 1 },
    });
    expect(candidateScore(scored)).toBe(2 * 0.5 * 1 * 1.5);
  });

  it.each([
    { case: "a curve value of 0 vetoes", overrides: { values: { near: 0, seen: 1 } } },
    { case: "a closed gate scores 0", overrides: { gate: false, values: { near: 10, seen: 1 } } },
  ])("$case", ({ overrides }) => {
    const scored = candidate("a", 3, {
      considerations: [{ curve: near, input: "near" }],
      ...overrides,
    });
    expect(candidateScore(scored)).toBe(0);
  });

  it("rises with a rising input under a linear curve", () => {
    const scores = [0, 1, 2.5, 5, 7.5, 10].map((value) =>
      candidateScore(
        candidate("a", 2, {
          considerations: [{ curve: near, input: "near" }],
          values: { near: value, seen: 0 },
        }),
      ),
    );
    for (const [i, score] of scores.slice(1).entries()) {
      expect(score).toBeGreaterThan(scores[i] ?? Infinity);
    }
  });

  it.each([
    { field: "base", overrides: { base: -1 } },
    { field: "multiplier", overrides: { multiplier: Number.NaN } },
  ])("rejects an invalid $field", ({ overrides }) => {
    expect(() => candidateScore(candidate("a", 1, overrides))).toThrow(RangeError);
  });
});

describe("scoreActions", () => {
  it("chooses the single best score and traces every candidate in order", () => {
    const decision = scoreActions({ hysteresis: HYSTERESIS }, noDraw, undefined, [
      candidate("a", 1),
      candidate("b", 3),
      candidate("c", 0, { gate: false }),
    ]);
    expect(decision).toEqual({
      action: "b",
      reason: "best",
      scores: [
        { action: "a", score: 1 },
        { action: "b", score: 3 },
        { action: "c", score: 0 },
      ],
    });
  });

  it("chooses nothing when no candidate scores above 0", () => {
    const decision = scoreActions({ hysteresis: HYSTERESIS }, noDraw, undefined, [
      candidate("a", 0),
      candidate("b", 2, { gate: false }),
    ]);
    expect(decision.action).toBeUndefined();
    expect(decision.reason).toBe("none");
    expect(scoreActions({ hysteresis: HYSTERESIS }, noDraw, undefined, []).reason).toBe("none");
  });

  it("gives exactly equal scores to the first in candidate order without drawing", () => {
    const options = { hysteresis: { ...HYSTERESIS, epsilon: 0.5 } };
    const decision = scoreActions(options, noDraw, undefined, [
      candidate("a", 1),
      candidate("b", 2),
      candidate("c", 2),
    ]);
    expect(decision).toMatchObject({ action: "b", reason: "order" });
  });

  it("ranks scores within epsilon by exactly one seeded draw", () => {
    const options = { hysteresis: { ...HYSTERESIS, epsilon: 0.05 } };
    const random = seededRandom(1);
    const decision = scoreActions(options, random, undefined, [
      candidate("a", 1),
      candidate("b", 0.98),
      candidate("c", 0.97),
    ]);
    // seededRandom(1) draws 0.6270739405881613 first, picking the second of three.
    expect(decision).toMatchObject({ action: "b", reason: "draw" });
    expect(random()).toBe(0.002735721180215478);
  });

  it("leaves scores outside epsilon out of the draw", () => {
    const options = { hysteresis: { ...HYSTERESIS, epsilon: 0.05 } };
    const decision = scoreActions(options, () => 0.99, undefined, [
      candidate("a", 1),
      candidate("b", 0.98),
      candidate("c", 0.9),
    ]);
    expect(decision.action).toBe("b");
  });

  describe("hysteresis", () => {
    const options = { hysteresis: { bonus: 0.5, epsilon: 0, minHoldSeconds: 2 } };
    const candidates = [candidate("a", 1), candidate("b", 3)];

    it.each([
      {
        action: "a",
        case: "holds the previous action before minHoldSeconds",
        heldSeconds: 1.9,
        reason: "hold",
      },
      { action: "b", case: "releases it at minHoldSeconds", heldSeconds: 2, reason: "best" },
    ])("$case", ({ action, heldSeconds, reason }) => {
      const decision = scoreActions(options, noDraw, { action: "a", heldSeconds }, candidates);
      expect(decision).toMatchObject({ action, reason });
      expect(decision.scores[0]).toEqual({ action: "a", score: 1.5 });
    });

    it("lets the bonus keep the previous action after release", () => {
      const decision = scoreActions(options, noDraw, { action: "a", heldSeconds: 5 }, [
        candidate("a", 2.6),
        candidate("b", 3),
      ]);
      expect(decision).toMatchObject({ action: "a", reason: "best" });
    });

    it.each([
      { case: "a closed gate", overrides: { gate: false } },
      {
        case: "a veto",
        overrides: {
          considerations: [{ curve: { from: 0, kind: "linear", to: 1 }, input: "near" }],
        },
      },
    ] as const)("releases the hold on $case, without the bonus", ({ overrides }) => {
      const decision = scoreActions(options, noDraw, { action: "a", heldSeconds: 0 }, [
        candidate("a", 1, overrides),
        candidate("b", 3),
      ]);
      expect(decision).toMatchObject({ action: "b", reason: "best" });
      expect(decision.scores[0]).toEqual({ action: "a", score: 0 });
    });

    it("ignores a previous action that is not a candidate", () => {
      const decision = scoreActions(options, noDraw, { action: "c", heldSeconds: 0 }, candidates);
      expect(decision).toMatchObject({ action: "b", reason: "best" });
    });
  });

  it.each([
    {
      candidates: [candidate("a", 1), candidate("a", 2)],
      case: "duplicate actions",
      hysteresis: HYSTERESIS,
    },
    { candidates: [], case: "a negative epsilon", hysteresis: { ...HYSTERESIS, epsilon: -1 } },
  ])("rejects $case", ({ candidates, hysteresis }) => {
    expect(() => scoreActions({ hysteresis }, noDraw, undefined, candidates)).toThrow(RangeError);
  });
});
