import { assertNever } from "./assertNever.ts";
import type { Timer } from "./clock/timer.ts";
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

// A stream of snapshots, such as createProgressState's: subscribe reports the current snapshot
// at once, then each change, until the returned function is called.
export interface ProgressSource {
  subscribe(listener: (snapshot: ProgressSnapshot) => void): () => void;
}

// How long a finished measured bar stays full, then fades out, default 0: the bar's own timing.
export interface ProgressHold {
  readonly fadeMs?: number;
  readonly fullMs: number;
}

const IDLE: ProgressSnapshot = { active: false, value: undefined };

const sameSnapshot = (a: ProgressSnapshot, b: ProgressSnapshot) =>
  a.active === b.active && a.value === b.value;

const checkHold = (hold: ProgressHold) => {
  const { fadeMs = 0, fullMs } = hold;
  if (!(Number.isFinite(fullMs) && fullMs >= 0)) {
    throw new RangeError(`Full hold must be nonnegative and finite: ${fullMs}`);
  }
  if (!(Number.isFinite(fadeMs) && fadeMs >= 0)) {
    throw new RangeError(`Fade must be nonnegative and finite: ${fadeMs}`);
  }
  return fullMs + fadeMs;
};

// One loading bar's snapshots from two layers: foreground, the loads the player waits for, over
// background, such as the first-visit precache or a forced update. The foreground shows whenever
// it is active, and the background whenever it alone is. When the shown layer's measured work
// finishes, the bar reports idle, so it holds full and fades, and nothing else shows until
// hold's fullMs + fadeMs have passed on timer; a foreground operation that begins meanwhile cuts
// the hold short and shows at once on the same bar. Work of unknown total that finishes hands
// over at once. Subscription reports the current snapshot immediately. dispose stops following
// the layers and cancels any hold. Throws a RangeError on a negative or nonfinite fullMs or
// fadeMs.
export function createLayeredProgress(
  timer: Timer,
  hold: ProgressHold,
  layers: { readonly background: ProgressSource; readonly foreground: ProgressSource },
): {
  dispose(): void;
  subscribe(listener: (snapshot: ProgressSnapshot) => void): () => void;
} {
  const holdMs = checkHold(hold);
  const current = { background: IDLE, foreground: IDLE };
  const listeners = new Set<(snapshot: ProgressSnapshot) => void>();
  let snapshot = IDLE;
  let shownLayer: keyof typeof current | undefined;
  let holding: unknown;
  let holdingNow = false;
  const publish = (next: ProgressSnapshot, layer: keyof typeof current | undefined) => {
    shownLayer = layer;
    if (sameSnapshot(next, snapshot)) {
      return;
    }
    snapshot = next;
    for (const listener of [...listeners]) {
      listener(snapshot);
    }
  };
  const render = () => {
    if (holdingNow) {
      if (!current.foreground.active) {
        return;
      }
      timer.clearTimeout(holding);
      holdingNow = false;
    }
    if (shownLayer !== undefined && snapshot.value !== undefined && !current[shownLayer].active) {
      publish(IDLE, undefined);
      holdingNow = true;
      holding = timer.setTimeout(() => {
        holdingNow = false;
        render();
      }, holdMs);
      return;
    }
    const layer = current.foreground.active
      ? "foreground"
      : current.background.active
        ? "background"
        : undefined;
    publish(layer === undefined ? IDLE : current[layer], layer);
  };
  const stops = (["background", "foreground"] as const).map((layer) =>
    layers[layer].subscribe((next) => {
      current[layer] = next;
      render();
    }),
  );
  return {
    dispose() {
      for (const stop of stops) {
        stop();
      }
      if (holdingNow) {
        timer.clearTimeout(holding);
        holdingNow = false;
      }
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
// nothing. Measured work that finishes shows full for fullMs, then fades out over fadeMs, its
// opacity falling linearly from one towards zero, and then shows nothing; unknown work that
// finishes shows nothing at once. Only the fade carries an opacity. Time is read only from the
// caller's at(nowMs): the first call after a finish or after unknown work begins starts that
// hold or that segment's travel, so the first drawn frame shows full or the segment entering.
// Throws a RangeError on a negative or nonfinite fullMs or fadeMs.
export function createProgressDisplay(
  fullMs: number,
  fadeMs = 0,
): {
  at(nowMs: number): ProgressDisplay;
  report(snapshot: ProgressSnapshot): void;
} {
  if (!(Number.isFinite(fullMs) && fullMs >= 0)) {
    throw new RangeError(`Full hold must be nonnegative and finite: ${fullMs}`);
  }
  if (!(Number.isFinite(fadeMs) && fadeMs >= 0)) {
    throw new RangeError(`Fade must be nonnegative and finite: ${fadeMs}`);
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
          if (shown.since === undefined) {
            shown = { kind: "full", since: nowMs };
            return { kind: "measured", value: 1 };
          }
          const heldMs = nowMs - shown.since;
          if (heldMs >= fullMs + fadeMs) {
            shown = { kind: "hidden" };
            return { kind: "hidden" };
          }
          if (heldMs >= fullMs) {
            return { kind: "measured", opacity: 1 - (heldMs - fullMs) / fadeMs, value: 1 };
          }
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
