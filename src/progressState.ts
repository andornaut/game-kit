import { clamp01 } from "./numbers.ts";
import type { ProgressValue } from "./progress.ts";

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
