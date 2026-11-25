// V1 consists of the ASCII magic, a uint32 little-endian JSON byte length, the compact
// UTF-8 index, and uncompressed bodies in index order. The caller verifies the archive digest.
const MAGIC = new TextEncoder().encode("GKBLD001");
export const BUILD_ARCHIVE_HEADER_BYTES = 12;
export const MAX_BUILD_ARCHIVE_INDEX_BYTES = 4 * 1024 * 1024;

export interface BuildArchiveIdentity {
  readonly version: string;
  readonly buildId: string;
}

export type BuildArchiveFile = readonly [url: string, byteSize: number, contentType: string];

export interface BuildArchiveIndexInput extends BuildArchiveIdentity {
  readonly files: readonly BuildArchiveFile[];
}

export interface BuildArchiveEntry {
  readonly url: string;
  readonly byteSize: number;
  readonly contentType: string;
  // Absolute byte offset from the start of the archive. The end is offset + byteSize.
  readonly offset: number;
}

export interface BuildArchiveIndex extends BuildArchiveIdentity {
  readonly schema: 1;
  readonly payloadOffset: number;
  readonly files: readonly BuildArchiveEntry[];
}

const IDENTITY = /^[A-Za-z0-9._-]+$/;
// A concrete type/subtype and optional token-valued parameters, with no quoted values.
const MEDIA_TYPE =
  /^[\w!#$%&'+.^`|~-]+\/[\w!#$%&'+.^`|~-]+(?:; ?[\w!#$%&'+.^`|~-]+=[\w!#$%&'+.^`|~-]+)*$/;

function isIdentity(value: unknown): value is string {
  return typeof value === "string" && value.trim() === value && IDENTITY.test(value);
}

function isPath(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith("/") || value.includes("//")) {
    return false;
  }
  try {
    const decoded = decodeURIComponent(value);
    return (
      !/[\\%?#\p{Cc}]/u.test(decoded) &&
      encodeURI(decoded) === value &&
      new URL(value, "https://archive.invalid").pathname === value
    );
  } catch {
    return false;
  }
}

function indexJson({ buildId, files, version }: BuildArchiveIndexInput): string {
  // eslint-disable-next-line sort-keys -- The field order is part of the wire format.
  return JSON.stringify({ schema: 1, version, buildId, files });
}

function visitFiles(
  archiveBytes: number,
  payloadOffset: number,
  files: unknown,
  visit?: (entry: BuildArchiveEntry) => void,
): number {
  if (!Array.isArray(files)) {
    throw new TypeError("Build archive files must be an array");
  }
  const urls = new Set<string>();
  let offset = payloadOffset;
  for (const file of files) {
    if (!Array.isArray(file) || file.length !== 3) {
      throw new TypeError("Invalid build archive file tuple");
    }
    const [url, byteSize, contentType]: unknown[] = file;
    if (!isPath(url) || urls.has(url)) {
      throw new TypeError("Invalid or duplicate build archive path");
    }
    if (
      typeof byteSize !== "number" ||
      !Number.isSafeInteger(byteSize) ||
      byteSize < 0 ||
      byteSize > archiveBytes - offset
    ) {
      throw new RangeError("Invalid build archive file size");
    }
    if (
      typeof contentType !== "string" ||
      contentType.trim() !== contentType ||
      !MEDIA_TYPE.test(contentType)
    ) {
      throw new TypeError("Invalid build archive media type");
    }
    urls.add(url);
    visit?.({ byteSize, contentType, offset, url });
    offset += byteSize;
  }
  return offset;
}

// Append the bodies in the supplied file order. The encoder writes the prefix only.
export function encodeBuildArchiveIndex(input: BuildArchiveIndexInput): Uint8Array<ArrayBuffer> {
  if (!isIdentity(input.version) || !isIdentity(input.buildId)) {
    throw new TypeError("Invalid build archive identity");
  }
  const payloadBytes = visitFiles(Number.MAX_SAFE_INTEGER, 0, input.files);
  // All validated fields use ASCII, so the JSON's character and UTF-8 byte lengths agree.
  const index = indexJson(input);
  const prefixBytes = BUILD_ARCHIVE_HEADER_BYTES + index.length;
  if (
    index.length > MAX_BUILD_ARCHIVE_INDEX_BYTES ||
    payloadBytes > Number.MAX_SAFE_INTEGER - prefixBytes
  ) {
    throw new RangeError("Build archive index or archive is too large");
  }
  const prefix = new Uint8Array(prefixBytes);
  const encoded = new TextEncoder().encodeInto(index, prefix.subarray(BUILD_ARCHIVE_HEADER_BYTES));
  if (encoded.read !== index.length || encoded.written !== index.length) {
    throw new TypeError("Invalid build archive index encoding");
  }
  prefix.set(MAGIC);
  new DataView(prefix.buffer).setUint32(MAGIC.byteLength, index.length, true);
  return prefix;
}

// Read the first 12 bytes to size the second slice. archiveBytes is the actual full byte length.
export function readBuildArchivePrefixSize(archiveBytes: number, header: Uint8Array): number {
  if (
    !Number.isSafeInteger(archiveBytes) ||
    archiveBytes < BUILD_ARCHIVE_HEADER_BYTES ||
    header.byteLength < BUILD_ARCHIVE_HEADER_BYTES ||
    !MAGIC.every((byte, index) => header[index] === byte)
  ) {
    throw new TypeError("Invalid build archive header");
  }
  const indexBytes = new DataView(
    header.buffer,
    header.byteOffset,
    BUILD_ARCHIVE_HEADER_BYTES,
  ).getUint32(MAGIC.byteLength, true);
  const prefixBytes = BUILD_ARCHIVE_HEADER_BYTES + indexBytes;
  if (
    indexBytes === 0 ||
    indexBytes > MAX_BUILD_ARCHIVE_INDEX_BYTES ||
    prefixBytes > archiveBytes
  ) {
    throw new RangeError("Invalid build archive index length");
  }
  return prefixBytes;
}

// Accepts just the bounded prefix, or a view that also includes payload bytes. No body is read.
export function parseBuildArchiveIndex(
  expected: BuildArchiveIdentity,
  archiveBytes: number,
  prefix: Uint8Array,
): BuildArchiveIndex {
  const payloadOffset = readBuildArchivePrefixSize(archiveBytes, prefix);
  if (prefix.byteLength < payloadOffset || prefix.byteLength > archiveBytes) {
    throw new RangeError("Invalid build archive prefix length");
  }
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
    prefix.subarray(BUILD_ARCHIVE_HEADER_BYTES, payloadOffset),
  );
  const value: unknown = JSON.parse(text);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Invalid build archive index");
  }
  const { buildId, files, schema, version } = value as Record<string, unknown>;
  if (schema !== 1 || !isIdentity(version) || !isIdentity(buildId)) {
    throw new TypeError("Invalid build archive schema or identity");
  }
  if (version !== expected.version || buildId !== expected.buildId) {
    throw new TypeError("Build archive identity does not match");
  }
  const entries: BuildArchiveEntry[] = [];
  if (
    visitFiles(archiveBytes, payloadOffset, files, (entry) => entries.push(entry)) !== archiveBytes
  ) {
    throw new RangeError("Build archive payload has trailing bytes");
  }
  // Require the encoder's JSON form. This rejects duplicate object keys that JSON.parse discards,
  // extra fields, and alternative encodings of the same logical index.
  if (indexJson({ buildId, files: files as readonly BuildArchiveFile[], version }) !== text) {
    throw new TypeError("Noncanonical build archive index");
  }
  return { buildId, files: entries, payloadOffset, schema: 1, version };
}
