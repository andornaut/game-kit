// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { focusTarget, inputModality, trackInputModality } from "./focusModality.ts";

const HIDDEN_RING = { focusVisible: false, preventScroll: true };

const keydown = (target: EventTarget) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Tab" }));
const pointerdown = (target: EventTarget) =>
  target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 }));

let button: HTMLButtonElement;

beforeEach(() => {
  button = document.createElement("button");
  document.body.append(button);
});

afterEach(() => {
  trackInputModality(document)();
  button.remove();
  vi.restoreAllMocks();
});

describe("trackInputModality", () => {
  it("knows no modality before any input", () => {
    trackInputModality(document);
    expect(inputModality(document)).toBeUndefined();
  });

  it("switches to keyboard on keydown and back to pointer on pointerdown", () => {
    trackInputModality(document);
    keydown(button);
    expect(inputModality(document)).toBe("keyboard");
    pointerdown(button);
    expect(inputModality(document)).toBe("pointer");
  });

  it("sees a key that a listener under the document stops", () => {
    trackInputModality(document);
    button.addEventListener("keydown", (event) => event.stopPropagation());
    keydown(button);
    expect(inputModality(document)).toBe("keyboard");
  });

  it("follows touchstart where the browser has no pointer events", () => {
    const page = Object.assign(new EventTarget(), {
      defaultView: { PointerEvent: undefined },
    }) as unknown as Document;
    const stop = trackInputModality(page);
    keydown(page);
    pointerdown(page);
    expect(inputModality(page)).toBe("keyboard");
    page.dispatchEvent(new Event("touchstart"));
    expect(inputModality(page)).toBe("pointer");
    stop();
  });

  it("returns the same disposer and adds no listeners when the document is already tracked", () => {
    const add = vi.spyOn(document, "addEventListener");
    const stop = trackInputModality(document);
    expect(trackInputModality(document)).toBe(stop);
    expect(add.mock.calls.map(([type]) => type)).toEqual(["keydown", "pointerdown"]);
  });

  it("removes the listeners it added and forgets the modality when disposed", () => {
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    const stop = trackInputModality(document);
    keydown(button);
    stop();
    expect(remove.mock.calls).toEqual(add.mock.calls);
    expect(inputModality(document)).toBeUndefined();
    stop();
    expect(remove).toHaveBeenCalledTimes(2);
  });
});

describe("focusTarget", () => {
  it("hides the ring before any input and tracks the document from then on", () => {
    const focus = vi.spyOn(button, "focus");
    focusTarget(button);
    expect(focus).toHaveBeenCalledExactlyOnceWith(HIDDEN_RING);
    expect(document.activeElement).toBe(button);
    keydown(button);
    expect(inputModality(document)).toBe("keyboard");
  });

  it("focuses with no options after keyboard input, and hides the ring after a later press", () => {
    trackInputModality(document);
    const focus = vi.spyOn(button, "focus");
    keydown(button);
    focusTarget(button);
    expect(focus).toHaveBeenLastCalledWith();
    pointerdown(button);
    focusTarget(button);
    expect(focus).toHaveBeenLastCalledWith(HIDDEN_RING);
  });
});
