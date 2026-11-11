// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createModalInputGate, type ModalInputScope } from "../../../input/modalInput.ts";
import { guardClicks, listenOutsideTaps, type PressGuard } from "./domPress.ts";

function pointer(type: string, target: EventTarget, init: PointerEventInit = {}): PointerEvent {
  const event = new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, ...init });
  target.dispatchEvent(event);
  return event;
}

// A full click: pointerdown and pointerup on target, then the click the browser follows them with.
function tap(target: EventTarget, init: PointerEventInit = {}): void {
  pointer("pointerdown", target, init);
  pointer("pointerup", target, init);
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
}

let root: HTMLDivElement;
let button: HTMLButtonElement;
let scope: ModalInputScope;
let clicked: ReturnType<typeof vi.fn<() => void>>;
let stop: () => void;
const gate = createModalInputGate();

beforeEach(() => {
  root = document.createElement("div");
  button = document.createElement("button");
  root.append(button);
  document.body.append(root);
  scope = gate.open();
  clicked = vi.fn<() => void>();
  button.addEventListener("click", clicked);
});

afterEach(() => {
  stop();
  scope.close();
  root.remove();
});

describe("guardClicks", () => {
  beforeEach(() => {
    stop = guardClicks({ gate: scope }, root);
  });

  it("lets a press and release on the top modal click", () => {
    tap(button);
    expect(clicked).toHaveBeenCalledOnce();
  });

  it("stops a click whose press began before the modal stack changed", () => {
    pointer("pointerdown", button);
    gate.open().close();
    pointer("pointerup", button);
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    expect(clicked).not.toHaveBeenCalled();
  });

  it("stops a pointer click with no press behind it", () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    expect(clicked).not.toHaveBeenCalled();
  });

  it("stops a second finger's click while the first is down", () => {
    pointer("pointerdown", button, { pointerId: 1 });
    tap(button, { pointerId: 2 });
    expect(clicked).not.toHaveBeenCalled();
  });

  it("follows a new press once the first pointer has lifted anywhere", () => {
    pointer("pointerdown", button, { pointerId: 1 });
    pointer("pointerup", document.body, { pointerId: 1 });
    tap(button, { pointerId: 2 });
    expect(clicked).toHaveBeenCalledOnce();
  });

  it("stops a cancelled press's click", () => {
    pointer("pointerdown", button);
    pointer("pointercancel", button);
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    expect(clicked).not.toHaveBeenCalled();
  });

  it("lets a keyboard click through only while the gate accepts", () => {
    button.click();
    const cover = gate.open();
    button.click();
    cover.close();
    expect(clicked).toHaveBeenCalledOnce();
  });
});

describe("guardClicks with a tap guard", () => {
  let drawnMs: number | null;

  beforeEach(() => {
    drawnMs = null;
    const guard: PressGuard = { gate: scope, tapGuard: { drawnMs: () => drawnMs, guardMs: 250 } };
    stop = guardClicks(guard, root);
  });

  it("refuses presses until the view has been drawn for guardMs", () => {
    tap(button);
    drawnMs = performance.now();
    tap(button);
    drawnMs = performance.now() - 250;
    tap(button);
    expect(clicked).toHaveBeenCalledOnce();
  });
});

describe("listenOutsideTaps", () => {
  let backdrop: HTMLDivElement;
  let onTap: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    backdrop = document.createElement("div");
    backdrop.style.setProperty("--ui-unit", "2");
    root.append(backdrop);
    onTap = vi.fn<() => void>();
    stop = listenOutsideTaps({ gate: scope }, 10, onTap, backdrop);
  });

  it("calls onTap for a press and lift on the backdrop", () => {
    pointer("pointerdown", backdrop, { clientX: 5, clientY: 5 });
    pointer("pointerup", backdrop, { clientX: 20, clientY: 5 });
    expect(onTap).toHaveBeenCalledOnce();
  });

  it("takes a press that travels past the distance, at the unit in effect, as a drag", () => {
    pointer("pointerdown", backdrop, { clientX: 0, clientY: 0 });
    pointer("pointermove", backdrop, { clientX: 21, clientY: 0 });
    pointer("pointerup", backdrop, { clientX: 0, clientY: 0 });
    expect(onTap).not.toHaveBeenCalled();
  });

  it.each([
    ["lands on the card", true],
    ["lifts on the card", false],
  ])("ignores a press that %s", (_, landsOnCard) => {
    pointer("pointerdown", landsOnCard ? button : backdrop);
    pointer("pointerup", landsOnCard ? backdrop : button);
    expect(onTap).not.toHaveBeenCalled();
  });

  it("ignores a tap that crosses a modal-stack change", () => {
    pointer("pointerdown", backdrop);
    gate.open().close();
    pointer("pointerup", backdrop);
    expect(onTap).not.toHaveBeenCalled();
  });
});
