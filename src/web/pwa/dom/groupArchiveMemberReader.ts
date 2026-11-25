// Serves members of a build's static group archives (precachePlugin's updateGroup output) at their
// original URLs, for an origin that does not host archive-only members as loose files. It is
// independent of service workers and update manifests: the host supplies archive storage.
import {
  BUILD_ARCHIVE_HEADER_BYTES,
  type BuildArchiveEntry,
  parseBuildArchiveIndex,
  readBuildArchivePrefixSize,
} from "../archive/index.ts";
import {
  type BuildGroupReference,
  buildGroupUrl,
  GROUP_ARCHIVE_IDENTITY,
  parseBuildPointer,
} from "../index.ts";
import { checkArchiveDigest, inflateGzip, readExactArchiveBytes } from "./verifiedArchiveBytes.ts";

interface GroupArchiveMemberReaderContext {
  // The body stored at a group's emitted path, buildGroupUrl(group), or undefined if absent. For a
  // gzip group this is the encoded transport, which the reader decodes.
  readonly readArchive: (path: string) => Promise<ReadableStream<Uint8Array> | undefined>;
}

export interface GroupArchiveMemberReader {
  read(path: string): Promise<Response | undefined>;
}

const GROUP_ID = { buildId: GROUP_ARCHIVE_IDENTITY, version: GROUP_ARCHIVE_IDENTITY };

interface VerifiedArchive {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly entries: ReadonlyMap<string, BuildArchiveEntry>;
  readonly sha256: string;
}

async function openArchive(
  { readArchive }: GroupArchiveMemberReaderContext,
  group: BuildGroupReference,
): Promise<ReadableStream<Uint8Array>> {
  const path = buildGroupUrl(group);
  const source = await readArchive(path);
  if (source === undefined) {
    throw new TypeError(`Missing build group archive ${path}`);
  }
  return source;
}

// The decoded archive, after checking the transport and archive sizes and the archive digest.
async function readVerifiedArchive(
  context: GroupArchiveMemberReaderContext,
  group: BuildGroupReference,
): Promise<Uint8Array<ArrayBuffer>> {
  const label = `Build group archive ${buildGroupUrl(group)}`;
  const source = await openArchive(context, group);
  const bytes = new Uint8Array(group.byteSize);
  if (group.encoding === "gzip") {
    const encoded = new Uint8Array(group.encodedByteSize!);
    await readExactArchiveBytes(source, encoded, label);
    await readExactArchiveBytes(inflateGzip(encoded), bytes, `Decoded ${label}`);
  } else {
    await readExactArchiveBytes(source, bytes, label);
  }
  await checkArchiveDigest(bytes, group.sha256, label);
  return bytes;
}

// The member paths of one group, from its index prefix alone. Serving rechecks the verified index.
async function memberPaths(
  context: GroupArchiveMemberReaderContext,
  group: BuildGroupReference,
): Promise<readonly string[]> {
  const source = await openArchive(context, group);
  const reader = (
    group.encoding === "gzip"
      ? (source as ReadableStream<Uint8Array<ArrayBuffer>>).pipeThrough(
          new DecompressionStream("gzip"),
        )
      : source
  ).getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let wanted = BUILD_ARCHIVE_HEADER_BYTES;
  const prefix = () => {
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  };
  try {
    while (received < wanted) {
      // The prefix is read in order and the rest of the archive is never requested.
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) {
        throw new RangeError("Build group archive ends inside its index");
      }
      chunks.push(value);
      received += value.byteLength;
      if (wanted === BUILD_ARCHIVE_HEADER_BYTES && received >= wanted) {
        wanted = readBuildArchivePrefixSize(group.byteSize, prefix());
      }
    }
    return parseBuildArchiveIndex(GROUP_ID, group.byteSize, prefix().subarray(0, wanted)).files.map(
      ({ url }) => url,
    );
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Reads verified members of a build's group archives. Only unknown paths return undefined. */
export function createGroupArchiveMemberReader(
  context: GroupArchiveMemberReaderContext,
  pointer: unknown,
): GroupArchiveMemberReader {
  const { groups } = parseBuildPointer(pointer);
  if (groups === undefined) {
    throw new TypeError("Build pointer has no groups");
  }
  // Built once per instance from the index prefixes, one archive at a time. A failure is retried.
  let located: Promise<ReadonlyMap<string, BuildGroupReference>> | undefined;
  const locate = () => {
    located ??= (async () => {
      const byPath = new Map<string, BuildGroupReference>();
      for (const group of groups) {
        // eslint-disable-next-line no-await-in-loop
        for (const path of await memberPaths(context, group)) {
          if (byPath.has(path)) {
            throw new TypeError(`Duplicate build group member ${path}`);
          }
          byPath.set(path, group);
        }
      }
      return byPath;
    })().catch((error: unknown) => {
      located = undefined;
      throw error;
    });
    return located;
  };

  // Serialize verification and retain at most one verified archive for this instance.
  let queue = Promise.resolve();
  let cached: VerifiedArchive | undefined;
  const verifiedArchive = async (group: BuildGroupReference): Promise<VerifiedArchive> => {
    if (cached?.sha256 === group.sha256) {
      return cached;
    }
    cached = undefined;
    const bytes = await readVerifiedArchive(context, group);
    const { files } = parseBuildArchiveIndex(GROUP_ID, bytes.byteLength, bytes);
    const entries = new Map(files.map((entry) => [entry.url, entry]));
    const archive = { bytes, entries, sha256: group.sha256 };
    // Only the current job in the serialized read queue can update the cache.
    // eslint-disable-next-line require-atomic-updates
    cached = archive;
    return archive;
  };

  return {
    async read(path) {
      const group = (await locate()).get(path);
      if (group === undefined) {
        return undefined;
      }
      const answer = queue.then(async () => {
        const { bytes, entries } = await verifiedArchive(group);
        const entry = entries.get(path);
        if (entry === undefined) {
          throw new TypeError(`Build group archive does not hold ${path}`);
        }
        const { byteSize, contentType, offset } = entry;
        return new Response(bytes.subarray(offset, offset + byteSize), {
          headers: {
            "content-length": String(byteSize),
            "content-type": contentType,
            "x-content-type-options": "nosniff",
          },
        });
      });
      queue = answer.then(
        () => undefined,
        () => undefined,
      );
      return answer;
    },
  };
}
