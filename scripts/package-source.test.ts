import { expect, it } from "vitest";

import { sourceCommit } from "./package-source.ts";

const revision = "a".repeat(40);
const source = { SOURCE_COMMIT: revision, SOURCE_DATE_EPOCH: "1700000000" };

it("returns the full source commit", () => {
  expect(sourceCommit(source)).toBe(revision);
});

it.each([{ SOURCE_COMMIT: "short" }, { SOURCE_COMMIT: "" }, { SOURCE_DATE_EPOCH: "" }])(
  "rejects missing or malformed source identity %o",
  (override) => {
    expect(() => sourceCommit({ ...source, ...override })).toThrow();
  },
);
