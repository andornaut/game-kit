// Archive layout and deterministic gzip shared by precachePlugin's whole-build and group output
// and the public group archive encoder (groupArchive).
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

import {
  type BuildArchiveFile,
  type BuildArchiveIdentity,
  encodeBuildArchiveIndex,
} from "../archive/buildArchive.ts";
import { BUILD_ARCHIVE_PART_BYTES, type BuildArchiveReference } from "../buildContract.ts";
import { packContentType, soundFormatOf } from "../buildRecords.ts";

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// One gzip member at level 9 with a zero timestamp and the portable "unknown" OS byte, so the same
// input and zlib always yield the same bytes.
export function deterministicGzip(bytes: Uint8Array): Buffer {
  const source = gzipSync(bytes, { level: 9 });
  source[9] = 255;
  return source;
}

const ARCHIVE_CONTENT_TYPES = new Map([
  ["bin", "application/octet-stream"],
  ["css", "text/css; charset=utf-8"],
  ["fnt", "text/xml; charset=utf-8"],
  ["gif", "image/gif"],
  ["htm", "text/html; charset=utf-8"],
  ["html", "text/html; charset=utf-8"],
  ["ico", "image/vnd.microsoft.icon"],
  ["js", "text/javascript; charset=utf-8"],
  ["mjs", "text/javascript; charset=utf-8"],
  ["otf", "font/otf"],
  ["ttf", "font/ttf"],
  ["txt", "text/plain; charset=utf-8"],
  ["wasm", "application/wasm"],
  ["webmanifest", "application/manifest+json"],
  ["woff", "font/woff"],
  ["woff2", "font/woff2"],
]);

function archiveContentType(url: string): string {
  // Cache keys ending in / are the canonical URLs for index.html files.
  const path = url.toLowerCase();
  const extension = path.endsWith("/") ? "html" : soundFormatOf(path);
  const contentType = ARCHIVE_CONTENT_TYPES.get(extension ?? "") ?? packContentType(path);
  if (contentType === undefined) {
    throw new TypeError(`Unknown build archive content type for ${url}`);
  }
  return contentType;
}

export function archiveFiles(
  identity: BuildArchiveIdentity,
  listed: ReadonlyMap<string, Uint8Array>,
  urls: readonly string[],
  maxBytes?: number,
): { archive: BuildArchiveReference; files: readonly BuildArchiveFile[]; parts: Uint8Array[] } {
  const files = urls.map((url): BuildArchiveFile => [
    url,
    listed.get(url)!.byteLength,
    archiveContentType(url),
  ]);
  const prefix = encodeBuildArchiveIndex({
    ...identity,
    files,
  });
  const bodies = urls.map((url) => listed.get(url)!);
  const byteSize = bodies.reduce((size, bytes) => size + bytes.byteLength, prefix.byteLength);
  if (maxBytes !== undefined && byteSize > maxBytes) {
    throw new RangeError(`archive exceeds ${maxBytes} bytes including its index. Split the group`);
  }
  const hash = createHash("sha256");
  const parts: Uint8Array[] = [];
  let offset = 0;
  for (const bytes of [prefix, ...bodies]) {
    hash.update(bytes);
    for (let start = 0; start < bytes.byteLength;) {
      const index = Math.floor(offset / BUILD_ARCHIVE_PART_BYTES);
      const partOffset = offset % BUILD_ARCHIVE_PART_BYTES;
      let part = parts[index];
      if (part === undefined) {
        part = new Uint8Array(Math.min(BUILD_ARCHIVE_PART_BYTES, byteSize - offset));
        parts.push(part);
      }
      const length = Math.min(bytes.byteLength - start, part.byteLength - partOffset);
      part.set(bytes.subarray(start, start + length), partOffset);
      start += length;
      offset += length;
    }
  }
  return { archive: { byteSize, schema: 1, sha256: hash.digest("hex") }, files, parts };
}
