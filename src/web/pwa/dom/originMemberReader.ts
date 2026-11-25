import { originMemberArchivePath, parseOriginMemberIndex } from "../originMemberIndex.ts";
import { checkArchiveDigest, inflateGzip, readExactArchiveBytes } from "./verifiedArchiveBytes.ts";

interface OriginMemberReaderContext {
  readonly readArchive: (path: string) => Promise<ReadableStream<Uint8Array> | undefined>;
}

export interface OriginMemberReader {
  read(path: string): Promise<Response | undefined>;
}

/** Reads immutable members from their owning origin's storage. Only absent members fall through. */
export function createOriginMemberReader(
  { readArchive }: OriginMemberReaderContext,
  index: unknown,
): OriginMemberReader {
  const { archives, members } = parseOriginMemberIndex(index);
  const archiveByDigest = new Map(archives.map((archive) => [archive.sha256, archive]));
  const memberByPath = new Map(members.map((member) => [member.path, member]));
  // Serialize verification and retain at most one decoded archive for this index instance.
  let queue = Promise.resolve();
  let cached: { bytes: Uint8Array<ArrayBuffer>; sha256: string } | undefined;

  const archiveBytes = async (sha256: string) => {
    if (cached?.sha256 === sha256) {
      return cached.bytes;
    }
    cached = undefined;
    const archive = archiveByDigest.get(sha256)!;
    const path = originMemberArchivePath(sha256);
    const source = await readArchive(path);
    if (source === undefined) {
      throw new TypeError(`Missing origin member archive ${path}`);
    }
    const encoded = new Uint8Array(archive.byteSize);
    await readExactArchiveBytes(source, encoded, `Origin archive ${path}`);
    await checkArchiveDigest(encoded, sha256, `Origin archive ${path}`);
    const bytes = new Uint8Array(archive.decodedByteSize);
    await readExactArchiveBytes(inflateGzip(encoded), bytes, `Decoded origin archive ${path}`);
    // Only the current job in the serialized read queue can update the cache.
    // eslint-disable-next-line require-atomic-updates
    cached = { bytes, sha256 };
    return bytes;
  };

  return {
    read(path) {
      const member = memberByPath.get(path);
      if (member === undefined) {
        return Promise.resolve(undefined);
      }
      const answer = queue.then(async () => {
        const bytes = await archiveBytes(member.archiveSha256);
        const body = bytes.subarray(member.offset, member.offset + member.byteSize);
        await checkArchiveDigest(body, member.sha256, `Origin member ${path}`);
        return new Response(body, {
          headers: {
            "content-length": String(member.byteSize),
            "content-type": member.contentType,
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
