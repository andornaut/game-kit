import { originMemberArchivePath, parseOriginMemberIndex } from "../originMemberIndex.ts";

interface OriginMemberReaderContext {
  readonly readArchive: (path: string) => Promise<ReadableStream<Uint8Array> | undefined>;
}

export interface OriginMemberReader {
  read(path: string): Promise<Response | undefined>;
}

// Bound the input supplied to each gzip transform, including for highly compressible bodies.
const INFLATE_CHUNK_BYTES = 4 * 1024;

function inflate(body: Uint8Array<ArrayBuffer>): ReadableStream<Uint8Array> {
  let offset = 0;
  const compressed = new ReadableStream<Uint8Array<ArrayBuffer>>({
    pull(controller) {
      const end = Math.min(offset + INFLATE_CHUNK_BYTES, body.byteLength);
      controller.enqueue(body.subarray(offset, end));
      offset = end;
      if (offset === body.byteLength) {
        controller.close();
      }
    },
  });
  return compressed.pipeThrough(new DecompressionStream("gzip"));
}

async function exactBytes(
  source: ReadableStream<Uint8Array>,
  size: number,
  label: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = new Uint8Array(size);
  const reader = source.getReader();
  let offset = 0;
  try {
    for (;;) {
      // The stream is consumed in order and stopped as soon as it exceeds its declared size.
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value.byteLength > size - offset) {
        throw new RangeError(`${label} exceeds its declared size`);
      }
      bytes.set(value, offset);
      offset += value.byteLength;
    }
  } catch (error) {
    void reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (offset !== size) {
    throw new RangeError(`${label} does not match its declared size`);
  }
  return bytes;
}

async function checkDigest(bytes: Uint8Array<ArrayBuffer>, expected: string, label: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (hex !== expected) {
    throw new TypeError(`${label} checksum mismatch`);
  }
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
    const encoded = await exactBytes(source, archive.byteSize, `Origin archive ${path}`);
    await checkDigest(encoded, sha256, `Origin archive ${path}`);
    const bytes = await exactBytes(
      inflate(encoded),
      archive.decodedByteSize,
      `Decoded origin archive ${path}`,
    );
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
        await checkDigest(body, member.sha256, `Origin member ${path}`);
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
