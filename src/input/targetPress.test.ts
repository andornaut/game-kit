import { describe, expect, it } from "vitest";

import { pressDown, pressUp, type TargetPressRule } from "./targetPress.ts";

type Target = { kind: "close" } | { kind: "page" } | { kind: "row"; row: number };

const CLOSE: Target = { kind: "close" };
const PAGE: Target = { kind: "page" };
const row = (n: number): Target => ({ kind: "row", row: n });
// Rows and the page button dip for 140ms, and the page button opens a page; close acts at once.
const RULE: TargetPressRule<Target> = {
  dipMs: (target) => (target.kind === "close" ? 0 : 140),
  opens: (target) => target.kind === "page",
  same: (a, b) => a.kind === b.kind && (a.kind !== "row" || (b.kind === "row" && a.row === b.row)),
};
const STARTED_MS = 1_000;

describe("a press on a target", () => {
  // delayMs: how long the tap waits before it acts, and liftMs how long it shows pressed after
  // the release; both undefined for no tap.
  it.each([
    ["taps a target released over itself", CLOSE, CLOSE, 50, false, 0, 0],
    ["waits out the rest of a quick tap's dip", row(1), row(1), 50, false, 90, 90],
    ["acts at once on a tap held past its dip", row(1), row(1), 300, false, 0, 0],
    ["opens a page at once, its dip playing on", PAGE, PAGE, 50, false, 0, 90],
    ["taps nothing when released over another target", row(1), row(2), 50, false, NaN, NaN],
    ["taps nothing when released off every target", row(1), undefined, 50, false, NaN, NaN],
    ["taps nothing when it began off every target", undefined, row(1), 50, false, NaN, NaN],
    ["taps nothing when the browser cancels it", CLOSE, CLOSE, 50, true, NaN, NaN],
  ] satisfies readonly [
    string,
    Target | undefined,
    Target | undefined,
    number,
    boolean,
    number,
    number,
  ][])("%s", (_, pressed, released, heldMs, cancelled, delayMs, liftMs) => {
    const press = pressDown(STARTED_MS, pressed);
    expect(pressUp(RULE, STARTED_MS + heldMs, cancelled, press, released)).toEqual(
      Number.isNaN(delayMs) ? { kind: "none" } : { delayMs, kind: "tap", liftMs, target: pressed },
    );
  });
});
