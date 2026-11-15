import { isBuildId } from "../../build/buildVersion.ts";
import {
  ASSET_GROUPS_MESSAGE,
  type AssetGroupsRequest,
  type AssetGroupsResult,
  isAssetGroupsReply,
} from "../assetGroups.ts";
import type { DownloadProgress } from "../downloadProgress.ts";

interface GroupWorker {
  postMessage(message: unknown, transfer: Transferable[]): void;
}

export interface AssetGroupsOptions {
  readonly buildId: string;
  readonly container: {
    readonly controller: GroupWorker | null;
    getRegistration(): Promise<{ readonly active: GroupWorker | null } | undefined>;
  };
  readonly requestTimeoutMs: number;
  readonly onDownloadProgress?: (snapshot: DownloadProgress) => void;
}

export interface AssetGroups {
  readState(): Promise<AssetGroupsResult>;
  ensureGroups(ids: readonly string[]): Promise<AssetGroupsResult>;
  dispose(): void;
}

// One instance belongs to one document/build. Controller replacement must not retarget its pin.
// Calls use explicit lifecycle hooks owned by the caller; this installs no polling or registration.
export function createAssetGroups(options: AssetGroupsOptions): AssetGroups {
  const { buildId, container, onDownloadProgress, requestTimeoutMs } = options;
  if (!isBuildId(buildId)) {
    throw new TypeError("Asset groups require a full immutable release build ID");
  }
  if (
    !Number.isSafeInteger(requestTimeoutMs) ||
    requestTimeoutMs <= 0 ||
    requestTimeoutMs > 2_147_483_647
  ) {
    throw new RangeError("Asset group request timeout must be a positive timer-safe integer");
  }
  let disposed = false;
  let version: string | undefined;
  const pending = new Set<() => void>();
  const inFlight = new Map<string, Promise<AssetGroupsResult>>();
  const unavailable = (reason: "disposed" | "timeout" | "failed" | "no-worker") =>
    ({ reason, status: "unavailable" }) as const;

  const request = (ids: readonly string[]): Promise<AssetGroupsResult> => {
    if (disposed) {
      return Promise.resolve(unavailable("disposed"));
    }
    if (ids.some((id) => typeof id !== "string")) {
      throw new TypeError("Asset group IDs must be strings");
    }
    const groups = [...new Set(ids)].sort();
    const key = JSON.stringify(groups);
    const previous = inFlight.get(key);
    if (previous !== undefined) {
      return previous;
    }
    const operation = new Promise<AssetGroupsResult>((resolve) => {
      let channel: MessageChannel | undefined;
      let done = false;
      const finish = (result: AssetGroupsResult) => {
        if (done) {
          return;
        }
        done = true;
        clearTimeout(timer);
        pending.delete(cancel);
        if (channel !== undefined) {
          channel.port1.onmessage = null;
          channel.port1.onmessageerror = null;
          channel.port1.close();
          channel.port2.close();
        }
        resolve(result);
      };
      const cancel = () => finish(unavailable("disposed"));
      const timer = setTimeout(() => finish(unavailable("timeout")), requestTimeoutMs);
      pending.add(cancel);
      void (async () => {
        try {
          // The worker validates this document's durable pin and explicit build identity before
          // allowing an uncontrolled first-visit fallback. getRegistration never registers.
          const worker = container.controller ?? (await container.getRegistration())?.active;
          if (done) {
            return;
          }
          if (worker === null || worker === undefined) {
            finish(unavailable("no-worker"));
            return;
          }
          channel = new MessageChannel();
          let operationId: string | undefined;
          let progressVersion: string | undefined;
          channel.port1.onmessageerror = () => finish(unavailable("failed"));
          channel.port1.onmessage = ({ data }: MessageEvent<unknown>) => {
            if (done || !isAssetGroupsReply(data)) {
              return;
            }
            if (data.type === "progress") {
              if (
                (version !== undefined && data.progress.version !== version) ||
                (progressVersion !== undefined && data.progress.version !== progressVersion) ||
                (operationId !== undefined && data.progress.operationId !== operationId)
              ) {
                return;
              }
              operationId = data.progress.operationId;
              progressVersion = data.progress.version;
              try {
                onDownloadProgress?.(data.progress);
              } catch (error) {
                console.error("Asset group progress callback failed.", error);
              }
              return;
            }
            const { result } = data;
            if (result.status === "available") {
              if (
                (version !== undefined && result.version !== version) ||
                (progressVersion !== undefined && result.version !== progressVersion)
              ) {
                finish({ reason: "wrong-build", status: "unavailable" });
                return;
              }
              if (!groups.every((id) => result.readyGroups.includes(id))) {
                finish(unavailable("failed"));
                return;
              }
              version = result.version;
            }
            finish(result);
          };
          const message: AssetGroupsRequest = {
            buildId,
            groups,
            type: ASSET_GROUPS_MESSAGE,

            ...(version === undefined ? {} : { version }),
          };
          worker.postMessage(message, [channel.port2]);
        } catch {
          finish(unavailable("failed"));
        }
      })();
    });
    inFlight.set(key, operation);
    void operation.then(() => {
      if (inFlight.get(key) === operation) {
        inFlight.delete(key);
      }
    });
    return operation;
  };
  return {
    dispose: () => {
      disposed = true;
      for (const cancel of [...pending]) {
        cancel();
      }
    },
    ensureGroups: request,
    readState: () => request([]),
  };
}
