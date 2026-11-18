// Downloads one build into its cache under a pinned manifest (docs/install-and-update.md). Each
// missing file is copied by digest from another build when one holds it, or fetched, streamed,
// checked against the manifest's exact byte size and full SHA-256, and stored with its digest
// header. Only missing files are fetched, so a fresh call resumes an interrupted install. The
// caller writes active or staged only after "complete".
import { BUILD_HASH_HEADER, type BuildFile, type BuildManifest } from "../buildContract.ts";
import { verifiedJsonFamilies } from "../buildRecords.ts";
import type { VerifiedJsonBody } from "../verifiedJsonBody.ts";
import type { BuildStore } from "./buildStore.ts";
import { isJsonContentType, safeJsonSource } from "./verifiedJsonSource.ts";

export type BuildInstallFailure = "network" | "quota" | "verification";

// "changed": a fetched body did not match the pinned manifest, as when the game redeploys during
// the install. The caller re-reads the build pointer and installs the manifest it names, reusing
// every verified entry; an unchanged pointer means the deploy serves bytes its manifest does not
// describe, which the caller reports as "verification".
export type BuildInstallResult = "changed" | "complete";

export class BuildInstallError extends Error {
  override readonly name = "BuildInstallError";
  readonly reason: BuildInstallFailure;
  readonly url: string | undefined;

  constructor(reason: BuildInstallFailure, message: string, url?: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.reason = reason;
    this.url = url;
  }
}

export interface BuildInstallContext {
  readonly store: BuildStore;
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  // navigator.storage, or undefined where the browser has none.
  readonly storage: Pick<StorageManager, "estimate" | "persist"> | undefined;
  // The page's origin, which a verified JSON response's URL must match.
  readonly origin: string;
  readonly now: () => number;
  readonly setTimeout: (handler: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: never) => void;
}

export interface BuildInstallOptions {
  readonly manifest: BuildManifest;
  // Files fetched at once.
  readonly lanes?: number;
  readonly priority?: RequestPriority;
  // Fetches per file before the install fails.
  readonly attempts?: number;
  // An attempt that receives no headers or bytes for this long is aborted and counts as failed.
  readonly inactivityMs?: number;
  readonly signal?: AbortSignal;
  // Bytes received out of the bytes this call fetches; reused entries are not counted.
  readonly onBytes?: (received: number, total: number) => void;
  // While it returns true, no new fetch attempt starts; attempts already running continue.
  readonly paused?: () => boolean;
}

// Foreground install defaults, under the loading screen.
export const FOREGROUND_INSTALL = {
  attempts: 3,
  inactivityMs: 30_000,
  lanes: 6,
  priority: "auto",
} as const satisfies Partial<BuildInstallOptions>;

// A background update: fewer lanes at low priority, so play keeps the link. The caller adds
// paused, true while the page is hidden.
export const BACKGROUND_INSTALL = {
  lanes: 2,
  priority: "low",
} as const satisfies Partial<BuildInstallOptions>;

// The waits before a file's second and later attempts; the last repeats.
const RETRY_DELAYS_MS = [1000, 3000] as const;

// How often a paused install checks paused() again.
const PAUSE_POLL_MS = 1000;

// A fetched body that does not match the pinned manifest.
class BodyChanged extends Error {}

const digestHex = (digest: ArrayBuffer) =>
  [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const isQuotaError = (error: unknown) =>
  error instanceof Error && error.name === "QuotaExceededError";

function positiveInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return value;
}

// Each verified JSON URL's family. Throws a BuildInstallError when the families do not describe
// the manifest's own files and digests.
function verifiedFamilies(manifest: BuildManifest): Map<string, VerifiedJsonBody> {
  try {
    return verifiedJsonFamilies(manifest);
  } catch (error) {
    throw new BuildInstallError("verification", "Invalid verified JSON families", undefined, error);
  }
}

