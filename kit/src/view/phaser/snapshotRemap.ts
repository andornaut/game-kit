import type { Scene } from "phaser";

import type { Rect } from "../../rect";
import { remapRgb } from "../../rgba";

// Reads area of the game's canvas back from the next frame Phaser renders and draws it, each
// pixel's colour remapped (rampDown dims it down the palette's ramps), into a canvas texture
// textureKey, replacing any texture of that key. Resolves true once the texture holds it, or false
// where the renderer gives no image to read back or no canvas to draw into.
export function snapshotRemapped(
  remap: (colour: number) => number,
  scene: Scene,
  area: Rect,
  textureKey: string,
): Promise<boolean> {
  const { height, width, x, y } = area;
  return new Promise((resolve) => {
    scene.game.renderer.snapshotArea(x, y, width, height, (snapshot) => {
      if (typeof HTMLImageElement === "undefined" || !(snapshot instanceof HTMLImageElement)) {
        resolve(false);
        return;
      }
      if (scene.textures.exists(textureKey)) {
        scene.textures.remove(textureKey);
      }
      const texture = scene.textures.createCanvas(textureKey, width, height);
      const context = texture?.getContext();
      if (texture === null || context === undefined) {
        resolve(false);
        return;
      }
      context.drawImage(snapshot, 0, 0);
      const pixels = context.getImageData(0, 0, width, height);
      remapRgb(remap, pixels.data);
      context.putImageData(pixels, 0, 0);
      texture.refresh();
      resolve(true);
    });
  });
}
