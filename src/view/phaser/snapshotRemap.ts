import { Renderer, type Scene, type Textures } from "phaser";

import type { Rect } from "../../rect.ts";
import { remapRgb } from "../../rgba.ts";

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
  const { renderer } = scene.game;
  return "gl" in renderer
    ? readWebGl(remap, scene, renderer, area, textureKey)
    : readSnapshot(remap, scene, area, textureKey);
}

function freshCanvas(
  scene: Scene,
  textureKey: string,
  width: number,
  height: number,
): Textures.CanvasTexture | null {
  if (scene.textures.exists(textureKey)) {
    scene.textures.remove(textureKey);
  }
  return scene.textures.createCanvas(textureKey, width, height);
}

// Reads the drawing buffer at the post-render point where Phaser takes its own snapshots, with
// the same geometry, row order and un-premultiplication, and skips its PNG encode and decode.
function readWebGl(
  remap: (colour: number) => number,
  scene: Scene,
  renderer: Renderer.WebGL.WebGLRenderer,
  area: Rect,
  textureKey: string,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    renderer.once(Renderer.Events.POST_RENDER, () => {
      try {
        const x = Math.abs(Math.round(area.x));
        const y = Math.abs(Math.round(area.y));
        const width = Math.floor(area.width);
        const height = Math.floor(area.height);
        if (width <= 0 || height <= 0) {
          resolve(false);
          return;
        }
        const texture = freshCanvas(scene, textureKey, area.width, area.height);
        if (texture === null) {
          resolve(false);
          return;
        }
        const image = texture.getContext().createImageData(width, height);
        const { data } = image;
        const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        const { gl } = renderer;
        const bottom = gl.drawingBufferHeight - y - height;
        gl.readPixels(x, bottom, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
        flipRows(width * 4, bytes);
        if (scene.game.config.premultipliedAlpha) {
          unpremultiply(data);
        }
        remapRgb(remap, data);
        texture.putData(image, 0, 0);
        texture.refresh();
        resolve(true);
      } catch (error) {
        reject(error);
      }
    });
  });
}

// WebGL reads rows bottom first; reverses them in place so the top row comes first.
function flipRows(stride: number, bytes: Uint8Array): void {
  const row = new Uint8Array(stride);
  for (let top = 0, bottom = bytes.length - stride; top < bottom; top += stride, bottom -= stride) {
    row.set(bytes.subarray(top, top + stride));
    bytes.copyWithin(top, bottom, bottom + stride);
    bytes.set(row, bottom);
  }
}

// Phaser's arithmetic (WebGLSnapshot): each channel times 255 / alpha, floored and clamped to
// 255 by the array; a transparent pixel keeps its channels.
function unpremultiply(pixels: Uint8ClampedArray): void {
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const alpha = pixels[i + 3] ?? 0;
    if (alpha !== 0 && alpha !== 255) {
      const ratio = 255 / alpha;
      pixels[i] = Math.floor((pixels[i] ?? 0) * ratio);
      pixels[i + 1] = Math.floor((pixels[i + 1] ?? 0) * ratio);
      pixels[i + 2] = Math.floor((pixels[i + 2] ?? 0) * ratio);
    }
  }
}

// The Canvas renderer's snapshot, drawn into the texture and remapped there.
function readSnapshot(
  remap: (colour: number) => number,
  scene: Scene,
  area: Rect,
  textureKey: string,
): Promise<boolean> {
  const { height, width, x, y } = area;
  return new Promise((resolve, reject) => {
    scene.game.renderer.snapshotArea(x, y, width, height, (snapshot) => {
      try {
        if (typeof HTMLImageElement === "undefined" || !(snapshot instanceof HTMLImageElement)) {
          resolve(false);
          return;
        }
        const texture = freshCanvas(scene, textureKey, width, height);
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
      } catch (error) {
        reject(error);
      }
    });
  });
}
