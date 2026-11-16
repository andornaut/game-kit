import { afterEach, expect, it, vi } from "vitest";

import { ASSET_GROUPS_MESSAGE, type AssetGroupsRequest } from "../assetGroups.ts";
import { type AssetGroupsOptions, createAssetGroups } from "./assetGroups.ts";

const BUILD = "a".repeat(40);
const ports: MessagePort[] = [];
afterEach(() => {
  ports.splice(0).forEach((port) => port.close());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function fixture() {
  const requests: { message: AssetGroupsRequest; port: MessagePort }[] = [];
  const worker = {
    postMessage(message: unknown, transfer: Transferable[]) {
      const port = transfer[0] as MessagePort;
      ports.push(port);
      requests.push({ message: message as AssetGroupsRequest, port });
    },
  };
  const options: AssetGroupsOptions = {
    buildId: BUILD,
    container: { controller: worker, getRegistration: vi.fn() },
    requestTimeoutMs: 1000,
  };
  const result = (index: number, version = "one", readyGroups = ["a"]) =>
    requests[index]!.port.postMessage({
      result: { readyGroups, status: "available", version },
      type: "result",
    });
  return { options, requests, result, worker };
}

it("coalesces a deduplicated request and preserves the first document version across controllers", async () => {
  const f = fixture();
  const controller = createAssetGroups(f.options);
  const first = controller.ensureGroups(["b", "a", "a"]);
  expect(controller.ensureGroups(["a", "b"])).toBe(first);
  expect(f.requests[0]!.message).toEqual({
    buildId: BUILD,
    groups: ["a", "b"],
    type: ASSET_GROUPS_MESSAGE,
  });
  f.result(0, "one", ["a", "b"]);
  await expect(first).resolves.toEqual({
    readyGroups: ["a", "b"],
    status: "available",
    version: "one",
  });
  const nextWorker = fixture();
  Object.assign(f.options.container, { controller: nextWorker.worker });
  const next = controller.readState();
  expect(nextWorker.requests[0]!.message.version).toBe("one");
  nextWorker.result(0, "two");
  await expect(next).resolves.toEqual({ reason: "wrong-build", status: "unavailable" });
  controller.dispose();
});

it("uses an active registration on a first uncontrolled visit without registering or claiming", async () => {
  const f = fixture();
  const getRegistration = vi.fn(async () => ({ active: f.worker }));
  const controller = createAssetGroups({
    ...f.options,
    container: { controller: null, getRegistration },
  });
  const pending = controller.readState();
  await Promise.resolve();
  expect(getRegistration).toHaveBeenCalledOnce();
  f.result(0);
  await expect(pending).resolves.toMatchObject({ status: "available", version: "one" });
  controller.dispose();
});

it("reports unavailable when no worker exists and settles a lookup on disposal", async () => {
  const f = fixture();
  const controller = createAssetGroups({
    ...f.options,
    container: { controller: null, getRegistration: async () => undefined },
  });
  await expect(controller.readState()).resolves.toEqual({
    reason: "no-worker",
    status: "unavailable",
  });
  const hanging = createAssetGroups({
    ...f.options,
    container: { controller: null, getRegistration: () => new Promise(() => {}) },
  });
  const pending = hanging.readState();
  hanging.dispose();
  await expect(pending).resolves.toEqual({ reason: "disposed", status: "unavailable" });
  await expect(hanging.ensureGroups(["a"])).resolves.toEqual({
    reason: "disposed",
    status: "unavailable",
  });
  controller.dispose();
});

it("bounds a missing reply, ignores malformed input and permits an explicit retry", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const controller = createAssetGroups(f.options);
  const pending = controller.ensureGroups(["a"]);
  f.requests[0]!.port.postMessage({ result: { status: "available", version: 1 }, type: "result" });
  await vi.advanceTimersByTimeAsync(1000);
  await expect(pending).resolves.toEqual({ reason: "timeout", status: "unavailable" });
  const retry = controller.ensureGroups(["a"]);
  expect(f.requests).toHaveLength(2);
  controller.dispose();
  await expect(retry).resolves.toEqual({ reason: "disposed", status: "unavailable" });
});

it("returns atomic invalid IDs and contains progress observer failures", async () => {
  const f = fixture();
  const report = vi.fn(() => {
    throw new Error("view removed");
  });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const controller = createAssetGroups({ ...f.options, onDownloadProgress: report });
  const pending = controller.ensureGroups(["a", "unknown"]);
  const port = f.requests[0]!.port;
  port.postMessage({
    progress: { operationId: "operation", phase: "downloading", value: 0.25, version: "one" },
    type: "progress",
  });
  port.postMessage({
    progress: { operationId: "other", phase: "downloading", value: 0.5, version: "one" },
    type: "progress",
  });
  port.postMessage({
    result: { status: "invalid-groups", unknownGroups: ["unknown"] },
    type: "result",
  });
  await expect(pending).resolves.toEqual({ status: "invalid-groups", unknownGroups: ["unknown"] });
  expect(report).toHaveBeenCalledOnce();
  controller.dispose();
});

it("rejects mutable build identities and unsafe request bounds before installing resources", () => {
  const f = fixture();
  for (const buildId of ["dev", "a".repeat(8), `${BUILD}-dirty`]) {
    expect(() => createAssetGroups({ ...f.options, buildId })).toThrow(TypeError);
  }
  for (const requestTimeoutMs of [0, -1, NaN, 0.5, 2_147_483_648]) {
    expect(() => createAssetGroups({ ...f.options, requestTimeoutMs })).toThrow(RangeError);
  }
  expect(f.requests).toHaveLength(0);
});

it("rejects a success reply that omits a requested group", async () => {
  const f = fixture();
  const controller = createAssetGroups(f.options);
  const pending = controller.ensureGroups(["a", "b"]);
  f.result(0, "one", ["a"]);
  await expect(pending).resolves.toEqual({ reason: "failed", status: "unavailable" });
  controller.dispose();
});

it("expires progressing work at the absolute deadline and can later observe its durable result", async () => {
  vi.useFakeTimers();
  const f = fixture();
  let delivered!: () => void;
  const report = vi.fn(() => delivered());
  const controller = createAssetGroups({ ...f.options, onDownloadProgress: report });
  const pending = controller.ensureGroups(["a"]);
  const progress = async (value: number) => {
    const received = new Promise<void>((resolve) => {
      delivered = resolve;
    });
    f.requests[0]!.port.postMessage({
      progress: { operationId: "active", phase: "downloading", value, version: "one" },
      type: "progress",
    });
    await received;
  };
  await vi.advanceTimersByTimeAsync(500);
  await progress(0.25);
  await vi.advanceTimersByTimeAsync(400);
  await progress(0.75);
  await vi.advanceTimersByTimeAsync(100);
  await expect(pending).resolves.toEqual({ reason: "timeout", status: "unavailable" });
  expect(report).toHaveBeenCalledTimes(2);
  expect(f.requests).toHaveLength(1);
  // Worker-side work may commit after the client closes its port; no cancellation was sent.
  f.result(0);
  const read = controller.readState();
  expect(f.requests).toHaveLength(2);
  f.result(1);
  await expect(read).resolves.toMatchObject({ status: "available", version: "one" });
  controller.dispose();
});

it("charges registration lookup time before a worker can receive the request", async () => {
  vi.useFakeTimers();
  const f = fixture();
  let finish!: (registration: { active: typeof f.worker }) => void;
  const controller = createAssetGroups({
    ...f.options,
    container: {
      controller: null,
      getRegistration: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    },
  });
  const pending = controller.ensureGroups(["a"]);
  await vi.advanceTimersByTimeAsync(1000);
  await expect(pending).resolves.toEqual({ reason: "timeout", status: "unavailable" });
  finish({ active: f.worker });
  await Promise.resolve();
  expect(f.requests).toHaveLength(0);
  controller.dispose();
});

it("bounds queueing and verification without treating phase notifications as completion", async () => {
  vi.useFakeTimers();
  const f = fixture();
  let delivered!: () => void;
  const controller = createAssetGroups({ ...f.options, onDownloadProgress: () => delivered() });
  const pending = controller.readState();
  // A serialized job has no progress notification until its staging/check work runs.
  await vi.advanceTimersByTimeAsync(600);
  const phase = async (name: "checking" | "verifying") => {
    const received = new Promise<void>((resolve) => {
      delivered = resolve;
    });
    f.requests[0]!.port.postMessage({
      progress: { operationId: "checking", phase: name, value: undefined, version: "one" },
      type: "progress",
    });
    await received;
  };
  await phase("checking");
  await vi.advanceTimersByTimeAsync(250);
  await phase("verifying");
  await vi.advanceTimersByTimeAsync(100);
  await phase("verifying");
  await vi.advanceTimersByTimeAsync(50);
  await expect(pending).resolves.toEqual({ reason: "timeout", status: "unavailable" });
  expect(f.requests).toHaveLength(1);
  controller.dispose();
});

// A native-channel round trip drains messages without advancing the fake deadline.
async function flushPort(port: MessagePort): Promise<void> {
  const channel = new MessageChannel();
  ports.push(channel.port1, channel.port2);
  await new Promise<void>((resolve) => {
    channel.port1.onmessage = () => {
      // Both messages are native tasks, not fake-clock timers.
      port.postMessage({ type: "flush" });
      resolve();
    };
    channel.port2.postMessage(null);
  });
  await new Promise<void>((resolve) => {
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(null);
  });
}

it("renews inactivity for validated forward work beyond the absolute deadline, without bar progress", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const report = vi.fn();
  const options = { ...f.options, onDownloadProgress: report, timeoutMode: "inactivity" as const };
  const controller = createAssetGroups(options);
  // Runtime mutation cannot change this owner's selected mode.
  Object.assign(options, { timeoutMode: "absolute" });
  const pending = controller.ensureGroups(["a"]);
  expect(f.requests[0]!.message.activity).toBe(true);
  const port = f.requests[0]!.port;
  for (const sequence of [1, 2, 3]) {
    // Each renewal must arrive before advancing to the next inactivity window.
    // eslint-disable-next-line no-await-in-loop
    await vi.advanceTimersByTimeAsync(700);
    port.postMessage({
      buildId: BUILD,
      operationId: "work",
      sequence,
      type: "activity",
      version: "one",
    });
    // eslint-disable-next-line no-await-in-loop
    await flushPort(port);
  }
  expect(report).not.toHaveBeenCalled();
  f.result(0);
  await expect(pending).resolves.toMatchObject({ status: "available" });
  controller.dispose();
});

