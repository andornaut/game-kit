import { assertNever } from "../assertNever.ts";
import { clamp01 } from "../numbers.ts";
import { type Random, randomPick } from "../random.ts";

// Maps an input onto [0, 1] over the range from `from` to `to`. With t = clamp01((x - from) /
// (to - from)), the share of the range x has covered:
// - linear: t, so 0 at `from` and 1 at `to`.
// - inverse: 1 - t, so 1 at `from` and 0 at `to`.
// - smooth: smoothstep, 3t² - 2t³: 0 and 1 at the ends, 0.5 at the midpoint, flat at both ends.
// - step: 1 once x reaches `to` (t = 1), otherwise 0.
// `from` may exceed `to` for a falling range. When from equals to, t is 1 at or past that point
// (x >= from) and 0 before it, for every kind.
export interface ScoreCurve {
  readonly from: number;
  readonly kind: "inverse" | "linear" | "smooth" | "step";
  readonly to: number;
}

// One input read through one curve. A curve value of 0 vetoes the action.
export interface Consideration<Input extends string> {
  readonly curve: ScoreCurve;
  readonly input: Input;
}

export interface ScoreCandidate<Input extends string, Action extends string> {
  readonly action: Action;
  readonly base: number;
  readonly considerations: readonly Consideration<Input>[];
  // A hard gate: false scores 0 without reading the considerations.
  readonly gate: boolean;
  // The caller's own modifier, such as pressure or cadence terms; 1 when omitted.
  readonly multiplier?: number;
  readonly values: Readonly<Record<Input, number>>;
}

export interface Hysteresis {
  // Added to the previous action's score while that score is above 0.
  readonly bonus: number;
  // Scores within epsilon of the best compete through the tie-break.
  readonly epsilon: number;
  // The previous action is kept until held this long, unless its score falls to 0.
  readonly minHoldSeconds: number;
}

export interface ScoreOptions {
  readonly hysteresis: Hysteresis;
}

export interface PreviousAction<Action extends string> {
  readonly action: Action;
  readonly heldSeconds: number;
}

export interface ActionScore<Action extends string> {
  readonly action: Action;
  // Including the hysteresis bonus.
  readonly score: number;
}

// How the action was chosen: kept within its hold, the single best score, the first of
// exactly equal scores, one draw among scores within epsilon, or none when nothing scored above 0.
export type ScoreReason = "best" | "draw" | "hold" | "none" | "order";

export interface ScoreDecision<Action extends string> {
  readonly action: Action | undefined;
  readonly reason: ScoreReason;
  // One entry per candidate, in candidate order.
  readonly scores: readonly ActionScore<Action>[];
}

function finiteNonnegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be finite and at least 0, got ${String(value)}`);
  }
}

// The share of the range from `from` to `to` that x has covered, in [0, 1].
function rangeShare(from: number, to: number, x: number): number {
  if (from === to) {
    return x >= from ? 1 : 0;
  }
  return clamp01((x - from) / (to - from));
}

// The curve's value at x, in [0, 1]. Infinite x reaches an end of the range; NaN x and
// non-finite range ends throw RangeError.
export function curveValue(curve: ScoreCurve, x: number): number {
  if (!Number.isFinite(curve.from) || !Number.isFinite(curve.to)) {
    throw new RangeError("curve from and to must be finite");
  }
  if (Number.isNaN(x)) {
    throw new RangeError("curve input must not be NaN");
  }
  const t = rangeShare(curve.from, curve.to, x);
  switch (curve.kind) {
    case "inverse":
      return 1 - t;
    case "linear":
      return t;
    case "smooth":
      return t * t * (3 - 2 * t);
    case "step":
      return t === 1 ? 1 : 0;
    default:
      return assertNever(curve.kind);
  }
}

// gate × base × the product of the curve values × multiplier, without the hysteresis bonus.
// Curves after a 0 are not evaluated. base and multiplier must be finite and at least 0.
export function candidateScore<Input extends string, Action extends string>(
  candidate: ScoreCandidate<Input, Action>,
): number {
  const multiplier = candidate.multiplier ?? 1;
  finiteNonnegative(`${candidate.action} base`, candidate.base);
  finiteNonnegative(`${candidate.action} multiplier`, multiplier);
  if (!candidate.gate) {
    return 0;
  }
  let score = candidate.base * multiplier;
  for (const { curve, input } of candidate.considerations) {
    if (score === 0) {
      return 0;
    }
    score *= curveValue(curve, candidate.values[input]);
  }
  return score;
}

// Scores every candidate and chooses one action:
// 1. The previous action, when it is a candidate scoring above 0, gains hysteresis.bonus. If it
//    has been held for less than minHoldSeconds it is kept.
// 2. Otherwise the candidates scoring above 0 and within epsilon of the best compete. One wins
//    alone; exactly equal scores go to the first in candidate order; unequal scores go to one
//    uniform draw from random over the competitors in candidate order.
// random is called at most once, and only in the last case, so a replay draws the same values.
// Duplicate actions throw RangeError.
export function scoreActions<Input extends string, Action extends string>(
  options: ScoreOptions,
  random: Random,
  previous: PreviousAction<Action> | undefined,
  candidates: readonly ScoreCandidate<Input, Action>[],
): ScoreDecision<Action> {
  const { bonus, epsilon, minHoldSeconds } = options.hysteresis;
  finiteNonnegative("hysteresis bonus", bonus);
  finiteNonnegative("hysteresis epsilon", epsilon);
  finiteNonnegative("hysteresis minHoldSeconds", minHoldSeconds);
  if (previous !== undefined) {
    finiteNonnegative("previous heldSeconds", previous.heldSeconds);
  }
  const seen = new Set<Action>();
  const scores = candidates.map((candidate): ActionScore<Action> => {
    if (seen.has(candidate.action)) {
      throw new RangeError(`duplicate action ${candidate.action}`);
    }
    seen.add(candidate.action);
    const score = candidateScore(candidate);
    const kept = score > 0 && candidate.action === previous?.action;
    return { action: candidate.action, score: kept ? score + bonus : score };
  });

  const held = scores.find(({ action, score }) => action === previous?.action && score > 0);
  if (held !== undefined && previous !== undefined && previous.heldSeconds < minHoldSeconds) {
    return { action: held.action, reason: "hold", scores };
  }

  const best = Math.max(...scores.map(({ score }) => score));
  const contenders = scores.filter(({ score }) => score > 0 && score >= best - epsilon);
  const [first] = contenders;
  if (first === undefined) {
    return { action: undefined, reason: "none", scores };
  }
  if (contenders.length === 1) {
    return { action: first.action, reason: "best", scores };
  }
  if (contenders.every(({ score }) => score === first.score)) {
    return { action: first.action, reason: "order", scores };
  }
  return { action: randomPick(random, contenders).action, reason: "draw", scores };
}
