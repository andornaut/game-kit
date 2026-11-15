import { describe, expect, it, vi } from "vitest";

import {
  createLoadingAttempts,
  createRequiredLoading,
  type LoadingAttempt,
  type LoadingAttemptState,
  LoadingCancellationError,
  type RequiredLoadingResource,
} from "./loadingAttempts.ts";

function pending() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, reject, resolve };
}

describe("createLoadingAttempts", () => {
  it("coalesces initial and reentrant calls, then continues exactly once", async () => {
    const work = pending();
    const load = vi.fn(() => work.promise);
    const onReady = vi.fn();
    let observed: Promise<void> | undefined;
    const attempts = createLoadingAttempts({
      load,
      onReady,
      onState(state) {
        if (state.kind === "loading") {
          observed = attempts.start();
        }
      },
    });
    expect(attempts.state).toEqual({ attempt: 0, kind: "idle" });
    await attempts.retry();
    expect(load).not.toHaveBeenCalled();
    const first = attempts.start();
    expect(attempts.state).toEqual({ attempt: 1, kind: "loading" });
    expect(attempts.start()).toBe(first);
    expect(attempts.retry()).toBe(first);
    await Promise.resolve();
    expect(observed).toBe(first);
    expect(load).toHaveBeenCalledTimes(1);
    work.resolve();
    await first;
    await attempts.start();
    await attempts.retry();
    expect(attempts.state).toEqual({ attempt: 1, kind: "ready" });
    expect(load).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("blocks entry after a required font rejection until an explicit successful retry", async () => {
    const failure = new Error("Required font did not load");
    const load = vi.fn<() => Promise<void>>().mockRejectedValueOnce(failure).mockResolvedValue();
    const onReady = vi.fn();
    const states: LoadingAttemptState[] = [];
    const attempts = createLoadingAttempts({
      load,
      onReady,
      onState: (state) => states.push(state),
    });
    await attempts.start();
    expect(attempts.state).toEqual({ attempt: 1, error: failure, kind: "failed" });
    expect(onReady).not.toHaveBeenCalled();
    await attempts.start();
    expect(load).toHaveBeenCalledTimes(1);
    await attempts.retry();
    expect(states.map(({ attempt, kind }) => [attempt, kind])).toEqual([
      [1, "loading"],
      [1, "failed"],
      [2, "loading"],
      [2, "ready"],
    ]);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("returns repeated required asset failures to failed state and invalidates stale progress callbacks", async () => {
    const second = pending();
    const tokens: LoadingAttempt[] = [];
    const bar = vi.fn();
    const onReady = vi.fn();
    const attempts = createLoadingAttempts({
      load(attempt) {
        tokens.push(attempt);
        if (attempt.id === 1) {
          throw new Error("Required UI image failed");
        }
        return second.promise;
      },
      onReady,
      onState() {},
    });
    await attempts.start();
    expect(attempts.state.kind).toBe("failed");
    expect(tokens[0]!.isCurrent()).toBe(false);
    const retry = attempts.retry();
    expect(attempts.retry()).toBe(retry);
    await Promise.resolve();
    for (const token of tokens) {
      if (token.isCurrent()) {
        bar(token.id);
      }
    }
    expect(bar.mock.calls).toEqual([[2]]);
    second.reject(new Error("Required UI image still failed"));
    await retry;
    expect(attempts.state).toMatchObject({ attempt: 2, kind: "failed" });
    expect(tokens.every((token) => !token.isCurrent())).toBe(true);
    expect(onReady).not.toHaveBeenCalled();
  });

  it("suppresses a late rejection after disposal and starts no further operations", async () => {
    const work = pending();
    const onState = vi.fn();
    const onReady = vi.fn();
    const load = vi.fn(() => work.promise);
    const attempts = createLoadingAttempts({ load, onReady, onState });
    const first = attempts.start();
    await Promise.resolve();
    attempts.dispose();
    attempts.dispose();
    work.reject(new Error("Arrived after teardown"));
    await first;
    await attempts.start();
    await attempts.retry();
    expect(attempts.state).toEqual({ attempt: 1, kind: "disposed" });
    expect(onState.mock.calls).toEqual([[{ attempt: 1, kind: "loading" }]]);
    expect(onReady).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("suppresses a late success after disposal", async () => {
    const work = pending();
    const onReady = vi.fn();
    const onState = vi.fn();
    const attempts = createLoadingAttempts({ load: () => work.promise, onReady, onState });
    const first = attempts.start();
    await Promise.resolve();
    attempts.dispose();
    work.resolve();
    await first;
    expect(onState).toHaveBeenCalledTimes(1);
    expect(onReady).not.toHaveBeenCalled();
    expect(attempts.state.kind).toBe("disposed");
  });

  it("honours disposal before work starts and during a loading notification", async () => {
    const load = vi.fn();
    const onState = vi.fn();
    const before = createLoadingAttempts({ load, onState });
    const first = before.start();
    before.dispose();
    await first;
    expect(onState).not.toHaveBeenCalled();
    const during = createLoadingAttempts({ load, onState: () => during.dispose() });
    await during.start();
    expect(load).not.toHaveBeenCalled();
    expect(during.state.kind).toBe("disposed");
  });

  it("does not enter the game when the ready observer disposes the attempt", async () => {
    const onReady = vi.fn();
    const attempts = createLoadingAttempts({
      load() {},
      onReady,
      onState(state) {
        if (state.kind === "ready") {
          attempts.dispose();
        }
      },
    });
    await attempts.start();
    expect(onReady).not.toHaveBeenCalled();
    expect(attempts.state.kind).toBe("disposed");
  });

  it("propagates continuation errors without treating them as retryable file failures", async () => {
    const failure = new Error("Game initialization bug");
    const onReady = vi.fn(() => {
      throw failure;
    });
    const load = vi.fn();
    const attempts = createLoadingAttempts({ load, onReady, onState() {} });
    await expect(attempts.start()).rejects.toBe(failure);
    expect(attempts.state.kind).toBe("ready");
    await attempts.retry();
    await attempts.start();
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe("loading cancellation ownership", () => {
  it("cleans failed attempts before observers and retains successful ownership", async () => {
    const events: string[] = [];
    const failure = new Error("Required bootstrap failed");
    const cleanupFailure = new Error("Partial destroy failed");
    const retained = vi.fn();
    const tokens: LoadingAttempt[] = [];
    const onReady = vi.fn();
    const attempts = createLoadingAttempts({
      load(attempt) {
        tokens.push(attempt);
        attempt.onCancel(() => {
          events.push("abort");
        });
        const stop = attempt.onCancel(retained);
        stop();
        attempt.onCancel(() => {
          events.push("destroy");
          throw cleanupFailure;
        });
        attempt.onCancel(() => {
          events.push("listeners");
        });
        if (attempt.id === 1) {
          throw failure;
        }
      },
      onReady,
      onState(state) {
        if (state.kind === "failed") {
          events.push("failed");
        }
      },
    });
    await expect(attempts.start()).rejects.toMatchObject({
      cause: failure,
      errors: [cleanupFailure],
      name: "LoadingCancellationError",
    });
    expect(attempts.state.kind).toBe("failed");
    expect(events).toEqual(["abort", "destroy", "listeners", "failed"]);
    tokens[0]!.onCancel(() => {
      events.push("late");
    });
    expect(events.at(-1)).toBe("late");
    await attempts.retry();
    attempts.dispose();
    tokens[1]!.onCancel(retained);
    expect(events).toEqual(["abort", "destroy", "listeners", "failed", "late"]);
    expect(retained).not.toHaveBeenCalled();
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("disposes active I/O once even when cleanup throws and suppresses its late success", async () => {
    const work = pending();
    const first = vi.fn(() => {
      throw new Error("Abort port failed");
    });
    const second = vi.fn();
    const late = vi.fn();
    const onReady = vi.fn();
    let token!: LoadingAttempt;
    const attempts = createLoadingAttempts({
      load(attempt) {
        token = attempt;
        attempt.onCancel(first);
        attempt.onCancel(second);
        return work.promise;
      },
      onReady,
      onState() {},
    });
    const task = attempts.start();
    await Promise.resolve();
    expect(() => attempts.dispose()).toThrow(LoadingCancellationError);
    attempts.dispose();
    token.onCancel(late);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(late).toHaveBeenCalledTimes(1);
    expect(token.isCurrent()).toBe(false);
    work.resolve();
    await task;
    expect(attempts.state.kind).toBe("disposed");
    expect(onReady).not.toHaveBeenCalled();
  });
});

function resource(initial: ReturnType<RequiredLoadingResource["status"]>) {
  const value = { kind: initial };
  const retry = vi.fn<RequiredLoadingResource["retry"]>();
  return { provider: { retry, status: () => value.kind }, retry, value };
}

describe("createRequiredLoading", () => {
  it("initializes all known requirements before notifying and supports late required resources", () => {
    const font = resource("loading");
    const ui = resource("failed");
    const required = createRequiredLoading([font.provider, ui.provider]);
    const states: LoadingAttemptState[] = [];
    const stop = required.subscribe((state) => states.push(state));
    expect(states.map((state) => state.kind)).toEqual(["failed"]);
    const ready = vi.fn();
    required.wait(ready);
    font.value.kind = "ready";
    ui.value.kind = "ready";
    required.invalidate();
    expect(ready).toHaveBeenCalledTimes(1);
    const completed = required.state.attempt;
    const later = resource("loading");
    required.observe(later.provider);
    expect(required.state.kind).toBe("loading");
    expect(required.state.attempt).toBeGreaterThan(completed);
    later.value.kind = "failed";
    required.invalidate();
    expect(states.at(-1)?.kind).toBe("failed");
    stop();
    const count = states.length;
    later.value.kind = "ready";
    required.invalidate();
    expect(states).toHaveLength(count);
    expect(ready).toHaveBeenCalledTimes(1);
    required.dispose();
  });

  it("rechecks all requirements between one-shot wait callbacks and permits unregistering", () => {
    const first = resource("loading");
    const second = resource("loading");
    const required = createRequiredLoading([first.provider]);
    const events: string[] = [];
    required.wait(() => {
      events.push("first");
      required.observe(second.provider);
    });
    const cancelled = vi.fn();
    const cancel = required.wait(cancelled);
    required.wait(() => {
      events.push("second");
    });
    cancel();
    first.value.kind = "ready";
    required.invalidate();
    expect(events).toEqual(["first"]);
    second.value.kind = "ready";
    required.invalidate();
    required.invalidate();
    expect(events).toEqual(["first", "second"]);
    expect(cancelled).not.toHaveBeenCalled();
    required.dispose();
  });

  it("keeps duplicate observer leases independent and retains constructor requirements", () => {
    const item = resource("loading");
    const required = createRequiredLoading();
    expect(required.state.kind).toBe("ready");
    const first = required.observe(item.provider);
    const second = required.observe(item.provider);
    first();
    first();
    expect(required.state.kind).toBe("loading");
    second();
    expect(required.state.kind).toBe("ready");
    required.dispose();
    const seeded = createRequiredLoading([item.provider]);
    seeded.observe(item.provider)();
    expect(seeded.state.kind).toBe("loading");
    seeded.dispose();
  });

  it("retains successful resources and one void retry flight while any resource is still loading", async () => {
    const kept = resource("ready");
    const failed = resource("failed");
    const other = resource("loading");
    failed.retry.mockImplementation(() => {
      failed.value.kind = "loading";
    });
    const required = createRequiredLoading([kept.provider, failed.provider, other.provider]);
    const ready = vi.fn();
    required.wait(ready);
    const first = required.retry();
    failed.value.kind = "failed";
    required.invalidate();
    expect(required.state.kind).toBe("failed");
    expect(required.retry()).toBe(first);
    expect(failed.retry).toHaveBeenCalledTimes(1);
    expect(kept.retry).not.toHaveBeenCalled();
    expect(other.retry).not.toHaveBeenCalled();
    other.value.kind = "ready";
    required.invalidate();
    await first;
    const second = required.retry();
    Object.assign(failed.value, { kind: "ready" });
    required.invalidate();
    await second;
    expect(ready).toHaveBeenCalledTimes(1);
    expect(failed.retry).toHaveBeenCalledTimes(2);
    required.dispose();
  });

  it("keeps a deferred void retry in flight until authoritative invalidation", async () => {
    const item = resource("failed");
    const required = createRequiredLoading([item.provider]);
    const task = required.retry();
    let finished = false;
    void task.then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(finished).toBe(false);
    expect(required.retry()).toBe(task);
    item.value.kind = "loading";
    required.invalidate();
    expect(required.retry()).toBe(task);
    item.value.kind = "ready";
    required.invalidate();
    await task;
    expect(item.retry).toHaveBeenCalledTimes(1);
    required.dispose();
  });

  it("assigns flight before reentrant provider subscriptions and waits for retry promises", async () => {
    const item = resource("failed");
    const work = pending();
    const required = createRequiredLoading([item.provider]);
    let inner: Promise<void> | undefined;
    item.retry.mockImplementation(() => {
      item.value.kind = "ready";
      required.subscribe(() => {
        inner = required.retry();
      });
      required.invalidate();
      return work.promise;
    });
    const ready = vi.fn();
    required.wait(ready);
    const task = required.retry();
    expect(inner).toBe(task);
    expect(required.state.kind).toBe("loading");
    expect(ready).not.toHaveBeenCalled();
    work.resolve();
    await task;
    expect(ready).toHaveBeenCalledTimes(1);
    expect(item.retry).toHaveBeenCalledTimes(1);
    required.dispose();
  });

  it("settles disposal while retry promises remain pending and ignores late callbacks", async () => {
    const item = resource("failed");
    const work = pending();
    item.retry.mockReturnValue(work.promise);
    const required = createRequiredLoading([item.provider]);
    const listener = vi.fn();
    required.subscribe(listener);
    const ready = vi.fn();
    required.wait(ready);
    const task = required.retry();
    required.dispose();
    required.dispose();
    await task;
    const count = listener.mock.calls.length;
    work.reject(new Error("Late retry failure"));
    await Promise.resolve();
    item.value.kind = "ready";
    required.invalidate();
    required.observe(item.provider)();
    required.subscribe(listener)();
    required.wait(ready)();
    expect(required.state.kind).toBe("disposed");
    expect(listener).toHaveBeenCalledTimes(count);
    expect(ready).not.toHaveBeenCalled();
  });
});
