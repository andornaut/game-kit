import { describe, expect, it, vi } from "vitest";

import {
  type FieldTable,
  fillLine,
  sentences,
  splitBalancedGraphemes,
  strayNames,
  wrapWords,
} from "./lines.ts";

describe("splitBalancedGraphemes", () => {
  it("balances measured complete halves and applies both tie breakers without monotonic assumptions", () => {
    for (const [text, widths, expected] of [
      ["abcdef", undefined, ["abc", "def"]],
      ["abcde", undefined, ["ab", "cde"]],
      [
        "Wiiiii",
        { W: 8, Wi: 9, Wii: 10, Wiii: 11, Wiiii: 12, i: 1, ii: 2, iii: 3, iiii: 4, iiiii: 5 },
        ["W", "iiiii"],
      ],
      ["abcd", { a: 1, ab: 6, abc: 2, bcd: 12, cd: 6, d: 3 }, ["abc", "d"]],
      ["abcd", { a: 2, ab: 6, abc: 9, bcd: 6, cd: 5, d: 1 }, ["ab", "cd"]],
      ["abcd", { a: 0, ab: 0, abc: 0, bcd: 0, cd: 0, d: 0 }, ["a", "bcd"]],
    ] satisfies readonly [
      string,
      Record<string, number> | undefined,
      readonly [string, string],
    ][]) {
      const table: Readonly<Record<string, number>> | undefined = widths;
      const measure = vi.fn((part: string) => (table === undefined ? part.length : table[part]!));
      expect(splitBalancedGraphemes(measure, text)).toEqual(expected);
      const boundaries = text.length - 1;
      expect(measure).toHaveBeenCalledTimes(boundaries * 2);
      expect(measure.mock.calls).toEqual(
        Array.from({ length: boundaries }, (_, i) => [
          [text.slice(0, i + 1)],
          [text.slice(i + 1)],
        ]).flat(),
      );
    }
  });

  it("preserves combining clusters, joined emoji, modifiers, flags, CRLF and whitespace verbatim", () => {
    const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    const count = (part: string) => [...graphemes.segment(part)].length;
    for (const [text, expected] of [
      ["a\u0301b", ["a\u0301", "b"]],
      ["👩🏽‍💻x", ["👩🏽‍💻", "x"]],
      ["🇨🇦🇫🇷x", ["🇨🇦", "🇫🇷x"]],
      ["\r\nx", ["\r\n", "x"]],
      [" \ta\r\n ", [" \t", "a\r\n "]],
    ] satisfies readonly [string, readonly [string, string]][]) {
      const result = splitBalancedGraphemes(count, text);
      expect(result).toEqual(expected);
      expect(result!.join("")).toBe(text);
    }
  });

  it("does not measure empty text or a single Unicode grapheme", () => {
    const measure = vi.fn(() => {
      throw new Error("Must not measure");
    });
    for (const text of ["", "x", "a\u0301", "👩🏽‍💻", "🇨🇦", "\r\n"]) {
      expect(splitBalancedGraphemes(measure, text)).toBeUndefined();
    }
    expect(measure).not.toHaveBeenCalled();
  });

  it("rejects invalid widths on either half or a later boundary and propagates measure errors", () => {
    for (const invalid of [-1, NaN, Infinity, -Infinity]) {
      for (const at of [0, 1, 4, 5]) {
        let calls = 0;
        expect(() => splitBalancedGraphemes(() => (calls++ === at ? invalid : 1), "abcd")).toThrow(
          RangeError,
        );
      }
    }
    const error = new Error("Measure failed");
    expect(() =>
      splitBalancedGraphemes(() => {
        throw error;
      }, "ab"),
    ).toThrow(error);
  });
});

describe("strayNames", () => {
  it("reports each name a line uses that its table does not list", () => {
    for (const [, table, text, stray] of [
      ["a listed name", { a: ["dog"] }, { a: "{dog}!" }, []],
      ["an unlisted name", { a: ["dog"] }, { a: "{dog} {gear}" }, ["a: {gear}"]],
      ["a line its table leaves out", {}, { a: "{dog}" }, ["a: {dog}"]],
      [
        "a line in a group",
        { g: { a: [] } },
        { g: { a: "{x}", b: "{y}" } },
        ["g.a: {x}", "g.b: {y}"],
      ],
    ] satisfies readonly [string, FieldTable, object, string[]][]) {
      expect(strayNames(table, text)).toEqual(stray);
    }
  });
});

describe("fillLine", () => {
  it("fills every name, wherever it appears", () => {
    const table = { line: ["owner"] } as const;
    expect(fillLine(table, { line: "{owner}, {owner}!" }, "line", { owner: "Rosa" })).toBe(
      "Rosa, Rosa!",
    );
  });
});

describe("sentences", () => {
  it.each<[string, string, string[]]>([
    [
      "splits at each sentence's end",
      "Ends here. Then this! Why?",
      ["Ends here.", "Then this!", "Why?"],
    ],
    ["keeps one sentence whole", "One sentence, no break", ["One sentence, no break"]],
    ["keeps a mark inside a word", "Cash is $1.50 now.", ["Cash is $1.50 now."]],
    ["gives empty text no sentences", " ", []],
  ])("%s", (_name, text, expected) => {
    expect(sentences(text)).toEqual(expected);
  });
});

describe("wrapWords", () => {
  const chars = (line: string) => line.length;

  it("breaks between words within the width, a long word on its own line", () => {
    for (const [, width, text, expected] of [
      [
        "breaks between words, keeping each line within the width",
        12,
        "He already did 10K. He's fine.",
        ["He already", "did 10K.", "He's fine."],
      ],
      [
        "gives a word longer than the width a line of its own",
        4,
        "a supercalifragilistic b",
        ["a", "supercalifragilistic", "b"],
      ],
      ["keeps text within the width on one line", Infinity, "one  two\nthree", ["one two three"]],
    ] satisfies readonly [string, number, string, string[]][]) {
      expect(wrapWords(chars, width, text)).toEqual(expected);
    }
  });
});
