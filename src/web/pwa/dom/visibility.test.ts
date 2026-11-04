import { describe, expect, it } from "vitest";

import { type VisibilitySource, watchVisibility } from "./visibility.ts";

class FakeDocument extends EventTarget implements VisibilitySource {
  visibilityState: DocumentVisibilityState;

  constructor(visibilityState: DocumentVisibilityState) {
    super();
    this.visibilityState = visibilityState;
  }
}

// An event to dispatch: a window event by name, or a visibilitychange to a state.
type Step = "pagehide" | "pageshow" | DocumentVisibilityState;

describe("watchVisibility", () => {
  it.each<[string, DocumentVisibilityState, Step[], boolean[]]>([
    ["a page hidden and shown again", "visible", ["hidden", "visible"], [false, true]],
    ["a repeated state", "visible", ["visible", "hidden", "hidden"], [false]],
    ["pagehide on a visible page", "visible", ["pagehide"], [false]],
    ["pageshow after pagehide", "visible", ["pagehide", "pageshow"], [false, true]],
    ["pageshow on a still-hidden page", "hidden", ["pageshow"], []],
    ["a page starting hidden and shown", "hidden", ["visible"], [true]],
  ])("reports %s", (_, initial, steps, reported) => {
    const page = new EventTarget();
    const document = new FakeDocument(initial);
    const changes: boolean[] = [];
    watchVisibility(page, document, (visible) => changes.push(visible));
    for (const step of steps) {
      if (step === "pagehide" || step === "pageshow") {
        page.dispatchEvent(new Event(step));
      } else {
        document.visibilityState = step;
        document.dispatchEvent(new Event("visibilitychange"));
      }
    }
    expect(changes).toEqual(reported);
  });

  it.each<Step>(["hidden", "pagehide"])("reports nothing for %s after stopping", (step) => {
    const page = new EventTarget();
    const document = new FakeDocument("visible");
    const changes: boolean[] = [];
    watchVisibility(page, document, (visible) => changes.push(visible))();
    document.visibilityState = "hidden";
    (step === "pagehide" ? page : document).dispatchEvent(
      new Event(step === "pagehide" ? step : "visibilitychange"),
    );
    expect(changes).toEqual([]);
  });
});
