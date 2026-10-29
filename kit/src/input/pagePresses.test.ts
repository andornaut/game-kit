import { describe, expect, it } from "vitest";

import {
  clientPoint,
  listenPagePresses,
  onBarePage,
  onPageControl,
  PAGE_CONTROLS,
  type PagePointerEvent,
} from "./pagePresses";

type PointerType = "pointercancel" | "pointerdown" | "pointermove" | "pointerup";

// A pointer event at x, with timeStamp t. pointerType "mouse" stands for a press accepts refuses.
function pointerEvent(
  type: PointerType,
  pointerId: number,
  clientX: number,
  timeStamp: number,
  pointerType = "touch",
): Event {
  const fields = { clientX, clientY: 0, pointerId, pointerType, timeStamp };
  return Object.defineProperties(
    new Event(type),
    Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, { value }])),
  );
}

// Each event as [type, pointer id, x, time, pointer type], and each call the handlers get as
// "kind:pointerId@downTime:x".
type Step = readonly [PointerType, number, number, number, string?];

function calls(steps: readonly Step[], removeAfter = steps.length): string[] {
  const target = new EventTarget();
  const seen: string[] = [];
  const record =
    (kind: string) =>
    ({ downTime, pointerId }: { downTime: number; pointerId: number }, event: PagePointerEvent) =>
      seen.push(`${kind}:${pointerId}@${downTime}:${event.clientX}`);
  const remove = listenPagePresses(
    (event) => event.pointerType === "touch",
    { cancel: record("cancel"), down: record("down"), move: record("move"), up: record("up") },
    target,
  );
  steps.forEach(([type, id, x, t, pointerType], index) => {
    if (index === removeAfter) {
      remove();
    }
    target.dispatchEvent(pointerEvent(type, id, x, t, pointerType));
  });
  return seen;
}

describe("listenPagePresses", () => {
  it.each<[string, Step[], string[]]>([
    [
      "follows an accepted press until it lifts",
      [
        ["pointerdown", 1, 10, 100],
        ["pointermove", 1, 20, 110],
        ["pointerup", 1, 30, 120],
        ["pointermove", 1, 40, 130],
      ],
      ["down:1@100:10", "move:1@100:20", "up:1@100:30"],
    ],
    [
      "ends a press the browser cancels",
      [
        ["pointerdown", 1, 10, 100],
        ["pointercancel", 1, 15, 105],
        ["pointerup", 1, 20, 110],
      ],
      ["down:1@100:10", "cancel:1@100:15"],
    ],
    [
      "never follows a refused press",
      [
        ["pointerdown", 1, 10, 100, "mouse"],
        ["pointermove", 1, 20, 110],
        ["pointerup", 1, 30, 120],
      ],
      [],
    ],
    [
      "follows two pointers apart",
      [
        ["pointerdown", 1, 10, 100],
        ["pointerdown", 2, 50, 105],
        ["pointermove", 2, 60, 110],
        ["pointerup", 1, 15, 115],
        ["pointermove", 2, 70, 120],
      ],
      ["down:1@100:10", "down:2@105:50", "move:2@105:60", "up:1@100:15", "move:2@105:70"],
    ],
    [
      "tells a pointer's next press by its down time",
      [
        ["pointerdown", 1, 10, 100],
        ["pointerup", 1, 10, 110],
        ["pointerdown", 1, 30, 200],
        ["pointerup", 1, 30, 210],
      ],
      ["down:1@100:10", "up:1@100:10", "down:1@200:30", "up:1@200:30"],
    ],
  ])("%s", (_, steps, expected) => {
    expect(calls(steps)).toEqual(expected);
  });

  it("hears nothing once removed", () => {
    const steps: Step[] = [
      ["pointerdown", 1, 10, 100],
      ["pointermove", 1, 20, 110],
      ["pointerup", 1, 30, 120],
    ];
    expect(calls(steps, 1)).toEqual(["down:1@100:10"]);
  });
});

describe("clientPoint", () => {
  it("reads the event's client position", () => {
    const event = {
      clientX: 12,
      clientY: 34,
      pointerId: 1,
      pointerType: "touch",
      target: null,
      timeStamp: 0,
    };
    expect(clientPoint(event)).toEqual({ x: 12, y: 34 });
  });
});

describe("onBarePage", () => {
  const [root, body, container] = [new EventTarget(), new EventTarget(), new EventTarget()];

  it.each([
    ["the page's root", root, true],
    ["the page's body", body, true],
    ["the game's container beside the canvas", container, true],
    ["the canvas, which has its own rule", new EventTarget(), false],
    ["no target", null, false],
  ])("counts %s", (_, target, expected) => {
    expect(onBarePage([root, body, container], target)).toBe(expected);
  });
});

describe("onPageControl", () => {
  // An element whose closest finds an ancestor for PAGE_CONTROLS only when it is inside one.
  const element = (insideControl: boolean) =>
    Object.assign(new EventTarget(), {
      closest: (selectors: string) => (insideControl && selectors === PAGE_CONTROLS ? {} : null),
    });

  it.each([
    ["an element inside a link, button or nav bar", element(true), true],
    ["an element outside them", element(false), false],
    ["a target that is not an element", new EventTarget(), false],
    ["no target", null, false],
  ])("counts %s", (_, target, expected) => {
    expect(onPageControl(target)).toBe(expected);
  });
});
