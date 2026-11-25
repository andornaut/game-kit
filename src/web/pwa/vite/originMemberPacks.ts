import {
  MAX_ORIGIN_MEMBER_ARCHIVE_BYTES,
  MAX_ORIGIN_MEMBER_ARCHIVES,
  MAX_ORIGIN_MEMBERS,
  type OriginMember,
  type OriginMemberArchive,
  originMemberArchivePath,
  type OriginMemberIndex,
  parseOriginMemberIndex,
} from "../originMemberIndex.ts";
import { deterministicGzip, sha256Hex } from "./buildArchiveFiles.ts";

export interface OriginMemberPackOptions {
  readonly groups: Readonly<Record<string, readonly string[]>>;
  // Alias paths are existing files with the same bytes and media type as a selected member.
  readonly aliases?: Readonly<Record<string, string>>;
}

export interface OriginMemberPackFile {
  readonly path: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
}

export interface OriginMemberPacks {
  readonly index: OriginMemberIndex;
  readonly archives: readonly { readonly path: string; readonly bytes: Uint8Array }[];
}

// Package selected members without modifying the inputs or writing build output.
export function buildOriginMemberPacks(
  options: OriginMemberPackOptions,
  files: readonly OriginMemberPackFile[],
): OriginMemberPacks {
  const groups = Object.entries(options.groups);
  if (groups.length > MAX_ORIGIN_MEMBER_ARCHIVES) {
    throw new RangeError(`Select at most ${MAX_ORIGIN_MEMBER_ARCHIVES} origin member pack groups`);
  }
  const byPath = new Map<string, OriginMemberPackFile>();
  for (const file of files) {
    if (byPath.has(file.path)) {
      throw new TypeError(`Duplicate origin input file ${file.path}`);
    }
    byPath.set(file.path, file);
  }

  const selected = new Set<string>();
  const groupFiles = groups.map(([id, paths]) => {
    if (paths.length === 0) {
      throw new TypeError(`Origin member group ${id} is empty`);
    }
    const entries = [...paths].sort().map((path) => {
      const file = byPath.get(path);
      if (file === undefined) {
        throw new TypeError(`Origin member group ${id} is missing input ${path}`);
      }
      if (selected.has(path)) {
        throw new TypeError(`Origin member ${path} is selected more than once`);
      }
      selected.add(path);
      return file;
    });
    return { entries, id };
  });
  const aliases = Object.entries(options.aliases ?? {});
  if (selected.size + aliases.length > MAX_ORIGIN_MEMBERS) {
    throw new RangeError(`Select at most ${MAX_ORIGIN_MEMBERS} origin members including aliases`);
  }
  for (const [alias, target] of aliases) {
    if (selected.has(alias) || !selected.has(target)) {
      throw new TypeError(`Alias ${alias} must be distinct and target a canonical group member`);
    }
    const file = byPath.get(alias);
    const canonical = byPath.get(target)!;
    if (file === undefined) {
      throw new TypeError(`Missing input for origin member alias ${alias}`);
    }
    if (
      file.contentType !== canonical.contentType ||
      Buffer.compare(file.bytes, canonical.bytes) !== 0
    ) {
      throw new TypeError(
        `Origin member alias ${alias} differs from ${target} in bytes or MIME type`,
      );
    }
  }

  const packed = new Map<string, { bytes: Uint8Array; reference: OriginMemberArchive }>();
  const members = new Map<string, OriginMember>();
  for (const { entries, id } of groupFiles) {
    const bodies = entries.map((file) => file.bytes);
    const decodedByteSize = bodies.reduce((size, body) => size + body.byteLength, 0);
    if (decodedByteSize > MAX_ORIGIN_MEMBER_ARCHIVE_BYTES) {
      throw new RangeError(
        `Decoded origin member group ${id} exceeds ${MAX_ORIGIN_MEMBER_ARCHIVE_BYTES} bytes. Split the group`,
      );
    }
    const bytes = deterministicGzip(Buffer.concat(bodies, decodedByteSize));
    const byteSize = bytes.byteLength;
    if (byteSize > MAX_ORIGIN_MEMBER_ARCHIVE_BYTES) {
      throw new RangeError(
        `Encoded origin member group ${id} exceeds ${MAX_ORIGIN_MEMBER_ARCHIVE_BYTES} bytes. Split the group`,
      );
    }
    const archiveSha256 = sha256Hex(bytes);
    packed.set(archiveSha256, {
      bytes,
      reference: { byteSize, decodedByteSize, sha256: archiveSha256 },
    });
    let offset = 0;
    for (const file of entries) {
      members.set(file.path, {
        archiveSha256,
        byteSize: file.bytes.byteLength,
        contentType: file.contentType,
        offset,
        path: file.path,
        sha256: sha256Hex(file.bytes),
      });
      offset += file.bytes.byteLength;
    }
  }
  for (const [path, target] of aliases) {
    members.set(path, { ...members.get(target)!, path });
  }

  const hashes = [...packed.keys()].sort();
  const index = parseOriginMemberIndex({
    archives: hashes.map((hash) => packed.get(hash)!.reference),
    members: [...members.keys()].sort().map((path) => members.get(path)!),
    schema: 1,
  });
  return {
    archives: hashes.map((hash) => ({
      bytes: packed.get(hash)!.bytes,
      path: originMemberArchivePath(hash),
    })),
    index,
  };
}
