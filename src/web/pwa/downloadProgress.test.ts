import { describe, expect, it } from "vitest";

import {
  createDownloadProgress,
  downloadByteTotal,
  type DownloadProgress,
  isDownloadProgress,
} from "./downloadProgress.ts";

function tracker(sizes: Record<string, number> | undefined) {
  let now = 0;
  const reports: DownloadProgress[] = [];
  const progress = createDownloadProgress(
    {
      now: () => now,
      operationId: "attempt-1",
      report: (snapshot) => reports.push(snapshot),
      version: "build-1",
    },
    sizes,
  );
  return {
    advance: () => {
      now += 100;
    },
    progress,
    reports,
  };
}

describe("download progress", () => {
  it("totals only selected unique URLs and rejects incomplete or overflowing size metadata", () => {
    expect(downloadByteTotal({ a: 3, b: 7, otherCodec: 100 }, ["a", "b", "a"])).toBe(10);
    expect(downloadByteTotal(undefined, ["a"])).toBeUndefined();
    expect(() => downloadByteTotal({ a: 3 }, ["missing"])).toThrow(RangeError);
    expect(() => downloadByteTotal({ a: Number.MAX_SAFE_INTEGER, b: 1 }, ["a", "b"])).toThrow(
      RangeError,
    );
  });

  it("combines concurrent chunks and resets failed attempts without counting them twice", () => {
    const { advance, progress, reports } = tracker({ a: 4, b: 6, reused: 100 });
    progress.begin(["a", "b"]);
    progress.attempt("a");
    progress.attempt("b");
    advance();
    progress.received("a", 2);
    expect(reports.at(-1)?.value).toBe(0.2);
    advance();
    progress.received("b", 3);
    expect(reports.at(-1)?.value).toBe(0.5);
    progress.retry("a");
    expect(reports.at(-1)?.value).toBe(0.3);
    progress.attempt("a");
    advance();
    progress.received("a", 4);
    progress.stored("a");
    expect(progress.snapshot().value).toBe(0.7);
    progress.received("b", 6);
    expect(progress.snapshot()).toMatchObject({ phase: "verifying", value: undefined });
    expect(() => progress.complete()).toThrow("unstored");
    progress.stored("b");
    progress.complete();
    expect(reports.at(-1)).toMatchObject({ phase: "complete", value: 1 });
    expect(reports.every(isDownloadProgress)).toBe(true);
  });

  it("throttles chunk-only changes while delivering phase and failure boundaries immediately", () => {
    const { progress, reports } = tracker({ a: 100 });
    progress.begin(["a"]);
    progress.attempt("a");
    for (let bytes = 1; bytes < 100; bytes += 1) {
      progress.received("a", bytes);
    }
    expect(reports).toHaveLength(1);
    progress.received("a", 100);
    expect(reports.at(-1)?.phase).toBe("verifying");
    progress.fail();
    expect(reports.at(-1)).toMatchObject({ phase: "failed", value: undefined });
  });

  it("keeps zero-byte or legacy unknown work indeterminate until it is stored and committed", () => {
    for (const sizes of [undefined, { a: 0 }]) {
      const { progress, reports } = tracker(sizes);
      progress.begin(["a"]);
      progress.attempt("a");
      progress.received("a", 0);
      expect(reports.every((value) => value.value === undefined)).toBe(true);
      progress.stored("a");
      progress.complete();
      expect(reports.at(-1)?.value).toBe(1);
    }
    const { progress } = tracker({});
    progress.begin([]);
    expect(progress.snapshot().value).toBeUndefined();
    progress.complete();
    expect(progress.snapshot().value).toBe(1);
  });

  it("rejects invalid counts and unselected URLs instead of manufacturing progress", () => {
    const { progress } = tracker({ a: 4 });
    progress.begin(["a"]);
    progress.attempt("a");
    expect(() => progress.received("a", 5)).toThrow(RangeError);
    progress.received("a", 3);
    expect(() => progress.received("a", 2)).toThrow(RangeError);
    expect(() => progress.attempt("other")).toThrow(RangeError);
    expect(
      isDownloadProgress({ operationId: "x", phase: "downloading", value: NaN, version: "a" }),
    ).toBe(false);
    expect(
      isDownloadProgress({ operationId: "x", phase: "complete", value: 0.5, version: "a" }),
    ).toBe(false);
  });
});
