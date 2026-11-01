import { describe, expect, it } from "vitest";

import { moveHold, releaseHold, startHold, tickHold } from "./hold.ts";

const rule = { holdMs: 500, slopPx: 10 };
const start = { x: 100, y: 200 };

describe("hold timing and movement", () => {
  it("fires once at the deadline and consumes its release", () => {
    const press = startHold(rule, start, 1000);
    expect(tickHold(1499, press)).toEqual({ fire: false, press });
    const held = tickHold(1500, press);
    expect(held.fire).toBe(true);
    expect(tickHold(1600, held.press).fire).toBe(false);
    expect(releaseHold(1600, held.press)).toBe("none");
  });

  it("recognizes a hold released between frames", () => {
    const press = startHold(rule, start, 1000);
    expect(releaseHold(1499, press)).toBe("tap");
    expect(releaseHold(1500, press)).toBe("hold");
  });

  it("uses radial slop and never restores a moved hold", () => {
    const press = startHold(rule, start, 0);
    expect(moveHold({ x: 106, y: 208 }, press)).toBe(press);
    const moved = moveHold({ x: 107, y: 208 }, press);
    expect(moved.state).toBe("moved");
    expect(moveHold(start, moved)).toBe(moved);
    expect(tickHold(1000, moved).fire).toBe(false);
    expect(releaseHold(1000, moved)).toBe("tap");
  });

  it("permits unbounded movement with infinite slop", () => {
    const press = startHold({ ...rule, slopPx: Infinity }, start, 0);
    expect(moveHold({ x: 10000, y: -10000 }, press)).toBe(press);
  });
});
