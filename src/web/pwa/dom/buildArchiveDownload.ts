import {
  BUILD_ARCHIVE_PART_BYTES,
  buildArchivePartUrl,
  type BuildArchiveReference,
  type BuildGroupReference,
  buildGroupUrl,
} from "../buildContract.ts";
import type { BuildInstallContext } from "./buildInstaller.ts";
import { checkArchiveDigest, inflateGzip, readExactArchiveBytes } from "./verifiedArchiveBytes.ts";

interface ArchiveDownloadContext extends Pick<BuildInstallContext, "fetch" | "now" | "setTimeout"> {
  readonly beforePart?: (signal: AbortSignal) => Promise<void>;
  readonly clearTimeout: (handle: unknown) => void;
  readonly inactivityMs: number;
  readonly signal: AbortSignal;
  // Transport bytes received so far and the transport's total.
  readonly onBytes?: (received: number, total: number) => void;
}

// The bytes one transport sends, as parts of at most BUILD_ARCHIVE_PART_BYTES.
interface Transfer {
  readonly byteSize: number;
  readonly url: (index: number) => string;
}

/** Reads one complete archive. Transport parts are independent of file boundaries. */
export async function downloadBuildArchive(
  context: ArchiveDownloadContext,
  archive: BuildArchiveReference,
): Promise<Blob> {
  const body = await transfer(context, {
    byteSize: archive.byteSize,
    url: (index) => buildArchivePartUrl(archive, index),
  });
  const bytes = new Uint8Array(await body.arrayBuffer());
  context.signal.throwIfAborted();
  await checkArchiveDigest(bytes, archive.sha256, "Build archive");
  return body;
}

/** Reads one group's transport and returns its verified decoded archive. */
export async function downloadBuildGroup(
  context: ArchiveDownloadContext,
  group: BuildGroupReference,
): Promise<Blob> {
  if (group.encoding === undefined) {
    return downloadBuildArchive(context, group);
  }
  if (typeof DecompressionStream !== "function") {
    throw new TypeError("This browser cannot decode compressed build groups");
  }
  const url = buildGroupUrl(group);
  const encoded = await transfer(context, { byteSize: group.encodedByteSize!, url: () => url });
  // Decoding stops as soon as the output exceeds the archive size, so it cannot grow unbounded.
  const bytes = new Uint8Array(group.byteSize);
  await readExactArchiveBytes(
    inflateGzip(new Uint8Array(await encoded.arrayBuffer())),
    bytes,
    `Decoded build group ${url}`,
  );
  context.signal.throwIfAborted();
  await checkArchiveDigest(bytes, group.sha256, `Build group ${url}`);
  return new Blob([bytes]);
}

async function transfer(context: ArchiveDownloadContext, target: Transfer): Promise<Blob> {
  const { beforePart, clearTimeout, fetch, inactivityMs, now, onBytes, setTimeout, signal } =
    context;
  signal.throwIfAborted();
  if (!Number.isSafeInteger(inactivityMs) || inactivityMs <= 0) {
    throw new RangeError("Invalid build archive inactivity timeout");
  }
  const run = new AbortController();
  const abort = () => run.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  const stopped = new Promise<never>((_resolve, reject) => {
    run.signal.addEventListener("abort", () => reject(run.signal.reason), { once: true });
  });
  let last = now();
  let timer: unknown;
  const arm = (ms: number) => {
    timer = setTimeout(() => {
      const remaining = inactivityMs - (now() - last);
      if (remaining <= 0) {
        run.abort(new Error("Build archive download stopped progressing"));
      } else {
        arm(remaining);
      }
    }, ms);
  };
  try {
    return await readParts(
      {
        beginPart: async () => {
          clearTimeout(timer);
          if (beforePart !== undefined) {
            await Promise.race([beforePart(run.signal), stopped]);
          }
          run.signal.throwIfAborted();
          last = now();
          arm(inactivityMs);
        },
        fetch,
        onBytes,
        signal: run.signal,
        stopped,
        touch: () => {
          last = now();
        },
      },
      target,
    );
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}

async function readParts(
  context: Pick<ArchiveDownloadContext, "fetch" | "signal"> & {
    readonly beginPart: () => Promise<void>;
    readonly onBytes: ArchiveDownloadContext["onBytes"];
    readonly stopped: Promise<never>;
    readonly touch: () => void;
  },
  target: Transfer,
): Promise<Blob> {
  const { beginPart, fetch, onBytes, signal, stopped, touch } = context;
  const chunks: BlobPart[] = [];
  let received = 0;
  for (let index = 0; received < target.byteSize; index += 1) {
    // A background download waits for visibility between parts.
    // eslint-disable-next-line no-await-in-loop
    await beginPart();
    const end = Math.min(received + BUILD_ARCHIVE_PART_BYTES, target.byteSize);
    // Parts must be concatenated in their published order.
    // eslint-disable-next-line no-await-in-loop
    const response = await Promise.race([
      fetch(target.url(index), { cache: "no-store", redirect: "error", signal }),
      stopped,
    ]);
    touch();
    if (response.status !== 200 || response.redirected || response.body === null) {
      throw new TypeError("Build archive part unavailable");
    }
    const reader = response.body.getReader();
    try {
      for (;;) {
        // eslint-disable-next-line no-await-in-loop
        const { done, value } = await Promise.race([reader.read(), stopped]);
        signal.throwIfAborted();
        if (done) {
          break;
        }
        touch();
        received += value.byteLength;
        if (received > end) {
          throw new RangeError("Build archive part exceeds its expected size");
        }
        chunks.push(value);
        onBytes?.(received, target.byteSize);
      }
    } catch (error) {
      void reader.cancel(error).catch(() => undefined);
      throw error;
    } finally {
      reader.releaseLock();
    }
    if (received !== end) {
      throw new RangeError("Incomplete build archive part");
    }
  }
  return new Blob(chunks);
}
