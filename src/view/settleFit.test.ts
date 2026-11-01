import { describe, expect, it } from "vitest";

import { SETTLE_FRAMES, settleFit } from "./settleFit";

// Runs settleFit with measurements given frame by frame, the last repeated, and counts refits.
function run(measures: readonly string[]): { frames: number; refits: number } {
  let frame = 0;
  let refits = 0;
  const queue: (() => void)[] = [];
  settleFit(
    (callback) => queue.push(callback),
    () => measures[Math.min(frame, measures.length - 1)] ?? "",
    () => {
      refits += 1;
    },
  );
  while (queue.length > 0) {
    frame += 1;
    queue.shift()?.();
  }
  return { frames: frame, refits };
}

describe("settleFit", () => {
  it.each<[string, string[], { frames: number; refits: number }]>([
    ["refits once where the size has settled", ["a"], { frames: 1, refits: 1 }],
    ["refits again for a size that settles a frame late", ["a", "b"], { frames: 2, refits: 2 }],
    [
      "follows a size that keeps changing for a while",
      ["a", "b", "c", "d"],
      { frames: 4, refits: 4 },
    ],
  ])("%s", (_, measures, result) => {
    expect(run(measures)).toEqual(result);
  });

  it("gives up after SETTLE_FRAMES frames of a size that never rests", () => {
    const measures = Array.from({ length: SETTLE_FRAMES * 2 }, (__, i) => String(i));
    expect(run(measures).frames).toBe(SETTLE_FRAMES);
  });
});
