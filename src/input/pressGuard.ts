import type { ModalInputScope } from "./modalInput.ts";

// The gate a press answers to: a modalInput scope, or the gate itself for presses outside any
// modal.
export type PressGate = Pick<ModalInputScope, "accepts" | "capture">;

// What a press must pass: the gate, and optionally a tap guard (tapGuard) that refuses presses
// until guardMs after drawnMs, when the view was first drawn, or while it is still null. Times are
// on the clock of event timeStamps and performance.now().
export interface PressGuard {
  readonly gate: PressGate;
  readonly tapGuard?: { readonly drawnMs: () => number | null; readonly guardMs: number };
}
