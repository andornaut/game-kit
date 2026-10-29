import { describe, expect, it } from "vitest";

import { guardPassed } from "./tapGuard";

const GUARD_MS = 400;
const DRAWN_MS = 5_000;

describe("guardPassed", () => {
  // drawnMs: the overlay's first drawn frame, or null before it. nowMs: the tap's time.
  it.each<[string, number, number | null, number, boolean]>([
    ["ignores a tap before the overlay is first drawn", GUARD_MS, null, DRAWN_MS + GUARD_MS, false],
    ["ignores a tap just inside the guard", GUARD_MS, DRAWN_MS, DRAWN_MS + GUARD_MS - 1, false],
    ["takes a tap once the guard has passed", GUARD_MS, DRAWN_MS, DRAWN_MS + GUARD_MS, true],
    ["takes a tap on the first drawn frame with no guard", 0, DRAWN_MS, DRAWN_MS, true],
  ])("%s", (_, guardMs, drawnMs, nowMs, acts) => {
    expect(guardPassed(guardMs, drawnMs, nowMs)).toBe(acts);
  });
});
