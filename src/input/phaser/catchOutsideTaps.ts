import type { Input, Scene } from "phaser";

import {
  type OutsideArea,
  type OutsidePress,
  outsidePressDown,
  outsidePressMove,
  outsideTapped,
} from "../outsideTap";

// The scene input's own events, and its stopPropagation, which keeps the event from every scene
// under it.
type SceneInput = Pick<Scene["input"], "on" | "stopPropagation">;

// Calls onDismiss on a tap outside an open panel (outsideTap), and keeps every event of a press
// that lands outside from the scenes under this one (its stopPropagation), so the tap that closes
// the panel never also reaches what is under it. A press that lands on the panel or on a covered
// rect, such as a top bar button, reaches them as before. area is read as each press lands:
// undefined while no panel is open, so the press is left alone. The first press outside decides
// the tap; another finger's press outside while it is down is kept from the scenes under too.
// Scenes take input top down, so the scene calling this must sit above the scenes it covers.
export function catchOutsideTaps(
  tapMaxDistance: number,
  scene: Pick<Scene, "input">,
  area: () => OutsideArea | undefined,
  onDismiss: () => void,
): void {
  const input: SceneInput = scene.input;
  let tap: { readonly area: OutsideArea; readonly id: number; press: OutsidePress } | undefined;
  const caught = new Set<number>();
  input.on("pointerdown", (pointer: Input.Pointer) => {
    // A pointer going down has lifted, whether or not this scene heard it lift.
    caught.delete(pointer.id);
    if (tap?.id === pointer.id) {
      tap = undefined;
    }
    const open = area();
    const press = open === undefined ? undefined : outsidePressDown(open, pointer);
    if (open === undefined || press === undefined) {
      return;
    }
    caught.add(pointer.id);
    tap ??= { area: open, id: pointer.id, press };
    input.stopPropagation();
  });
  input.on("pointermove", (pointer: Input.Pointer) => {
    if (!caught.has(pointer.id)) {
      return;
    }
    if (tap?.id === pointer.id) {
      tap.press = outsidePressMove(tapMaxDistance, pointer, tap.press);
    }
    input.stopPropagation();
  });
  const up = (pointer: Input.Pointer) => {
    if (!caught.delete(pointer.id)) {
      return;
    }
    input.stopPropagation();
    if (tap?.id !== pointer.id) {
      return;
    }
    const tapped = outsideTapped(tap.area, tapMaxDistance, pointer.wasCanceled, tap.press, pointer);
    tap = undefined;
    if (tapped) {
      onDismiss();
    }
  };
  input.on("pointerup", up);
  input.on("pointerupoutside", up);
}
