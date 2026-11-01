import { describe, expect, it } from "vitest";

import {
  chanceRound,
  randomInt,
  randomPick,
  randomStream,
  seededRandom,
  shuffled,
  weightedPick,
} from "./random";

const take = (count: number, random: () => number) => Array.from({ length: count }, random);

describe("seededRandom", () => {
  it("repeats the same sequence for the same seed and varies with the seed", () => {
    expect(take(10, seededRandom(42))).toEqual(take(10, seededRandom(42)));
    expect(take(10, seededRandom(1))).not.toEqual(take(10, seededRandom(2)));
  });

  it("stays in [0, 1)", () => {
    const values = take(16, seededRandom(7));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
  });
});

describe("randomInt", () => {
  it("maps the ends of [0, 1) to min and max - 1", () => {
    expect(randomInt(() => 0, 2, 6)).toBe(2);
    expect(randomInt(() => 0.9999, 2, 6)).toBe(5);
  });
});

describe("randomPick", () => {
  it("picks each item by where the random value falls", () => {
    expect(randomPick(() => 0, ["a", "b", "c"])).toBe("a");
    expect(randomPick(() => 0.5, ["a", "b", "c"])).toBe("b");
    expect(randomPick(() => 0.99, ["a", "b", "c"])).toBe("c");
  });
});

describe("weightedPick", () => {
  it.each([
    { draw: 0, picked: "a" },
    { draw: 0.2, picked: "b" },
    { draw: 0.8, picked: "c" },
  ])("picks $picked at a draw of $draw, each item as likely as its weight", ({ draw, picked }) => {
    expect(weightedPick(() => draw, ["a", "b", "c"], [1, 3, 1])).toBe(picked);
  });
});

describe("chanceRound", () => {
  // A draw under the fractional part adds one; a whole number draws nothing.
  it.each([
    { draw: 0.49, draws: 1, expected: 0.5, rounded: 1 },
    { draw: 0.5, draws: 1, expected: 0.5, rounded: 0 },
    { draw: 0.2, draws: 1, expected: 1.25, rounded: 2 },
    { draw: 0.3, draws: 1, expected: 1.25, rounded: 1 },
    { draw: 0, draws: 0, expected: 0, rounded: 0 },
    { draw: 0, draws: 0, expected: 2, rounded: 2 },
  ])(
    "rounds $expected to $rounded at a draw of $draw, drawing $draws times",
    ({ draw, draws, expected, rounded }) => {
      let made = 0;
      const random = () => {
        made += 1;
        return draw;
      };
      expect(chanceRound(random, expected)).toBe(rounded);
      expect(made).toBe(draws);
    },
  );
});

describe("shuffled", () => {
  it("reorders items without changing the source", () => {
    const items = Object.freeze(["a", "b", "c"]);
    expect(shuffled(() => 0, items)).toEqual(["b", "c", "a"]);
    expect(items).toEqual(["a", "b", "c"]);
  });
});

const NAMES = ["scenery", "spawns-1"];

describe("randomStream", () => {
  it("repeats a stream's sequence for the same seed and name", () => {
    expect(take(10, randomStream(42, "scenery"))).toEqual(take(10, randomStream(42, "scenery")));
  });

  it("keeps each stream's sequence when another stream draws more", () => {
    const untouched = randomStream(7, "scenery");
    const disturbed = randomStream(7, "scenery");
    take(13, randomStream(7, "spawns-1"));
    expect(take(20, disturbed)).toEqual(take(20, untouched));
  });

  it("gives each stream a sequence of its own", () => {
    const sequences = NAMES.map((name) => take(10, randomStream(7, name)).join());
    expect(new Set([...sequences, take(10, seededRandom(7)).join()]).size).toBe(NAMES.length + 1);
  });
});
