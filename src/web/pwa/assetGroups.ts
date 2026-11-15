import { type DownloadProgress, isDownloadProgress } from "./downloadProgress.ts";

export const ASSET_GROUPS_MESSAGE = "game-kit-asset-groups";

export interface AssetGroupsSnapshot {
  readonly status: "available";
  readonly version: string;
  readonly readyGroups: readonly string[];
}

export type AssetGroupsUnavailableReason =
  "unsupported" | "no-worker" | "wrong-build" | "offline" | "timeout" | "failed" | "disposed";

export type AssetGroupsResult =
  | AssetGroupsSnapshot
  | { readonly status: "unavailable"; readonly reason: AssetGroupsUnavailableReason }
  | { readonly status: "invalid-groups"; readonly unknownGroups: readonly string[] };

export interface AssetGroupsRequest {
  readonly type: typeof ASSET_GROUPS_MESSAGE;
  readonly buildId: string;
  readonly version?: string;
  readonly groups: readonly string[];
}

export type AssetGroupsReply =
  | { readonly type: "progress"; readonly progress: DownloadProgress }
  | { readonly type: "result"; readonly result: AssetGroupsResult };

const unavailableReasons: readonly string[] = [
  "unsupported",
  "no-worker",
  "wrong-build",
  "offline",
  "timeout",
  "failed",
  "disposed",
];

export function isAssetGroupsReply(value: unknown): value is AssetGroupsReply {
  if (value === null || typeof value !== "object") {
    return false;
  }
  if ("type" in value && value.type === "progress") {
    return "progress" in value && isDownloadProgress(value.progress);
  }
  if (!("type" in value) || value.type !== "result" || !("result" in value)) {
    return false;
  }
  const result = value.result;
  if (result === null || typeof result !== "object" || !("status" in result)) {
    return false;
  }
  if (result.status === "available") {
    return (
      "version" in result &&
      typeof result.version === "string" &&
      result.version.length > 0 &&
      "readyGroups" in result &&
      Array.isArray(result.readyGroups) &&
      result.readyGroups.every((id: unknown) => typeof id === "string")
    );
  }
  if (result.status === "invalid-groups") {
    return (
      "unknownGroups" in result &&
      Array.isArray(result.unknownGroups) &&
      result.unknownGroups.every((id: unknown) => typeof id === "string")
    );
  }
  return (
    result.status === "unavailable" &&
    "reason" in result &&
    typeof result.reason === "string" &&
    unavailableReasons.includes(result.reason)
  );
}
