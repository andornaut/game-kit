import { describe, expect, it, vi } from "vitest";

import {
  createLoadingAttempts,
  type LoadingAttempt,
  type LoadingAttemptState,
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
