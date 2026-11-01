export type PointerPhase = "cancel" | "down" | "move" | "up";

export interface OnePressStep {
  // Whether the scene handles the event.
  handle: boolean;
  // The pointer the scene follows next.
  owner: number | undefined;
}

// A one-finger scene follows the first pointer down until it lifts, and ignores every other
// pointer meanwhile. ownerDown says whether the followed pointer is still down: one whose
// release went to another scene no longer holds the scene once a new press comes.
export function followOnePress(
  ownerDown: boolean,
  phase: PointerPhase,
  id: number,
  owner: number | undefined,
): OnePressStep {
  if (phase === "down") {
    const free = owner === undefined || owner === id || !ownerDown;
    return free ? { handle: true, owner: id } : { handle: false, owner };
  }
  if (id !== owner) {
    return { handle: false, owner };
  }
  return { handle: true, owner: phase === "move" ? owner : undefined };
}
