import { describe, expect, it } from "vitest";

import { modalWidth } from "./modalLayout";

describe("modalWidth", () => {
  it.each([
    { available: 400, content: 300, expected: 332, name: "intrinsic content with padding" },
    { available: 400, content: 100, expected: 320, name: "the shared minimum" },
    { available: 280, content: 100, expected: 280, name: "a viewport below the minimum" },
    { available: 400, content: 500, expected: 400, name: "content wider than the viewport" },
  ])("fits $name", ({ available, content, expected }) => {
    expect(modalWidth(available, content)).toBe(expected);
  });
});