// Installs options.manifest's missing files into its build cache. Resolves "complete" once every
// file is stored and verified, or "changed" (see BuildInstallResult). Rejects with a
// BuildInstallError once a file has failed every attempt, at once on a full quota, or with
// signal's reason when it aborts.
export async function installBuild(
  context: BuildInstallContext,
  options: BuildInstallOptions,
): Promise<BuildInstallResult> {
  const { fetch, now, origin, storage, store } = context;
  const { clearTimeout: cancel, setTimeout: schedule } = context;
  const { manifest, onBytes, paused, signal } = options;
  const lanes = positiveInteger("lanes", options.lanes ?? FOREGROUND_INSTALL.lanes);
  const attempts = positiveInteger("attempts", options.attempts ?? FOREGROUND_INSTALL.attempts);
  const inactivityMs = positiveInteger(
    "inactivityMs",
    options.inactivityMs ?? FOREGROUND_INSTALL.inactivityMs,
  );
  const priority = options.priority ?? FOREGROUND_INSTALL.priority;
  signal?.throwIfAborted();
  const families = verifiedFamilies(manifest);

  // One controller ends every lane: the caller's abort, a terminal failure or a changed body.
  const run = new AbortController();
  const onAbort = () => run.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });

  const delay = (ms: number) =>
    new Promise<void>((resolve, reject) => {
      const stop = () => {
        cancel(timer as never);
        reject(run.signal.reason);
      };
      const timer = schedule(() => {
        run.signal.removeEventListener("abort", stop);
        resolve();
      }, ms);
      if (run.signal.aborted) {
        stop();
      } else {
        run.signal.addEventListener("abort", stop, { once: true });
      }
    });

  try {
    await store.saveManifest(manifest);
    const absent = await store.missing(manifest);
    await checkStorage(
      storage,
      absent.reduce((sum, file) => sum + file.byteSize, 0),
    );
    run.signal.throwIfAborted();

    // Copy entries other builds hold by digest. Stored entries passed verification when stored,
    // so the copy keeps their header and is not hashed again.
    const toFetch: BuildFile[] = [];
    for (const file of absent) {
      // Copies run in turn; each is a cache read and write with no network.
      // eslint-disable-next-line no-await-in-loop
      const copy = await store.findByHash(file.sha256);
      run.signal.throwIfAborted();
      if (
        copy === undefined ||
        (families.has(file.url) && !isJsonContentType(copy.headers.get("content-type")))
      ) {
        toFetch.push(file);
        continue;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        await store.putFile(manifest.version, file.url, copy);
      } catch (error) {
        if (isQuotaError(error)) {
          throw new BuildInstallError("quota", "Storage is full", file.url, error);
        }
        toFetch.push(file);
      }
    }

    const total = toFetch.reduce((sum, file) => sum + file.byteSize, 0);
    let received = 0;
    onBytes?.(received, total);
    const count = (bytes: number) => {
      received += bytes;
      onBytes?.(received, total);
    };

    const fetchOnce = async (file: BuildFile): Promise<void> => {
      const attempt = new AbortController();
      const end = () => attempt.abort(run.signal.reason);
      run.signal.addEventListener("abort", end, { once: true });
      let last = now();
      const touch = () => {
        last = now();
      };
      let timer: unknown;
      const arm = (ms: number) => {
        timer = schedule(() => {
          const idle = now() - last;
          if (idle >= inactivityMs) {
            attempt.abort(new Error(`No progress within ${inactivityMs} ms for ${file.url}`));
          } else {
            arm(inactivityMs - idle);
          }
        }, ms);
      };
      arm(inactivityMs);
      const aborted = new Promise<never>((_resolve, reject) => {
        const fail = () => reject(attempt.signal.reason);
        if (attempt.signal.aborted) {
          fail();
        }
        attempt.signal.addEventListener("abort", fail, { once: true });
      });
      aborted.catch(() => undefined);
      let partial = 0;
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        const family = families.get(file.url);
        const response = await Promise.race([
          fetch(file.url, {
            cache: "no-store",
            credentials: family === undefined ? "same-origin" : "omit",
            priority,
            redirect: "error",
            signal: attempt.signal,
          }),
          aborted,
        ]);
        touch();
        if (response.status !== 200) {
          throw new Error(`HTTP ${response.status} for ${file.url}`);
        }
        if (family !== undefined && !safeJsonSource(origin, family, file.url, response)) {
          throw new BuildInstallError(
            "verification",
            `Unsafe verified JSON response semantics for ${file.url}`,
            file.url,
          );
        }
        const streaming = response.body?.getReader();
        reader = streaming;
        const chunks: Uint8Array[] = [];
        if (streaming !== undefined) {
          while (true) {
            // A response stream is read in order.
            // eslint-disable-next-line no-await-in-loop
            const chunk = await Promise.race([streaming.read(), aborted]);
            if (chunk.done) {
              break;
            }
            touch();
            partial += chunk.value.byteLength;
            count(chunk.value.byteLength);
            if (partial > file.byteSize) {
              throw new BodyChanged(`Body of ${file.url} exceeds its manifest size`);
            }
            chunks.push(chunk.value);
          }
        }
        if (partial !== file.byteSize) {
          throw new BodyChanged(`Body of ${file.url} does not match its manifest size`);
        }
        const body = new Uint8Array(partial);
        let offset = 0;
        for (const chunk of chunks) {
          body.set(chunk, offset);
          offset += chunk.byteLength;
        }
        const digest = digestHex(await crypto.subtle.digest("SHA-256", body));
        if (digest !== file.sha256) {
          throw new BodyChanged(`Body of ${file.url} does not match its manifest digest`);
        }
        const contentType = response.headers.get("content-type");
        const headers: Record<string, string> = { [BUILD_HASH_HEADER]: file.sha256 };
        if (contentType !== null) {
          headers["content-type"] = contentType;
        }
        await Promise.race([
          store.putFile(manifest.version, file.url, new Response(body, { headers })),
          aborted,
        ]);
        partial = 0;
      } catch (error) {
        if (partial > 0) {
          count(-partial);
        }
        throw error;
      } finally {
        cancel(timer as never);
        run.signal.removeEventListener("abort", end);
        if (!attempt.signal.aborted) {
          attempt.abort();
        }
        void reader?.cancel().catch(() => undefined);
      }
    };

    // Resolves true when the body changed. Throws a BuildInstallError once attempts run out.
    const fetchFile = async (file: BuildFile): Promise<boolean> => {
      let failure: BuildInstallError | undefined;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (attempt > 0) {
          const wait = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length) - 1] as number;
          // Attempts are sequential: each waits out the backoff after the one before.
          // eslint-disable-next-line no-await-in-loop
          await delay(wait);
        }
        while (paused?.() === true) {
          // eslint-disable-next-line no-await-in-loop
          await delay(PAUSE_POLL_MS);
        }
        try {
          // eslint-disable-next-line no-await-in-loop
          await fetchOnce(file);
          return false;
        } catch (error) {
          run.signal.throwIfAborted();
          if (error instanceof BodyChanged) {
            return true;
          }
          if (isQuotaError(error)) {
            throw new BuildInstallError("quota", "Storage is full", file.url, error);
          }
          failure =
            error instanceof BuildInstallError
              ? error
              : new BuildInstallError(
                  "network",
                  `Failed to fetch ${file.url}: ${error instanceof Error ? error.message : String(error)}`,
                  file.url,
                  error,
                );
        }
      }
      throw failure as BuildInstallError;
    };

    let changed = false;
    let failure: unknown;
    let next = 0;
    const lane = async () => {
      while (next < toFetch.length && !run.signal.aborted) {
        const file = toFetch[next] as BuildFile;
        next += 1;
        try {
          // Each lane takes the next file once its last one is done.
          // eslint-disable-next-line no-await-in-loop
          if (await fetchFile(file)) {
            changed = true;
            run.abort(new BodyChanged("Body changed"));
          }
        } catch (error) {
          if (!run.signal.aborted) {
            failure = error;
            run.abort(error);
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(lanes, toFetch.length) }, lane));
    signal?.throwIfAborted();
    if (failure !== undefined) {
      throw failure;
    }
    if (changed) {
      return "changed";
    }
    if (!(await store.complete(manifest))) {
      throw new BuildInstallError("quota", "Stored entries were evicted during the install");
    }
    return "complete";
  } finally {
    signal?.removeEventListener("abort", onAbort);
    run.abort();
  }
}

// Asks for persistent storage, then fails early when the estimate leaves less room than bytes.
async function checkStorage(storage: BuildInstallContext["storage"], bytes: number): Promise<void> {
  if (storage === undefined || bytes === 0) {
    return;
  }
  await storage.persist().catch(() => false);
  const estimate = await storage.estimate().catch(() => undefined);
  const { quota, usage } = estimate ?? {};
  if (quota !== undefined && usage !== undefined && quota - usage < bytes) {
    throw new BuildInstallError(
      "quota",
      `The build needs ${bytes} bytes and ${quota - usage} are available`,
    );
  }
}
