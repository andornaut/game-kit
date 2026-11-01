import { describe, expect, it } from "vitest";

import { watchVisibility } from "./visibility";
import type { VisibilitySource } from "./wakeLock";

class FakeDocument extends EventTarget implements VisibilitySource {
  visibilityState: DocumentVisibilityState = "visible";

  setVisibility(state: DocumentVisibilityState): void {
    this.visibilityState = state;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}

// A step: the document's visibility changing to a state, or the window's pagehide or pageshow.
type Step = DocumentVisibilityState | "pagehide" | "pageshow";

describe("watchVisibility", () => {
  it.each<[string, Step[], boolean[]]>([
    ["reports each change once", ["hidden", "pagehide", "visible", "visible"], [false, true]],
    [
      "treats pagehide as hidden and pageshow as a recheck",
      ["pagehide", "pageshow"],
      [false, true],
    ],
    ["reports nothing while the page stays visible", ["visible", "pageshow"], []],
  ])("%s", (_, steps, expected) => {
    const page = new FakeDocument();
    const window = new EventTarget();
    const seen: boolean[] = [];
    watchVisibility((visible) => seen.push(visible), window, page);
    for (const step of steps) {
      if (step === "pagehide" || step === "pageshow") {
        window.dispatchEvent(new Event(step));
      } else {
        page.setVisibility(step);
      }
    }
    expect(seen).toEqual(expected);
  });
});
