// Encodes one update group exactly as precachePlugin's updateGroup output does, so a game can test
// its group archive readers, such as an origin's createGroupArchiveMemberReader, against real
// archives.
import type { BuildArchiveFile } from "../../web/pwa/archive/index.ts";
import {
  BUILD_ARCHIVE_PART_BYTES,
  type BuildGroupReference,
  buildGroupUrl,
  GROUP_ARCHIVE_IDENTITY,
} from "../../web/pwa/index.ts";
import { archiveFiles, deterministicGzip } from "./buildArchiveFiles.ts";

export interface GroupArchiveMember {
  // The member's canonical request URL, whose extension selects its archived media type.
  readonly url: string;
  readonly bytes: Uint8Array;
}

export interface EncodedGroupArchive {
  // The pointer's entry for this group.
  readonly group: BuildGroupReference;
  // The URL the encoded bytes are served at, buildGroupUrl(group).
  readonly path: string;
  // The transport: the archive in one deterministic gzip member.
  readonly encoded: Uint8Array;
  // The decoded archive that devices verify against group.sha256 and store.
  readonly archive: Uint8Array;
  // The archive index entries in member order: [url, byteSize, contentType].
  readonly files: readonly BuildArchiveFile[];
}

const GROUP_ID = { buildId: GROUP_ARCHIVE_IDENTITY, version: GROUP_ARCHIVE_IDENTITY };

// Members are archived in URL order. soundFormat tags a group of one format's sound alternatives.
// Throws when a URL repeats, its media type is unknown, or either byte size exceeds
// BUILD_ARCHIVE_PART_BYTES.
export function encodeGroupArchive(
  context: { readonly soundFormat?: string },
  members: readonly GroupArchiveMember[],
): EncodedGroupArchive {
  const { soundFormat } = context;
  if (soundFormat === "") {
    throw new RangeError("A group sound format must not be empty");
  }
  const listed = new Map<string, Uint8Array>();
  for (const { bytes, url } of members) {
    if (listed.has(url)) {
      throw new TypeError(`Duplicate group archive member ${url}`);
    }
    listed.set(url, bytes);
  }
  const { archive, files, parts } = archiveFiles(
    GROUP_ID,
    listed,
    [...listed.keys()].sort(),
    BUILD_ARCHIVE_PART_BYTES,
  );
  const decoded = parts[0]!;
  const encoded = deterministicGzip(decoded);
  if (encoded.byteLength > BUILD_ARCHIVE_PART_BYTES) {
    throw new RangeError(
      `compressed archive exceeds ${BUILD_ARCHIVE_PART_BYTES} bytes. Split the group`,
    );
  }
  const group: BuildGroupReference = {
    ...archive,
    encodedByteSize: encoded.byteLength,
    encoding: "gzip",
    ...(soundFormat === undefined ? {} : { soundFormat }),
  };
  return { archive: decoded, encoded, files, group, path: buildGroupUrl(group) };
}
