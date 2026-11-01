import { describe, expect, it } from "vitest";

import { followOnePress, type OnePressStep, type PointerPhase } from "./onePress.ts";

describe("followOnePress", () => {
  it("follows the first pointer down until it lifts, ignoring a second finger", () => {
    let owner: number | undefined;
    const handled: string[] = [];
    const steps: [PointerPhase, number][] = [
      ["down", 1],
      ["down", 2],
      ["move", 2],
      ["move", 1],
      ["up", 2],
      ["up", 1],
      ["down", 2],
    ];
    for (const [phase, id] of steps) {
      const step = followOnePress(owner !== undefined, phase, id, owner);
      owner = step.owner;
      if (step.handle) {
        handled.push(`${phase} ${id}`);
      }
    }
    expect(handled).toEqual(["down 1", "move 1", "up 1", "down 2"]);
  });

  // Pointer 1 is followed; ownerDown says whether it is still on the screen.
  const step = (handle: boolean, owner: number | undefined): OnePressStep => ({ handle, owner });

  it("acts once per press", () => {
    for (const [, ownerDown, phase, id, expected] of [
      [
        "hands a cancel to the followed press, then frees it",
        true,
        "cancel",
        1,
        step(true, undefined),
      ],
      ["frees the scene from a press whose release it never saw", false, "down", 2, step(true, 2)],
      ["keeps another press out while the followed one is down", true, "down", 2, step(false, 1)],
      ["takes a new press of the followed pointer as a fresh one", true, "down", 1, step(true, 1)],
    ] satisfies readonly [string, boolean, PointerPhase, number, OnePressStep][]) {
      expect(followOnePress(ownerDown, phase, id, 1)).toEqual(expected);
    }
  });
});
