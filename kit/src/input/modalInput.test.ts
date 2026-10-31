import { describe, expect, it } from "vitest";

import { createModalInputGate } from "./modalInput";

describe("createModalInputGate", () => {
  it("allows only the top modal and restores the previous owner after nested close", () => {
    const gate = createModalInputGate();
    expect(gate.accepts()).toBe(true);
    const card = gate.open();
    expect([gate.accepts(), card.accepts()]).toEqual([false, true]);
    const question = gate.open();
    expect([gate.accepts(), card.accepts(), question.accepts()]).toEqual([false, false, true]);
    question.close();
    expect([gate.accepts(), card.accepts(), question.accepts()]).toEqual([false, true, false]);
    card.close();
    expect([gate.accepts(), card.accepts()]).toEqual([true, false]);
  });

  it("rejects held underlying and modal gestures across open and close, including out-of-order close", () => {
    const gate = createModalInputGate();
    const heldUnder = gate.capture();
    const card = gate.open();
    const heldCard = card.capture();
    const question = gate.open();
    const heldQuestion = question.capture();
    card.close();
    expect(question.accepts()).toBe(true);
    expect(heldQuestion()).toBe(false);
    question.close();
    expect(gate.accepts()).toBe(true);
    expect([heldUnder(), heldCard(), heldQuestion()]).toEqual([false, false, false]);
    expect(gate.capture()()).toBe(true);
  });

  it("notifies held-control resets on changes and ignores repeated closes and unsubscribed listeners", () => {
    const gate = createModalInputGate();
    let resets = 0;
    const unsubscribe = gate.subscribe(() => {
      resets += 1;
    });
    const modal = gate.open();
    modal.close();
    modal.close();
    expect(resets).toBe(3);
    unsubscribe();
    gate.open();
    expect(resets).toBe(3);
  });
});
