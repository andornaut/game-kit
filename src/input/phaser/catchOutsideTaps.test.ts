import type { Input, Scene } from "phaser";
import { describe, expect, it } from "vitest";

import type { Point } from "../../rect";
import type { OutsideArea } from "../outsideTap";
import { catchOutsideTaps } from "./catchOutsideTaps";

// A 100x100 screen with a panel in its middle and a top bar button in its top-right corner.
const AREA: OutsideArea = {
  bounds: { height: 100, width: 100, x: 0, y: 0 },
  covered: [
    { height: 40, width: 40, x: 30, y: 30 },
    { height: 20, width: 20, x: 80, y: 0 },
  ],
};
const TAP_MAX = 10;
const BESIDE = { x: 5, y: 50 };
const BUTTON = { x: 90, y: 10 };
const PANEL = { x: 50, y: 50 };

type Phase = "down" | "move" | "up";
// A pointer's event: its phase, the pointer's id and where it is; cancelled: the browser called
// the press off.
type Step = readonly [Phase, number, Point, boolean?];

const EVENTS: Readonly<Record<Phase, string>> = {
  down: "pointerdown",
  move: "pointermove",
  up: "pointerup",
};

// Plays steps on a scene's input with the area open, or none, and reports how many times the
// panel was dismissed and which steps were kept from the scenes under it.
function play(open: OutsideArea | undefined, steps: readonly Step[]) {
  const listeners = new Map<string, (pointer: Input.Pointer) => void>();
  let stopped = false;
  const input = {
    on: (event: string, listener: (pointer: Input.Pointer) => void) => {
      listeners.set(event, listener);
    },
    stopPropagation: () => {
      stopped = true;
    },
  };
  let dismissed = 0;
  const scene = { input } as unknown as Pick<Scene, "input">;
  catchOutsideTaps(
    TAP_MAX,
    scene,
    () => open,
    () => (dismissed += 1),
  );
  const kept = steps.map(([phase, id, point, cancelled = false]) => {
    stopped = false;
    const pointer = { ...point, id, wasCanceled: cancelled } as Input.Pointer;
    listeners.get(EVENTS[phase])?.(pointer);
    return stopped;
  });
  return { dismissed, kept };
}

describe("catchOutsideTaps", () => {
  // The steps, how many times they dismiss the panel, and which the scenes under never hear.
  it.each<[string, OutsideArea | undefined, Step[], number, boolean[]]>([
    [
      "dismisses on a tap beside the panel, which the scenes under never hear",
      AREA,
      [
        ["down", 1, BESIDE],
        ["move", 1, { x: 8, y: 52 }],
        ["up", 1, BESIDE],
      ],
      1,
      [true, true, true],
    ],
    [
      "dismisses nothing on a drag beside the panel, which the scenes under never hear",
      AREA,
      [
        ["down", 1, BESIDE],
        ["move", 1, { x: 5, y: 80 }],
        ["up", 1, BESIDE],
      ],
      0,
      [true, true, true],
    ],
    [
      "dismisses nothing on a cancelled press",
      AREA,
      [
        ["down", 1, BESIDE],
        ["up", 1, BESIDE, true],
      ],
      0,
      [true, true],
    ],
    [
      "leaves a press on the panel to the scenes",
      AREA,
      [
        ["down", 1, PANEL],
        ["up", 1, BESIDE],
      ],
      0,
      [false, false],
    ],
    [
      "leaves a press on a covered button to the scenes",
      AREA,
      [
        ["down", 1, BUTTON],
        ["up", 1, BUTTON],
      ],
      0,
      [false, false],
    ],
    [
      "leaves every press alone with no panel open",
      undefined,
      [
        ["down", 1, BESIDE],
        ["up", 1, BESIDE],
      ],
      0,
      [false, false],
    ],
    [
      "dismisses once for two fingers, on the first one's tap",
      AREA,
      [
        ["down", 1, BESIDE],
        ["down", 2, { x: 5, y: 90 }],
        ["up", 2, { x: 5, y: 90 }],
        ["up", 1, BESIDE],
      ],
      1,
      [true, true, true, true],
    ],
    [
      "drops a press it never heard lift when the pointer goes down again",
      AREA,
      [
        ["down", 1, BESIDE],
        ["down", 1, PANEL],
        ["up", 1, PANEL],
        ["down", 2, BESIDE],
        ["up", 2, BESIDE],
      ],
      1,
      [true, false, false, true, true],
    ],
  ])("%s", (_, open, steps, dismissed, kept) => {
    expect(play(open, steps)).toEqual({ dismissed, kept });
  });
});
