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
  // Unregister retained resources; cancellation runs hooks once, successful handoff discards them.
  onCancel(cleanup: () => void): () => void;
}

export class LoadingCancellationError extends AggregateError {
  constructor(errors: readonly unknown[], cause?: unknown) {
    super(errors, "Loading attempt cleanup failed", { cause });
    this.name = "LoadingCancellationError";
  }
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
// Failure cancels before notification; active disposal cancels before returning. Register caller
// abort/partial-resource cleanup through onCancel. All hooks run; LoadingCancellationError
// rejects the attempt, or is thrown by dispose, when cleanup fails. Success commits before
// onReady and discards hooks, so later disposal cannot destroy successfully retained resources.
// No storage, activation, optional-asset policy or progress display is owned by this controller.
export function createLoadingAttempts(context: LoadingAttemptsContext): LoadingAttempts {
  let state: LoadingAttemptState = { attempt: 0, kind: "idle" };
  let inFlight: Promise<void> | undefined;
  let cancel: (() => unknown[]) | undefined;
  const settled = Promise.resolve();
  const assign = (next: LoadingAttemptState) => {
    state = next;
  };
  const notify = (next: LoadingAttemptState) => {
    assign(next);
    context.onState(next);
  };

  const begin = (): Promise<void> => {
    const id = state.attempt + 1;
    state = { attempt: id, kind: "loading" };
    let ownership: "active" | "cancelled" | "committed" = "active";
    const cleanups = new Map<symbol, () => void>();
    const cancelAttempt = (): unknown[] => {
      if (ownership !== "active") {
        return [];
      }
      ownership = "cancelled";
      if (cancel === cancelAttempt) {
        cancel = undefined;
      }
      const hooks = [...cleanups.values()];
      cleanups.clear();
      const errors: unknown[] = [];
      for (const cleanup of hooks) {
        try {
          cleanup();
        } catch (error) {
          errors.push(error);
        }
      }
      return errors;
    };
    cancel = cancelAttempt;
    const attempt: LoadingAttempt = {
      id,
      isCurrent: () => state.kind === "loading" && state.attempt === id,
      onCancel(cleanup) {
        if (ownership === "committed") {
          return () => {};
        }
        if (ownership === "cancelled" || state.kind === "disposed" || state.attempt !== id) {
          try {
            cleanup();
          } catch (error) {
            throw new LoadingCancellationError([error]);
          }
          return () => {};
        }
        const key = Symbol("loading-cancel");
        cleanups.set(key, cleanup);
        return () => {
          cleanups.delete(key);
        };
      },
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
          assign({ attempt: id, error, kind: "failed" });
          const errors = cancelAttempt();
          const failure = errors.length > 0 ? new LoadingCancellationError(errors, error) : error;
          if (state.kind !== "disposed") {
            notify({ attempt: id, error: failure, kind: "failed" });
          }
          if (errors.length > 0) {
            throw failure;
          }
        }
        return;
      }
      if (!attempt.isCurrent()) {
        return;
      }
      notify({ attempt: id, kind: "ready" });
      if (state.kind === "ready" && state.attempt === id) {
        ownership = "committed";
        cleanups.clear();
        if (cancel === cancelAttempt) {
          cancel = undefined;
        }
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
      const errors = cancel?.() ?? [];
      if (errors.length > 0) {
        throw new LoadingCancellationError(errors);
      }
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

export interface RequiredLoadingResource {
  retry(): void | PromiseLike<void>;
  status(): "failed" | "loading" | "ready";
}

export interface RequiredLoading {
  readonly state: LoadingAttemptState;
  dispose(): void;
  invalidate(): void;
  observe(resource: RequiredLoadingResource): () => void;
  retry(): Promise<void>;
  subscribe(listener: (state: LoadingAttemptState) => void): () => void;
  wait(ready: () => void): () => void;
}

interface RequiredFlight {
  readonly awaiting: Set<RequiredLoadingResource>;
  error: unknown;
  pending: number;
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  starting: boolean;
}

// Page-lifetime required leases. Providers own status and I/O, callers invalidate on changes.
// A void retry that still reports failed remains in flight until an explicit invalidation,
// a status change or lease removal. Promise retries also wait for their callbacks to settle.
// Ready resources are retained. No polling, storage, activation or progress display is owned.
export function createRequiredLoading(
  initial: readonly RequiredLoadingResource[] = [],
): RequiredLoading {
  const resources = new Map<RequiredLoadingResource, number>();
  for (const resource of initial) {
    resources.set(resource, (resources.get(resource) ?? 0) + 1);
  }
  const listeners = new Map<
    symbol,
    {
      readonly listener: (state: LoadingAttemptState) => void;
      previous: LoadingAttemptState;
    }
  >();
  const waiters = new Map<symbol, () => void>();
  const settled = Promise.resolve();
  let state: LoadingAttemptState = { attempt: 0, kind: "idle" };
  let attempt = 0;
  let disposed = false;
  let draining = false;
  let changed = false;
  let flight: RequiredFlight | undefined;

  const snapshot = () => {
    const failed: RequiredLoadingResource[] = [];
    let loading = false;
    let error: unknown;
    for (const resource of resources.keys()) {
      let status: ReturnType<RequiredLoadingResource["status"]>;
      try {
        status = resource.status();
      } catch (cause) {
        status = "failed";
        error ??= cause;
      }
      if (status === "loading") {
        loading = true;
      } else if (status !== "ready") {
        failed.push(resource);
      }
      if (status !== "failed") {
        flight?.awaiting.delete(resource);
      }
    }
    return { error, failed, loading };
  };
  const refresh = () => {
    if (disposed) {
      return;
    }
    const current = snapshot();
    if (flight !== undefined) {
      for (const resource of flight.awaiting) {
        if (!resources.has(resource)) {
          flight.awaiting.delete(resource);
        }
      }
      if (
        !flight.starting &&
        flight.pending === 0 &&
        !current.loading &&
        flight.awaiting.size === 0
      ) {
        const completed = flight;
        flight = undefined;
        completed.resolve();
      }
    }
    const kind =
      current.failed.length > 0
        ? "failed"
        : current.loading || flight !== undefined
          ? "loading"
          : "ready";
    if ((state.kind === "ready" || state.kind === "idle") && kind !== "ready") {
      attempt += 1;
    }
    if (state.kind !== kind || state.attempt !== attempt) {
      state =
        kind === "failed"
          ? { attempt, error: current.error ?? flight?.error, kind }
          : { attempt, kind };
      changed = true;
    }
  };
  const drain = () => {
    if (disposed || draining) {
      return;
    }
    draining = true;
    try {
      do {
        changed = false;
        refresh();
        for (const [key, slot] of [...listeners]) {
          if (disposed) {
            return;
          }
          refresh();
          if (listeners.has(key) && slot.previous !== state) {
            slot.previous = state;
            slot.listener(state);
          }
        }
        while (waiters.size > 0) {
          if (disposed) {
            break;
          }
          refresh();
          if (state.kind !== "ready") {
            break;
          }
          const [key, ready] = waiters.entries().next().value!;
          waiters.delete(key);
          ready();
        }
        refresh();
        if (disposed) {
          break;
        }
      } while (changed);
    } finally {
      draining = false;
    }
  };
  const settle = () => {
    refresh();
    drain();
  };
  settle();

  return {
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      state = { attempt, kind: "disposed" };
      resources.clear();
      listeners.clear();
      waiters.clear();
      const active = flight;
      flight = undefined;
      active?.resolve();
    },
    invalidate() {
      flight?.awaiting.clear();
      settle();
    },
    observe(resource) {
      if (disposed) {
        return () => {};
      }
      resources.set(resource, (resources.get(resource) ?? 0) + 1);
      settle();
      let active = true;
      return () => {
        if (active && !disposed) {
          active = false;
          const count = resources.get(resource)!;
          if (count === 1) {
            resources.delete(resource);
          } else {
            resources.set(resource, count - 1);
          }
          settle();
        }
      };
    },
    retry() {
      if (disposed) {
        return settled;
      }
      refresh();
      if (flight !== undefined) {
        return flight.promise;
      }
      if (state.kind !== "failed") {
        drain();
        return settled;
      }
      const failed = snapshot().failed;
      let resolve!: () => void;
      const promise = new Promise<void>((done) => {
        resolve = done;
      });
      const active: RequiredFlight = {
        awaiting: new Set(),
        error: undefined,
        pending: 0,
        promise,
        resolve,
        starting: true,
      };
      flight = active;
      attempt += 1;
      try {
        for (const resource of failed) {
          if (disposed) {
            break;
          }
          if (!resources.has(resource) || resource.status() !== "failed") {
            continue;
          }
          active.awaiting.add(resource);
          try {
            const result = resource.retry();
            if (result !== undefined) {
              active.awaiting.delete(resource);
              active.pending += 1;
              const finish = (error?: unknown) => {
                if (!disposed && flight === active) {
                  active.error ??= error;
                  active.pending -= 1;
                  settle();
                }
              };
              void Promise.resolve(result).then(() => finish(), finish);
            }
          } catch (error) {
            active.awaiting.delete(resource);
            active.error ??= error;
          }
        }
      } finally {
        active.starting = false;
        settle();
      }
      return promise;
    },
    get state() {
      return state;
    },
    subscribe(listener) {
      if (disposed) {
        return () => {};
      }
      refresh();
      const key = Symbol("loading-subscription");
      listeners.set(key, { listener, previous: state });
      try {
        listener(state);
      } catch (error) {
        listeners.delete(key);
        throw error;
      }
      drain();
      return () => {
        listeners.delete(key);
      };
    },
    wait(ready) {
      if (disposed) {
        return () => {};
      }
      const key = Symbol("loading-waiter");
      waiters.set(key, ready);
      settle();
      return () => {
        waiters.delete(key);
      };
    },
  };
}
