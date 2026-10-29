// Keeps the screen on while a game wants it (start and stop, such as during play) and the page is
// visible.

// The page's visibility, as document reports it, so tests can pass a fake.
export interface VisibilitySource extends EventTarget {
  readonly visibilityState: DocumentVisibilityState;
}

// The parts of the Screen Wake Lock API this uses, so tests can pass a fake.
export interface WakeLockSentinelLike extends EventTarget {
  release(): Promise<void>;
}

export interface WakeLockLike {
  request(type: "screen"): Promise<WakeLockSentinelLike>;
}

export interface ScreenWakeLock {
  // Whether a lock is held right now.
  isHeld(): boolean;
  // Keep the screen on while the page is visible, until stop.
  start(): void;
  // Let the screen sleep.
  stop(): void;
}

// The browser releases a screen wake lock whenever the page is hidden, so this re-requests it
// each time the page becomes visible while started. A browser without the API, or one that
// refuses (battery saver, no secure context), leaves the screen to sleep as usual.
export function createScreenWakeLock(
  wakeLock: WakeLockLike | undefined,
  visibilitySource: VisibilitySource,
): ScreenWakeLock {
  let wanted = false;
  let sentinel: WakeLockSentinelLike | undefined;
  let requesting = false;

  const release = () => {
    const held = sentinel;
    sentinel = undefined;
    held?.release().catch(() => {});
  };

  const sync = () => {
    const shouldHold = wanted && visibilitySource.visibilityState === "visible";
    if (!shouldHold) {
      release();
      return;
    }
    if (wakeLock === undefined || sentinel !== undefined || requesting) {
      return;
    }
    requesting = true;
    // A refusal is not retried until the next start or visibility change.
    wakeLock.request("screen").then(
      (acquired) => {
        requesting = false;
        acquired.addEventListener("release", () => {
          if (sentinel === acquired) {
            sentinel = undefined;
          }
        });
        sentinel = acquired;
        // Releases it again if stop was called while the request was pending.
        sync();
      },
      () => {
        requesting = false;
      },
    );
  };

  visibilitySource.addEventListener("visibilitychange", sync);

  return {
    isHeld: () => sentinel !== undefined,
    start() {
      wanted = true;
      sync();
    },
    stop() {
      wanted = false;
      sync();
    },
  };
}
