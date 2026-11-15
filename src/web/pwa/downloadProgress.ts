export const DOWNLOAD_PROGRESS_MESSAGE = "game-kit-download-progress";

export type DownloadPhase = "checking" | "complete" | "downloading" | "failed" | "verifying";

// value drives a relative bar, without labels or byte counts. Undefined means indeterminate.
// Only complete reports 1; fully received bytes still need verification and durable writes.
export interface DownloadProgress {
  readonly operationId: string;
  readonly phase: DownloadPhase;
  readonly value: number | undefined;
  readonly version: string;
}

export function isDownloadProgress(value: unknown): value is DownloadProgress {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const progress = value as Partial<DownloadProgress>;
  return (
    typeof progress.operationId === "string" &&
    progress.operationId.length > 0 &&
    typeof progress.version === "string" &&
    progress.version.length > 0 &&
    (progress.phase === "checking" ||
      progress.phase === "complete" ||
      progress.phase === "downloading" ||
      progress.phase === "failed" ||
      progress.phase === "verifying") &&
    (progress.phase === "complete"
      ? progress.value === 1
      : progress.phase === "downloading"
        ? progress.value === undefined ||
          (Number.isFinite(progress.value) &&
            typeof progress.value === "number" &&
            progress.value >= 0 &&
            progress.value < 1)
        : progress.value === undefined)
  );
}

// Total for a selected operation, not every alternative sound format in the manifest.
export function downloadByteTotal(
  byteSizes: Readonly<Record<string, number>> | undefined,
  urls: readonly string[],
): number | undefined {
  if (byteSizes === undefined) {
    return undefined;
  }
  let total = 0;
  for (const url of new Set(urls)) {
    const size = byteSizes[url];
    if (size === undefined || !Number.isSafeInteger(size) || size < 0) {
      throw new RangeError(`Missing or invalid download byte size: ${url}`);
    }
    total += size;
    if (!Number.isSafeInteger(total)) {
      throw new RangeError("Download byte total exceeds the safe integer range");
    }
  }
  return total;
}

export interface DownloadProgressReports {
  readonly now: () => number;
  readonly operationId: string;
  readonly report: (snapshot: DownloadProgress) => void;
  readonly version: string;
}

// Each received count is cumulative for the current attempt; retries remove only that attempt.
// Context supplies the clock so accounting itself owns no timers or browser state.
export function createDownloadProgress(
  reports: DownloadProgressReports,
  byteSizes: Readonly<Record<string, number>> | undefined,
): {
  attempt(url: string): void;
  begin(urls: readonly string[]): void;
  complete(): void;
  fail(): void;
  received(url: string, bytes: number): void;
  retry(url: string): void;
  snapshot(): DownloadProgress;
  stored(url: string): void;
  verifying(): void;
} {
  let phase: DownloadPhase = "checking";
  let total: number | undefined;
  let selected = new Set<string>();
  const committed = new Set<string>();
  const attempts = new Map<string, number>();
  let lastReport = -Infinity;
  let lastPhase: DownloadPhase | undefined;
  const loaded = () =>
    [...committed].reduce((sum, url) => sum + (byteSizes?.[url] ?? 0), 0) +
    [...attempts.values()].reduce((sum, bytes) => sum + bytes, 0);
  const snapshot = (): DownloadProgress => ({
    operationId: reports.operationId,
    phase,
    value:
      phase === "complete"
        ? 1
        : phase === "downloading" && total !== undefined && total > 0
          ? loaded() / total
          : undefined,
    version: reports.version,
  });
  const emit = (force = false) => {
    const now = reports.now();
    // Chunk notifications are limited to ten per second; every phase boundary is immediate.
    if (force || phase !== lastPhase || now - lastReport >= 100) {
      lastReport = now;
      lastPhase = phase;
      reports.report(snapshot());
    }
  };
  const assertSelected = (url: string) => {
    if (!selected.has(url)) {
      throw new RangeError(`URL is not in this download: ${url}`);
    }
  };
  const updatePhase = () => {
    phase =
      (total !== undefined && loaded() === total) || committed.size === selected.size
        ? "verifying"
        : "downloading";
  };
  return {
    attempt(url) {
      assertSelected(url);
      if (committed.has(url)) {
        throw new Error(`Download already stored: ${url}`);
      }
      attempts.set(url, 0);
      updatePhase();
      emit();
    },
    begin(urls) {
      total = downloadByteTotal(byteSizes, urls);
      selected = new Set(urls);
      attempts.clear();
      committed.clear();
      updatePhase();
      emit(true);
    },
    complete() {
      if (committed.size !== selected.size) {
        throw new Error("Cannot complete a download with unstored files");
      }
      phase = "complete";
      emit(true);
    },
    fail() {
      phase = "failed";
      emit(true);
    },
    received(url, bytes) {
      assertSelected(url);
      const prior = attempts.get(url);
      const expected = byteSizes?.[url];
      if (
        prior === undefined ||
        !Number.isSafeInteger(bytes) ||
        bytes < prior ||
        (expected !== undefined && bytes > expected)
      ) {
        throw new RangeError(`Invalid received byte count: ${url}`);
      }
      attempts.set(url, bytes);
      updatePhase();
      emit();
    },
    retry(url) {
      assertSelected(url);
      attempts.delete(url);
      updatePhase();
      emit(true);
    },
    snapshot,
    stored(url) {
      assertSelected(url);
      attempts.delete(url);
      committed.add(url);
      updatePhase();
      emit();
    },
    verifying() {
      phase = "verifying";
      emit();
    },
  };
}
