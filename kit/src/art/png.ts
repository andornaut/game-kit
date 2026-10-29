// PNG decoding for a game's build tools and tests, in Node, with pngjs. A game that imports this
// module installs pngjs 7.0.0 itself (its vendor/game-kit/ copy has no node_modules);
// kit/package.json names it as a peer dependency.
import { PNG } from "pngjs";

import type { RgbaImage } from "./rgbaImage";

// A PNG's pixels, whatever its colour type, as 8-bit RGBA.
export function decodePng(bytes: Uint8Array): RgbaImage {
  const { data, height, width } = PNG.sync.read(Buffer.from(bytes));
  return { data: new Uint8Array(data), height, width };
}
