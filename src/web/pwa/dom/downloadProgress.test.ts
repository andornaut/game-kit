import { afterEach, expect, it, vi } from "vitest";

import { DOWNLOAD_PROGRESS_MESSAGE, type DownloadProgress } from "../downloadProgress.ts";
import { watchDownloadProgress } from "./downloadProgress.ts";

const ports: MessagePort[] = [];
afterEach(() => {
  for (const port of ports.splice(0)) {
    port.close();
  }
  vi.restoreAllMocks();
});

function worker() {
  let remote!: MessagePort;
  const source = Object.assign(new EventTarget(), {
    postMessage: vi.fn((message: unknown, transfer?: Transferable[]) => {
      expect(message).toEqual({ type: DOWNLOAD_PROGRESS_MESSAGE });
      remote = transfer?.[0] as MessagePort;
      ports.push(remote);
    }),
    state: "installing",
  });
  return { emit: (snapshot: unknown) => remote.postMessage(snapshot), source };
}

const snapshot: DownloadProgress = {
  operationId: "one",
  phase: "downloading",
  value: 0.25,
  version: "a",
};

it("subscribes to one worker and ignores malformed or cross-operation data before completion", async () => {
  const target = worker();
  const received: DownloadProgress[] = [];
  let done!: () => void;
  const completed = new Promise<void>((resolve) => {
    done = resolve;
  });
  const dispose = watchDownloadProgress((value) => {
    received.push(value);
    if (value.phase === "complete") {
      done();
    }
  }, target.source);
  target.emit({ ...snapshot, value: NaN });
  target.emit(snapshot);
  target.emit({ ...snapshot, operationId: "other" });
  target.emit({ ...snapshot, version: "b" });
  target.emit({ ...snapshot, phase: "complete", value: 1 });
  await completed;
  expect(received).toEqual([snapshot, { ...snapshot, phase: "complete", value: 1 }]);
  dispose();
  dispose();
});

it("can reconnect to the current snapshot without treating an unknown size as zero", async () => {
  const target = worker();
  let resolve!: (value: DownloadProgress) => void;
  const current = new Promise<DownloadProgress>((done) => {
    resolve = done;
  });
  const dispose = watchDownloadProgress(resolve, target.source);
  target.emit({ ...snapshot, phase: "checking", value: undefined });
  await expect(current).resolves.toMatchObject({ phase: "checking", value: undefined });
  dispose();
  let completed!: (value: DownloadProgress) => void;
  const latest = new Promise<DownloadProgress>((done) => {
    completed = done;
  });
  const next = watchDownloadProgress(completed, target.source);
  target.emit({ ...snapshot, phase: "complete", value: 1 });
  await expect(latest).resolves.toMatchObject({ phase: "complete", value: 1 });
  next();
});

it("contains observer failures and stops listening after explicit disposal", async () => {
  const target = worker();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  let done!: () => void;
  const reported = new Promise<void>((resolve) => {
    done = resolve;
  });
  const report = vi.fn(() => {
    done();
    throw new Error("view removed");
  });
  const dispose = watchDownloadProgress(report, target.source);
  target.emit(snapshot);
  await reported;
  expect(console.error).toHaveBeenCalledOnce();
  dispose();
  target.emit({ ...snapshot, value: 0.5 });
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  expect(report).toHaveBeenCalledOnce();
});
