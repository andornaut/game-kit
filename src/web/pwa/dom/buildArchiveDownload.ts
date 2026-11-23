import {
  BUILD_ARCHIVE_PART_BYTES,
  buildArchivePartUrl,
  type BuildArchiveReference,
} from "../buildContract.ts";

interface ArchiveDownloadContext {
  readonly fetch: typeof fetch;
  readonly signal: AbortSignal;
  readonly onBytes?: (received: number, total: number) => void;
}

/** Reads one complete archive. Transport parts are independent of file boundaries. */
export async function downloadBuildArchive(
  context: ArchiveDownloadContext,
  archive: BuildArchiveReference,
): Promise<Blob> {
  const { fetch, onBytes, signal } = context;
  const chunks: BlobPart[] = [];
  let received = 0;
  for (let index = 0; received < archive.byteSize; index += 1) {
    signal.throwIfAborted();
    const target = Math.min(received + BUILD_ARCHIVE_PART_BYTES, archive.byteSize);
    // Parts must be concatenated in their published order.
    // eslint-disable-next-line no-await-in-loop
    const response = await fetch(buildArchivePartUrl(archive, index), {
      cache: "no-store",
      redirect: "error",
      signal,
    });
    if (response.status !== 200 || response.redirected || response.body === null) {
      throw new TypeError("Build archive part unavailable");
    }
    const reader = response.body.getReader();
    try {
      for (;;) {
        // eslint-disable-next-line no-await-in-loop
        const { done, value } = await reader.read();
        signal.throwIfAborted();
        if (done) {
          break;
        }
        received += value.byteLength;
        if (received > target) {
          throw new RangeError("Build archive part exceeds its expected size");
        }
        chunks.push(value);
        onBytes?.(received, archive.byteSize);
      }
    } catch (error) {
      void reader.cancel(error).catch(() => undefined);
      throw error;
    } finally {
      reader.releaseLock();
    }
    if (received !== target) {
      throw new RangeError("Incomplete build archive part");
    }
  }
  const body = new Blob(chunks);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", await body.arrayBuffer()));
  signal.throwIfAborted();
  if (
    Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("") !== archive.sha256
  ) {
    throw new TypeError("Build archive checksum mismatch");
  }
  return body;
}
