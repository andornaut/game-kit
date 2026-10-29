import { describe, expect, it } from "vitest";

import {
  createScreenWakeLock,
  type VisibilitySource,
  type WakeLockLike,
  type WakeLockSentinelLike,
} from "./wakeLock";

class FakeDocument extends EventTarget implements VisibilitySource {
  visibilityState: DocumentVisibilityState = "visible";

  setVisibility(state: DocumentVisibilityState): void {
    this.visibilityState = state;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}

class FakeSentinel extends EventTarget implements WakeLockSentinelLike {
  released = false;

  release(): Promise<void> {
    this.released = true;
    this.dispatchEvent(new Event("release"));
    return Promise.resolve();
  }
}

class FakeWakeLock implements WakeLockLike {
  refuse = false;
  readonly sentinels: FakeSentinel[] = [];

  request(): Promise<WakeLockSentinelLike> {
    if (this.refuse) {
      return Promise.reject(new Error("NotAllowedError"));
    }
    const sentinel = new FakeSentinel();
    this.sentinels.push(sentinel);
    return Promise.resolve(sentinel);
  }

  held(): FakeSentinel[] {
    return this.sentinels.filter((sentinel) => !sentinel.released);
  }
}

const settle = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

describe("createScreenWakeLock", () => {
  it("holds one lock while started and visible, and releases it on stop", async () => {
    const wakeLock = new FakeWakeLock();
    const screen = createScreenWakeLock(wakeLock, new FakeDocument());
    screen.start();
    screen.start();
    await settle();
    expect(wakeLock.held()).toHaveLength(1);
    expect(screen.isHeld()).toBe(true);
    screen.stop();
    expect(wakeLock.held()).toHaveLength(0);
    expect(screen.isHeld()).toBe(false);
  });

  it("requests a new lock each time the page becomes visible again", async () => {
    const wakeLock = new FakeWakeLock();
    const page = new FakeDocument();
    createScreenWakeLock(wakeLock, page).start();
    await settle();
    page.setVisibility("hidden");
    // The browser releases the lock itself when the page is hidden.
    await wakeLock.sentinels[0]?.release();
    page.setVisibility("visible");
    await settle();
    expect(wakeLock.sentinels).toHaveLength(2);
    expect(wakeLock.held()).toHaveLength(1);
  });

  it("does not request while the page is hidden", async () => {
    const wakeLock = new FakeWakeLock();
    const page = new FakeDocument();
    page.visibilityState = "hidden";
    createScreenWakeLock(wakeLock, page).start();
    await settle();
    expect(wakeLock.sentinels).toHaveLength(0);
  });

  it("releases a lock that arrives after stop", async () => {
    const wakeLock = new FakeWakeLock();
    const screen = createScreenWakeLock(wakeLock, new FakeDocument());
    screen.start();
    screen.stop();
    await settle();
    expect(wakeLock.sentinels).toHaveLength(1);
    expect(wakeLock.held()).toHaveLength(0);
  });

  it("stays quiet when the browser refuses or has no API", async () => {
    const wakeLock = new FakeWakeLock();
    wakeLock.refuse = true;
    const refused = createScreenWakeLock(wakeLock, new FakeDocument());
    refused.start();
    await settle();
    expect(refused.isHeld()).toBe(false);

    const unsupported = createScreenWakeLock(undefined, new FakeDocument());
    unsupported.start();
    expect(unsupported.isHeld()).toBe(false);
  });
});
