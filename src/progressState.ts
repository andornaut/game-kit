import { assertNever } from "./assertNever.ts";
import { clamp01 } from "./numbers.ts";
import type { ProgressDisplay, ProgressValue } from "./progress.ts";

export interface ProgressSnapshot {
  readonly active: boolean;
  readonly value: ProgressValue;
}

export interface ProgressHandle {
  finish(): void;
  progress(value: ProgressValue): void;
}

// Each begin replaces the previous operation; stale asynchronous callbacks cannot update or
// dismiss the new operation. Subscription reports the current state immediately.
export function createProgressState(): {
  begin(): ProgressHandle;
  subscribe(listener: (snapshot: ProgressSnapshot) => void): () => void;
} {
  let current: object | undefined;
  let snapshot: ProgressSnapshot = { active: false, value: undefined };
  const listeners = new Set<(snapshot: ProgressSnapshot) => void>();
  const publish = (next: ProgressSnapshot) => {
    if (next.active === snapshot.active && next.value === snapshot.value) {
      return;
    }
    snapshot = next;
    for (const listener of [...listeners]) {
      listener(snapshot);
    }
  };
  return {
    begin() {
      const token = {};
      current = token;
      publish({ active: true, value: undefined });
      return {
        finish() {
          if (current === token) {
            current = undefined;
            publish({ active: false, value: undefined });
          }
        },
        progress(value) {
          if (current === token) {
            publish({
              active: true,
              value: value !== undefined && Number.isFinite(value) ? clamp01(value) : undefined,
            });
          }
        },
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
  };
}

type Shown =
  | { readonly kind: "full"; readonly since: number | undefined }
  | { readonly kind: "hidden" }
  | { readonly kind: "indeterminate"; readonly since: number | undefined }
  | { readonly kind: "measured"; readonly value: number };

// Turns reported snapshots into what a loading bar shows at each drawn moment. Idle shows
// nothing. Measured work that finishes shows full for fullMs and then nothing; unknown work
// that finishes shows nothing at once. Time is read only from the caller's at(nowMs): the first
// call after a finish or after unknown work begins starts that hold or that segment's travel, so
// the first drawn frame shows full or the segment entering. Throws a RangeError on a negative or
// nonfinite fullMs.
export function createProgressDisplay(fullMs: number): {
  at(nowMs: number): ProgressDisplay;
  report(snapshot: ProgressSnapshot): void;
} {
  if (!(Number.isFinite(fullMs) && fullMs >= 0)) {
    throw new RangeError(`Full hold must be nonnegative and finite: ${fullMs}`);
  }
  let shown: Shown = { kind: "hidden" };
  return {
    at(nowMs) {
      switch (shown.kind) {
        case "hidden":
          return { kind: "hidden" };
        case "measured":
          return { kind: "measured", value: shown.value };
        case "indeterminate": {
          const since = shown.since ?? nowMs;
          shown = { kind: "indeterminate", since };
          return { elapsedMs: nowMs - since, kind: "indeterminate" };
        }
        case "full": {
          if (shown.since !== undefined && nowMs - shown.since >= fullMs) {
            shown = { kind: "hidden" };
            return { kind: "hidden" };
          }
          shown = { kind: "full", since: shown.since ?? nowMs };
          return { kind: "measured", value: 1 };
        }
        default:
          return assertNever(shown);
      }
    },
    report(snapshot) {
      if (!snapshot.active) {
        shown =
          shown.kind === "measured" || shown.kind === "full"
            ? { kind: "full", since: shown.kind === "full" ? shown.since : undefined }
            : { kind: "hidden" };
      } else if (snapshot.value !== undefined && Number.isFinite(snapshot.value)) {
        shown = { kind: "measured", value: clamp01(snapshot.value) };
      } else if (shown.kind !== "indeterminate") {
        shown = { kind: "indeterminate", since: undefined };
      }
    },
  };
}
