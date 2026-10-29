import { describe, expect, it } from "vitest";

import { fitOverflow, overflowingTexts, overflowOf, type TextRole } from "./overflow";
import type { FittedText, TextMeasure } from "./textFit";

// Every character 4 font pixels wide, at the style's scale.
const measure: TextMeasure = (style, line) => line.length * 4 * style.scale;

describe("overflowOf", () => {
  it.each<[string, number, number, number, number, string]>([
    ["fits", 3, 488, 3, 488, ""],
    ["too many lines", 3, 488, 4, 400, "4 lines of 3"],
    ["too wide", 1, 162, 1, 170, "170px wide in 162px"],
    ["both", 3, 488, 4, 530, "4 lines of 3, 530px wide in 488px"],
  ])("tells text that %s", (_case, most, room, lines, widest, overflow) => {
    expect(overflowOf(most, room, lines, widest)).toBe(overflow);
  });
});

describe("fitOverflow", () => {
  it.each<[string, FittedText, string]>([
    ["fits", { lines: ["ab", "abc"], style: { lines: 2, scale: 2 } }, ""],
    ["misses", { lines: ["abcd"], style: { scale: 2 } }, "32px wide in 24px"],
    ["has no lines", { lines: [], style: { scale: 2 } }, ""],
  ])("tells text that %s", (_case, fitted, overflow) => {
    expect(fitOverflow(measure, 24, fitted)).toBe(overflow);
  });
});

describe("overflowingTexts", () => {
  const answer: TextRole = {
    name: "answer",
    room: 24,
    style: { scale: 2 },
    texts: ["ab", "abc", "abcd", "abcd"],
  };
  const roles: TextRole[] = [
    answer,
    {
      name: "dialogue",
      room: 24,
      style: { lines: 2, scale: 2 },
      texts: ["ab ab", "ab ab ab", "abcd"],
    },
  ];

  it("names each text that overflows its role, once", () => {
    expect(overflowingTexts(measure, roles)).toEqual([
      { overflow: "32px wide in 24px", role: "answer", text: "abcd" },
      { overflow: "3 lines of 2", role: "dialogue", text: "ab ab ab" },
      { overflow: "32px wide in 24px", role: "dialogue", text: "abcd" },
    ]);
  });

  it("gives [] where every text fits", () => {
    expect(overflowingTexts(measure, [{ ...answer, texts: ["a", "abc"] }])).toEqual([]);
  });
});
