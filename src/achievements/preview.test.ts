import { describe, expect, it } from "vitest";

import { type AchievementPreview, NOTHING_PREVIEWED, previewAchievements } from "./preview.ts";

// A synthetic run: its step and a score. Only the score can earn a badge, so it is the key.
interface Run {
  readonly score: number;
  readonly step: number;
}
type Id = "five" | "ten" | "twenty";

const THRESHOLDS: readonly [Id, number][] = [
  ["five", 5],
  ["ten", 10],
  ["twenty", 20],
];
const keyOf = (run: Run) => String(run.score);

// Looks at each run in turn from a fresh preview, counting the earned callback's calls.
function walk(
  runs: readonly Run[],
  earnedOf = (run: Run): readonly Id[] =>
    THRESHOLDS.filter(([, score]) => run.score >= score).map(([id]) => id),
) {
  let calls = 0;
  const earned = (run: Run) => {
    calls += 1;
    return earnedOf(run);
  };
  let preview: AchievementPreview<Id> = NOTHING_PREVIEWED;
  const looks: (readonly Id[])[] = [];
  for (const run of runs) {
    const look = previewAchievements(keyOf, earned, preview, run);
    preview = look.preview;
    looks.push(look.earned);
  }
  return { calls, looks, preview };
}

describe("previewAchievements", () => {
  it.each<[string, readonly Run[], readonly (readonly Id[])[], number]>([
    ["the first look", [{ score: 0, step: 0 }], [[]], 1],
    [
      "each badge once as the score rises",
      [
        { score: 6, step: 0 },
        { score: 12, step: 1 },
        { score: 25, step: 2 },
      ],
      [["five"], ["ten"], ["twenty"]],
      3,
    ],
    [
      "no new look while the key is unchanged",
      [
        { score: 6, step: 0 },
        { score: 6, step: 1 },
        { score: 6, step: 2 },
      ],
      [["five"], [], []],
      1,
    ],
    [
      "a badge once even when the score falls and rises",
      [
        { score: 12, step: 0 },
        { score: 0, step: 1 },
        { score: 12, step: 2 },
      ],
      [["five", "ten"], [], []],
      3,
    ],
  ])("previews %s", (_, runs, looks, calls) => {
    const result = walk(runs);
    expect(result.looks).toEqual(looks);
    expect(result.calls).toBe(calls);
  });

  it("records the key and every badge shown, in preview order", () => {
    const { preview } = walk([
      { score: 12, step: 0 },
      { score: 21, step: 1 },
    ]);
    expect(preview).toEqual({ key: "21", shown: ["five", "ten", "twenty"] });
  });

  it("returns the same preview when the key is unchanged", () => {
    const run = { score: 6, step: 0 };
    const { preview } = previewAchievements(keyOf, () => ["five"], NOTHING_PREVIEWED, run);
    expect(previewAchievements(keyOf, () => ["ten"], preview, run).preview).toBe(preview);
  });

  it("looks at an empty key on the first look", () => {
    const look = previewAchievements(
      () => "",
      () => ["five"],
      NOTHING_PREVIEWED,
      { score: 0, step: 0 },
    );
    expect(look.earned).toEqual(["five"]);
  });

  it("returns a repeated id once", () => {
    const { looks } = walk([{ score: 0, step: 0 }], () => ["ten", "five", "ten"]);
    expect(looks).toEqual([["ten", "five"]]);
  });
});
