import {
  BUILD_ARCHIVE_PART_BYTES,
  buildArchivePartUrl,
  type BuildArchiveReference,
} from "../buildContract.ts";
import type { BuildInstallContext } from "./buildInstaller.ts";

interface ArchiveDownloadContext extends Pick<BuildInstallContext, "fetch" | "now" | "setTimeout"> {
  readonly beforePart?: (signal: AbortSignal) => Promise<void>;
  readonly clearTimeout: (handle: unknown) => void;
  readonly inactivityMs: number;
  readonly signal: AbortSignal;
  readonly onBytes?: (received: number, total: number) => void;
}

/** Reads one complete archive. Transport parts are independent of file boundaries. */
export async function downloadBuildArchive(
  context: ArchiveDownloadContext,
  archive: BuildArchiveReference,
): Promise<Blob> {
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
  let body: Blob;
  try {
    body = await readArchive(
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
      archive,
    );
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", await body.arrayBuffer()));
  signal.throwIfAborted();
  if (
    Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("") !== archive.sha256
  ) {
    throw new TypeError("Build archive checksum mismatch");
  }
  return body;
}

async function readArchive(
  context: Pick<ArchiveDownloadContext, "fetch" | "signal"> & {
    readonly beginPart: () => Promise<void>;
    readonly onBytes: ArchiveDownloadContext["onBytes"];
    readonly stopped: Promise<never>;
    readonly touch: () => void;
  },
  archive: BuildArchiveReference,
): Promise<Blob> {
  const { beginPart, fetch, onBytes, signal, stopped, touch } = context;
  const chunks: BlobPart[] = [];
  let received = 0;
  for (let index = 0; received < archive.byteSize; index += 1) {
    // A background download waits for visibility between parts.
    // eslint-disable-next-line no-await-in-loop
    await beginPart();
    const target = Math.min(received + BUILD_ARCHIVE_PART_BYTES, archive.byteSize);
    // Parts must be concatenated in their published order.
    // eslint-disable-next-line no-await-in-loop
    const response = await Promise.race([
      fetch(buildArchivePartUrl(archive, index), { cache: "no-store", redirect: "error", signal }),
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
  return new Blob(chunks);
}
