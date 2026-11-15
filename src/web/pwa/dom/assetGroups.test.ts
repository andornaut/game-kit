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
