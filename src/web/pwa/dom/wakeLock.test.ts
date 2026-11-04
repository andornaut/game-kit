import { describe, expect, it } from "vitest";

import type { VisibilitySource } from "./visibility.ts";
import { createScreenWakeLock, type WakeLockLike, type WakeLockSentinelLike } from "./wakeLock.ts";

class FakeDocument extends EventTarget implements VisibilitySource {
  visibilityState: DocumentVisibilityState = "visible";
}

class FakeSentinel extends EventTarget implements WakeLockSentinelLike {
  released = false;

  release(): Promise<void> {
    this.released = true;
    return Promise.resolve();
  }
}

// A wake lock API that grants each request, or refuses them all.
class FakeWakeLock implements WakeLockLike {
  readonly sentinels: FakeSentinel[] = [];

  constructor(private readonly grants: boolean) {}

  request(): Promise<WakeLockSentinelLike> {
    if (!this.grants) {
      return Promise.reject(new Error("refused"));
    }
    const sentinel = new FakeSentinel();
    this.sentinels.push(sentinel);
    return Promise.resolve(sentinel);
  }
}

const settle = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

// A step: start or stop, a window event, or a visibilitychange to a state.
type Step = "pagehide" | "pageshow" | "start" | "stop" | DocumentVisibilityState;

describe("createScreenWakeLock", () => {
  it.each<[string, Step[], boolean, number]>([
    ["holds a lock once started", ["start"], true, 1],
    ["holds none before start", [], false, 0],
    ["releases the lock on stop", ["start", "stop"], false, 1],
    ["releases the lock when hidden", ["start", "hidden"], false, 1],
    ["requests again when shown", ["start", "hidden", "visible"], true, 2],
    ["releases the lock on pagehide", ["start", "pagehide"], false, 1],
    ["requests again on pageshow", ["start", "pagehide", "pageshow"], true, 2],
    ["waits for the page to show when started hidden", ["hidden", "start"], false, 0],
    ["requests none when shown while stopped", ["hidden", "visible"], false, 0],
  ])("%s", async (_, steps, held, requests) => {
    const page = new EventTarget();
    const document = new FakeDocument();
    const api = new FakeWakeLock(true);
    const lock = createScreenWakeLock(page, document, api);
    for (const step of steps) {
      if (step === "start" || step === "stop") {
        lock[step]();
      } else if (step === "pagehide" || step === "pageshow") {
        page.dispatchEvent(new Event(step));
      } else {
        document.visibilityState = step;
        document.dispatchEvent(new Event("visibilitychange"));
      }
      // eslint-disable-next-line no-await-in-loop
      await settle();
    }
    expect({ held: lock.isHeld(), requests: api.sentinels.length }).toEqual({ held, requests });
    expect(api.sentinels.slice(0, -1).every((sentinel) => sentinel.released)).toBe(true);
  });

  it("releases a lock granted after stop", async () => {
    const api = new FakeWakeLock(true);
    const lock = createScreenWakeLock(new EventTarget(), new FakeDocument(), api);
    lock.start();
    lock.stop();
    await settle();
    expect([lock.isHeld(), api.sentinels.map(({ released }) => released)]).toEqual([false, [true]]);
  });

  it.each<[string, WakeLockLike | undefined]>([
    ["a refusal", new FakeWakeLock(false)],
    ["a browser without the API", undefined],
  ])("holds nothing after %s", async (_, api) => {
    const lock = createScreenWakeLock(new EventTarget(), new FakeDocument(), api);
    lock.start();
    await settle();
    expect(lock.isHeld()).toBe(false);
  });
});
