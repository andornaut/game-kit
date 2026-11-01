import type { GameObjects, Scene } from "phaser";

import type { Rect } from "../../rect.ts";
import { snapshotRemapped } from "./snapshotRemap.ts";

export interface ModalBackdropContext {
  readonly depth: number;
  // An opaque palette colour used only when canvas readback is unavailable.
  readonly fallbackColour: number;
  readonly remap: (colour: number) => number;
  readonly scene: Scene;
}

let nextTexture = 0;

// Keep modal visuals hidden or excluded from the next rendered snapshot until ready settles.
// The game owns cameras and palette policy. An already-dimmed source can use an identity remap.
// ready is true for a captured image, false for the fallback or a disposed handle. Each handle
// owns a unique texture and its display object; destroy also guards asynchronous late capture.
export function mountModalBackdrop(
  context: ModalBackdropContext,
  area: Rect,
): { destroy(): void; ready: Promise<boolean> } {
  const { depth, fallbackColour, remap, scene } = context;
  const key = `__kit-modal-backdrop-${nextTexture++}`;
  let disposed = false;
  let object: Pick<GameObjects.GameObject, "destroy"> | undefined;
  const removeTexture = () => {
    if (scene.textures.exists(key)) {
      scene.textures.remove(key);
    }
  };
  const destroy = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    scene.events.off("shutdown", destroy);
    object?.destroy();
    removeTexture();
  };
  scene.events.once("shutdown", destroy);
  const ready = snapshotRemapped(remap, scene, area, key).then(
    (captured) => {
      if (disposed) {
        removeTexture();
        return false;
      }
      const image = captured
        ? scene.add.image(area.x, area.y, key)
        : scene.add.rectangle(area.x, area.y, area.width, area.height, fallbackColour);
      object = image.setOrigin(0).setScrollFactor(0).setDepth(depth);
      return captured;
    },
    () => {
      if (!disposed) {
        object = scene.add
          .rectangle(area.x, area.y, area.width, area.height, fallbackColour)
          .setOrigin(0)
          .setScrollFactor(0)
          .setDepth(depth);
      }
      removeTexture();
      return false;
    },
  );
  return { destroy, ready };
}
