import { describe, expect, it } from "vitest";

import { modalWidth } from "./modalLayout.ts";

describe("modalWidth", () => {
  it.each([
    {
      availableWidth: 328,
      content: 100,
      expected: 180,
      name: "portrait minimum",
      viewportWidth: 360,
    },
    {
      availableWidth: 928,
      content: 100,
      expected: 480,
      name: "landscape minimum",
      viewportWidth: 960,
    },
    {
      availableWidth: 328,
      content: 250,
      expected: 282,
      name: "intrinsic content with padding",
      viewportWidth: 360,
    },
    {
      availableWidth: 160,
      content: 100,
      expected: 160,
      name: "minimum clamped to available space",
      viewportWidth: 360,
    },
    {
      availableWidth: 328,
      content: 500,
      expected: 328,
      name: "content clamped to available space",
      viewportWidth: 360,
    },
  ])("fits $name", ({ availableWidth, content, expected, viewportWidth }) => {
    expect(modalWidth({ availableWidth, viewportWidth }, content)).toBe(expected);
  });
});
