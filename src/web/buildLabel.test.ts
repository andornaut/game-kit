import { expect, it } from "vitest";

import { buildLabel } from "./buildLabel.ts";

it.each([
  ["a release", "1.2.3", "16d17c38", "v1.2.3 · 16d17c38"],
  ["a build without a known commit", "0.1.0", "dev", "v0.1.0 · dev"],
  ["a prerelease", "2.0.0-rc.1", "0123abcd", "v2.0.0-rc.1 · 0123abcd"],
])("labels %s", (_, version, commit, label) => {
  expect(buildLabel(version, commit)).toBe(label);
});
