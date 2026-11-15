export const LOADING_FAILURE_TEXT = Object.freeze({
  body: "Some game files could not load. Try again.",
  retry: "Retry",
  title: "Loading failed",
});

export type LoadingAttemptState =
  | { readonly attempt: number; readonly kind: "idle" | "loading" | "ready" | "disposed" }
  | { readonly attempt: number; readonly error: unknown; readonly kind: "failed" };

export interface LoadingAttempt {
  readonly id: number;
  // Guard asynchronous caller-owned progress callbacks, including callbacks after settlement.
  isCurrent(): boolean;
}

export interface LoadingAttemptsContext {
  // Classify required files here and reject when they fail. Own the existing progress bar here.
  readonly load: (attempt: LoadingAttempt) => void | PromiseLike<void>;
  readonly onReady?: () => void | PromiseLike<void>;
  readonly onState: (state: LoadingAttemptState) => void;
}

export interface LoadingAttempts {
  readonly state: LoadingAttemptState;
  dispose(): void;
  retry(): Promise<void>;
  start(): Promise<void>;
}

// Start once, retry only a failed required load, and continue once after success. A load failure
// resolves in failed state; caller callback errors reject without becoming file-load failures.
// Continue game entry from onReady or an explicit ready-state check, never just after awaiting
// start/retry: those promises also settle after required-file failures.
// Disposal suppresses late notifications/continuation, but cannot cancel caller-owned I/O.
// No storage, activation, optional-asset policy or progress display is owned by this controller.
export function createLoadingAttempts(context: LoadingAttemptsContext): LoadingAttempts {
  let state: LoadingAttemptState = { attempt: 0, kind: "idle" };
  let inFlight: Promise<void> | undefined;
  const settled = Promise.resolve();
  const notify = (next: LoadingAttemptState) => {
    state = next;
    context.onState(next);
  };

  const begin = (): Promise<void> => {
    const id = state.attempt + 1;
    state = { attempt: id, kind: "loading" };
    const attempt: LoadingAttempt = {
      id,
      isCurrent: () => state.kind === "loading" && state.attempt === id,
    };
    const work = Promise.resolve().then(async () => {
      if (!attempt.isCurrent()) {
        return;
      }
      context.onState(state);
      if (!attempt.isCurrent()) {
        return;
      }
      try {
        await context.load(attempt);
      } catch (error) {
        if (attempt.isCurrent()) {
          notify({ attempt: id, error, kind: "failed" });
        }
        return;
      }
      if (!attempt.isCurrent()) {
        return;
      }
      notify({ attempt: id, kind: "ready" });
      if (state.kind === "ready" && state.attempt === id) {
        await context.onReady?.();
      }
    });
    const result = work.finally(() => {
      if (inFlight === result) {
        inFlight = undefined;
      }
    });
    inFlight = result;
    return result;
  };

  return {
    dispose() {
      state = { attempt: state.attempt, kind: "disposed" };
    },
    retry() {
      if (state.kind === "disposed") {
        return settled;
      }
      if (inFlight !== undefined) {
        return inFlight;
      }
      return state.kind === "failed" ? begin() : settled;
    },
    start() {
      if (state.kind === "disposed") {
        return settled;
      }
      if (inFlight !== undefined) {
        return inFlight;
      }
      return state.kind === "idle" ? begin() : settled;
    },
    get state() {
      return state;
    },
  };
}
