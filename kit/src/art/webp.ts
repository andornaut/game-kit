// Lossless WebP encoding and decoding for a game's build tools, in Node. libwebp built to
// WebAssembly (@jsquash/webp, pinned at 1.5.0), so a build needs no native binary: the build
// without SIMD, so every host writes the same bytes. A game that imports this module installs
// @jsquash/webp 1.5.0 itself (its vendor/game-kit/ copy has no node_modules); kit/package.json
// names it as a peer dependency. Each module loads once, on first use.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import decoderFactory, {
  type WebPModule as WebPDecoder,
} from "@jsquash/webp/codec/dec/webp_dec.js";
import encoderFactory, {
  type WebPModule as WebPEncoder,
} from "@jsquash/webp/codec/enc/webp_enc.js";
import { defaultOptions } from "@jsquash/webp/meta.js";
import { initEmscriptenModule } from "@jsquash/webp/utils.js";

import type { RgbaImage } from "./rgbaImage";

export type { RgbaImage };

const require = createRequire(import.meta.url);

async function wasmModule(path: string): Promise<WebAssembly.Module> {
  return WebAssembly.compile(await readFile(require.resolve(`@jsquash/webp/codec/${path}`)));
}

let encoder: Promise<WebPEncoder> | undefined;
let decoder: Promise<WebPDecoder> | undefined;

// Lossless with every pixel's colour kept, under clear alpha too, so the file decodes to the
// exact RGBA it was given. Method 6 searches hardest; quality 95 rather than 100 encodes a
// game's atlas pages in about a second rather than about 40, for about 0.5% more bytes.
const LOSSLESS = { ...defaultOptions, exact: 1, lossless: 1, method: 6, quality: 95 };

// The image as a lossless WebP.
export async function encodeLosslessWebp({ data, height, width }: RgbaImage): Promise<Uint8Array> {
  encoder ??= wasmModule("enc/webp_enc.wasm").then((wasm) =>
    initEmscriptenModule(encoderFactory, wasm),
  );
  const bytes = (await encoder).encode(new Uint8Array(data), width, height, LOSSLESS);
  if (bytes === null) {
    throw new Error(`libwebp could not encode a ${width}x${height} image`);
  }
  return new Uint8Array(bytes);
}

// A WebP's pixels.
export async function decodeWebp(bytes: Uint8Array): Promise<RgbaImage> {
  decoder ??= wasmModule("dec/webp_dec.wasm").then((wasm) =>
    initEmscriptenModule(decoderFactory, wasm),
  );
  const image = (await decoder).decode(new Uint8Array(bytes));
  if (image === null) {
    throw new Error("libwebp could not decode the file");
  }
  const { data, height, width } = image;
  return { data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), height, width };
}

// Whether two images have the same size and the same bytes.
export function sameRgba(a: RgbaImage, b: RgbaImage): boolean {
  // Buffer.compare keeps a page-sized compare cheap; a byte-by-byte loop does not.
  return a.width === b.width && a.height === b.height && Buffer.compare(a.data, b.data) === 0;
}

// Whether a WebP decodes to exactly expected's pixels, for a test that a page shipped as WebP
// shows what its source holds.
export async function webpDecodesTo(expected: RgbaImage, bytes: Uint8Array): Promise<boolean> {
  return sameRgba(await decodeWebp(bytes), expected);
}
