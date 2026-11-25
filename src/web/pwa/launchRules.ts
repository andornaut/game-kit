// The pure decisions behind dom/launch: the first-install failure an error carries, the
// first-install progress value and its carry across the launch reload, update-check timing and
// backoff, and whether a deploy, a staged build or a grouped build still matches what launch read.
import type {
  BuildManifest,
  BuildPointer,
  BuildState,
  LaunchFailure,
  LaunchProgress,
  NetworkPlayNotice,
  UpdateState,
} from "./buildContract.ts";
import { installedManifest } from "./buildRecords.ts";

// The shortest time between update checks, so resuming the app asks the server at most once a
// minute.
export const UPDATE_CHECK_MS = 60_000;

// A failed background update is retried while the page stays visible: first after
// UPDATE_RETRY_MS, then after twice the previous wait, up to UPDATE_RETRY_MAX_MS.
export const UPDATE_RETRY_MS = 60_000;
export const UPDATE_RETRY_MAX_MS = 15 * 60_000;

// The progress share held back until the active record is written.
const RECORD_SHARE = 0.01;

export type FirstInstallFailure = LaunchFailure["reason"] | NetworkPlayNotice["reason"];

// A launch failure with the first-install reason failureReason reads.
export class LaunchError extends Error {
  readonly reason: FirstInstallFailure;

  constructor(reason: FirstInstallFailure, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LaunchError";
    this.reason = reason;
  }
}

/** The first-install failure an error carries, or "network" for any other error. */
export function failureReason(error: unknown): FirstInstallFailure {
  const reason = (error as { reason?: unknown } | null)?.reason;
  return reason === "network" ||
    reason === "quota" ||
    reason === "verification" ||
    reason === "unsupported"
    ? reason
    : "network";
}

/** The bytes of the manifest's boot files, each counted once. */
export function bootBytesOf(manifest: BuildManifest): number {
  const sizes = new Map(manifest.files.map((file) => [file.url, file.byteSize]));
  return [...new Set(manifest.boot)].reduce((sum, url) => sum + (sizes.get(url) ?? 0), 0);
}

// The byte counts behind one first-install progress value: downloaded and total download bytes,
// the boot bytes read after it, and whether the active record is written.
export interface ProgressCounts {
  readonly bootBytes: number;
  readonly received: number;
  readonly recorded: boolean;
  readonly total: number;
}

/**
 * The progress to report after `previous`: one determinate value over download bytes plus boot
 * bytes that never decreases. RECORD_SHARE of it is held back until the active record is
 * written, so only a recorded, fully booted build reaches 1.
 */
export function launchProgress(
  counts: ProgressCounts,
  previous: number,
  phase: LaunchProgress["phase"],
  bootFraction: number,
): LaunchProgress {
  const { bootBytes, received, recorded, total } = counts;
  const all = total + bootBytes;
  const read = phase === "ready" ? all : received + bootBytes * bootFraction;
  const share = all > 0 ? read / all : bootFraction;
  const raw = (1 - RECORD_SHARE) * Math.min(1, share) + (recorded ? RECORD_SHARE : 0);
  return {
    phase,
    receivedBytes: Math.round(read),
    totalBytes: all,
    value: phase === "ready" ? 1 : Math.max(previous, Math.min(raw, 1 - Number.EPSILON)),
  };
}

// First-install progress carried across the reload that boots the new build.
export interface ProgressCarry {
  readonly bootBytes: number;
  readonly receivedBytes: number;
  readonly version: string;
}

export function progressCarryText(carry: ProgressCarry): string {
  const { bootBytes, receivedBytes, version } = carry;
  return JSON.stringify({ bootBytes, receivedBytes, version } satisfies ProgressCarry);
}

/** The carry a session entry holds, or undefined when it is absent or malformed. */
export function parseProgressCarry(text: string | null | undefined): ProgressCarry | undefined {
  if (text === null || text === undefined) {
    return undefined;
  }
  try {
    const carry = JSON.parse(text) as Partial<ProgressCarry>;
    return typeof carry.version === "string" &&
      Number.isFinite(carry.receivedBytes) &&
      Number.isFinite(carry.bootBytes)
      ? (carry as ProgressCarry)
      : undefined;
  } catch {
    return undefined;
  }
}

/** The wait before the next retry of a failed update, after a wait of `previous` (0 for none). */
export function nextUpdateRetryMs(previous: number): number {
  return previous === 0 ? UPDATE_RETRY_MS : Math.min(previous * 2, UPDATE_RETRY_MAX_MS);
}

/** How long an ordinary update check must still wait after the one at `lastCheck`. */
export function updateCheckWait(now: number, lastCheck: number | undefined): number {
  return lastCheck === undefined ? 0 : UPDATE_CHECK_MS - (now - lastCheck);
}

/** Whether two update states report the same phase, version and staging value. */
export function sameUpdateState(a: UpdateState, b: UpdateState): boolean {
  return (
    a.phase === b.phase &&
    (a as { version?: string }).version === (b as { version?: string }).version &&
    (a as { value?: number }).value === (b as { value?: number }).value
  );
}

/** Whether `deployed` still names the grouped build `pointer` named, group for group. */
export function sameDeployedGroups(pointer: BuildPointer, deployed: BuildPointer): boolean {
  const { groups = [] } = pointer;
  return (
    deployed.version === pointer.version &&
    deployed.buildId === pointer.buildId &&
    deployed.groupedFirstInstall === pointer.groupedFirstInstall &&
    deployed.groups?.length === groups.length &&
    groups.every(
      ({ byteSize, sha256 }, index) =>
        deployed.groups?.[index]?.byteSize === byteSize &&
        deployed.groups?.[index]?.sha256 === sha256,
    )
  );
}

/**
 * Why stored group members do not match the deployed manifest, or undefined when they do: every
 * member must be a deployed file of its size, and every file this device installs must be stored.
 * Groups without a sound format, such as an earlier kit's, may also hold left-out alternatives.
 */
export function groupedManifestMismatch(
  soundFormat: string | undefined,
  deployed: BuildManifest,
  members: ReadonlyMap<string, { readonly byteSize: number }>,
): string | undefined {
  const sizes = new Map(deployed.files.map(({ byteSize, url }) => [url, byteSize]));
  for (const [url, { byteSize }] of members) {
    if (sizes.get(url) !== byteSize) {
      return `Grouped build member does not match ${url}`;
    }
  }
  for (const { url } of installedManifest(soundFormat, deployed).files) {
    if (!members.has(url)) {
      return `Grouped build member is missing for ${url}`;
    }
  }
  return undefined;
}

/**
 * Whether a download of `version` that started from `previous` may become the staged build in
 * `current`: no other context activated a build or staged a different one meanwhile.
 */
export function canPublishStaged(
  previous: BuildState,
  current: BuildState,
  version: string,
): boolean {
  return (
    current.active !== version &&
    current.active === previous.active &&
    (current.staged === previous.staged || current.staged === version)
  );
}

/**
 * The staged build a required update may activate for the document running `documentVersion`:
 * one that differs from it while the document's build, or none, is active.
 */
export function requiredUpdateCandidate(
  documentVersion: string,
  state: BuildState,
): string | undefined {
  const { active, staged } = state;
  return (active === undefined || active === documentVersion) &&
    staged !== undefined &&
    staged !== documentVersion
    ? staged
    : undefined;
}