it("ignores replay, foreign identity, malformed activity and unchanged phases, then closes late work", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const controller = createAssetGroups({ ...f.options, timeoutMode: "inactivity" });
  const pending = controller.readState();
  const port = f.requests[0]!.port;
  const activity = {
    buildId: BUILD,
    operationId: "work",
    sequence: 1,
    type: "activity",
    version: "one",
  };
  port.postMessage(activity);
  await flushPort(port);
  await vi.advanceTimersByTimeAsync(700);
  for (const message of [
    activity,
    { ...activity, sequence: 0 },
    { ...activity, sequence: 1.5 },
    { ...activity, buildId: "b".repeat(40), sequence: 2 },
    { ...activity, operationId: "other", sequence: 2 },
    { ...activity, sequence: 2, version: "other" },
    {
      progress: { operationId: "work", phase: "verifying", value: undefined, version: "one" },
      type: "progress",
    },
  ]) {
    port.postMessage(message);
  }
  await flushPort(port);
  await vi.advanceTimersByTimeAsync(300);
  await expect(pending).resolves.toEqual({ reason: "timeout", status: "unavailable" });
  f.result(0);
  const retry = controller.readState();
  controller.dispose();
  await expect(retry).resolves.toEqual({ reason: "disposed", status: "unavailable" });
  expect(f.requests).toHaveLength(2);
});

it("bounds inactivity lookup and legacy silent workers, and rejects an invalid mode atomically", async () => {
  vi.useFakeTimers();
  const f = fixture();
  expect(() => createAssetGroups({ ...f.options, timeoutMode: "unknown" as "absolute" })).toThrow(
    RangeError,
  );
  expect(f.requests).toHaveLength(0);
  const controller = createAssetGroups({ ...f.options, timeoutMode: "inactivity" });
  const pending = controller.readState();
  await vi.advanceTimersByTimeAsync(1000);
  await expect(pending).resolves.toMatchObject({ reason: "timeout" });
  controller.dispose();
  const hanging = createAssetGroups({
    ...f.options,
    container: { controller: null, getRegistration: () => new Promise(() => {}) },
    timeoutMode: "inactivity",
  });
  const lookup = hanging.readState();
  await vi.advanceTimersByTimeAsync(1000);
  await expect(lookup).resolves.toMatchObject({ reason: "timeout" });
  hanging.dispose();
});
