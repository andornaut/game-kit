import type { ModalInputScope } from "../../../input/modalInput.ts";
import { followOnePress } from "../../../input/onePress.ts";
import { type OutsidePress, outsidePressMove } from "../../../input/outsideTap.ts";
import { guardPassed } from "../../../input/tapGuard.ts";
import { readUnit } from "./viewUnits.ts";

// DOM presses under the modal input gate (input/modalInput): a press captures the gate on its
// pointerdown and its click checks that capture, so a gesture never crosses a modal-stack change.
// Only the first pointer down is followed until it lifts (input/onePress). A view that breaks into
// play can refuse presses until guardMs after it is first drawn (input/tapGuard). A click with no
// pointer behind it (Enter or Space, or element.click()) needs only the gate to accept it then.

// The gate the presses answer to: a modalInput scope, or the gate itself for presses outside any
// modal.
export type PressGate = Pick<ModalInputScope, "accepts" | "capture">;

export interface PressGuard {
  readonly gate: PressGate;
  // Refuses presses until guardMs after drawnMs, when the view was first drawn, or while it is
  // still null. Times are on the clock of event timeStamps and performance.now().
  readonly tapGuard?: { readonly drawnMs: () => number | null; readonly guardMs: number };
}

interface FollowedPress {
  down(event: PointerEvent): void;
  move?(event: PointerEvent): void;
  // Called for the followed pointer's pointerup and pointercancel, and with followed false for
  // any other pointer's.
  up(event: PointerEvent, followed: boolean): void;
}

// Follows one pointer from a pointerdown on element, seen before any listener under it. Lifts are
// read on the whole document, so a pointer released elsewhere never holds the press.
function followFirstPointer(handlers: FollowedPress, element: HTMLElement): () => void {
  const document = element.ownerDocument;
  const down = new Set<number>();
  let owner: number | undefined;
  const step = (phase: "cancel" | "down" | "move" | "up", event: PointerEvent) => {
    const next = followOnePress(
      owner !== undefined && down.has(owner),
      phase,
      event.pointerId,
      owner,
    );
    owner = next.owner;
    return next.handle;
  };
  const onDown = (event: PointerEvent) => {
    down.add(event.pointerId);
    if (step("down", event)) {
      handlers.down(event);
    }
  };
  const onMove = (event: PointerEvent) => {
    if (handlers.move !== undefined && step("move", event)) {
      handlers.move(event);
    }
  };
  const onEnd = (event: PointerEvent) => {
    down.delete(event.pointerId);
    handlers.up(event, step(event.type === "pointercancel" ? "cancel" : "up", event));
  };
  element.addEventListener("pointerdown", onDown, true);
  document.addEventListener("pointermove", onMove, true);
  document.addEventListener("pointerup", onEnd, true);
  document.addEventListener("pointercancel", onEnd, true);
  return () => {
    element.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("pointermove", onMove, true);
    document.removeEventListener("pointerup", onEnd, true);
    document.removeEventListener("pointercancel", onEnd, true);
  };
}

function passed(guard: PressGuard, nowMs: number): boolean {
  const { tapGuard } = guard;
  return tapGuard === undefined || guardPassed(tapGuard.guardMs, tapGuard.drawnMs(), nowMs);
}

// Captures the gate for a followed press, or refuses it outright while the tap guard holds.
function capture(guard: PressGuard, event: Event): () => boolean {
  return passed(guard, event.timeStamp) ? guard.gate.capture() : () => false;
}

// Stops every click inside root that the guard refuses before any listener under root sees it.
// Returns a function that removes the listeners.
export function guardClicks(guard: PressGuard, root: HTMLElement): () => void {
  const presses = new Map<number, () => boolean>();
  // The check of the press whose pointerup came last, which the click that follows completes.
  let released: (() => boolean) | undefined;
  const stopFollowing = followFirstPointer(
    {
      down(event) {
        presses.set(event.pointerId, capture(guard, event));
      },
      up(event, followed) {
        released =
          followed && event.type === "pointerup" ? presses.get(event.pointerId) : undefined;
        presses.delete(event.pointerId);
      },
    },
    root,
  );
  const onClick = (event: MouseEvent) => {
    const accepted =
      event.detail === 0
        ? passed(guard, event.timeStamp) && guard.gate.accepts()
        : released?.() === true;
    released = undefined;
    if (!accepted) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  root.addEventListener("click", onClick, true);
  return () => {
    stopFollowing();
    root.removeEventListener("click", onClick, true);
  };
}

// Calls onTap for a tap on backdrop itself, the full-area element behind a card: a followed press
// that lands on it, never travels past tapMaxDistance base px (at the --ui-unit in effect on
// backdrop) and lifts there, with the gate captured at its pointerdown still holding. Returns a
// function that removes the listeners.
export function listenOutsideTaps(
  guard: PressGuard,
  tapMaxDistance: number,
  onTap: () => void,
  backdrop: HTMLElement,
): () => void {
  let press: { check: () => boolean; maxDistance: number; outside: OutsidePress } | undefined;
  const point = (event: PointerEvent) => ({ x: event.clientX, y: event.clientY });
  const travel = (event: PointerEvent) => {
    if (press !== undefined) {
      press.outside = outsidePressMove(press.maxDistance, point(event), press.outside);
    }
  };
  return followFirstPointer(
    {
      down(event) {
        press =
          event.target === backdrop
            ? {
                check: capture(guard, event),
                maxDistance: tapMaxDistance * readUnit(backdrop),
                outside: { start: point(event), tapping: true },
              }
            : undefined;
      },
      move: travel,
      up(event, followed) {
        if (!followed) {
          return;
        }
        travel(event);
        const tapped =
          event.type === "pointerup" &&
          event.target === backdrop &&
          press?.outside.tapping === true &&
          press.check();
        press = undefined;
        if (tapped) {
          onTap();
        }
      },
    },
    backdrop,
  );
}
