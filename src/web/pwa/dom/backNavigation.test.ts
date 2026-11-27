import { describe, expect, it, vi } from "vitest";

import { createBackNavigationGuard, guardBackNavigation } from "./backNavigation.ts";

describe("guardBackNavigation", () => {
  it("uses the injected history to restore the guard on back", () => {
    const target = new EventTarget();
    const history = {
      length: 1,
      pushState: vi.fn((state: unknown) => {
        history.state = state;
      }),
      state: null as unknown,
    };
    const onBack = vi.fn();
    guardBackNavigation(
      {
        createCloseWatcher: undefined,
        history,
        onBack,
        stateKey: "gameGuard",
        timer: { setTimeout: vi.fn() },
      },
      target,
    );

    expect(history.pushState).not.toHaveBeenCalled();
    target.dispatchEvent(new Event("pointerup"));
    expect(history.pushState).toHaveBeenCalledWith({ gameGuard: true }, "");

    history.state = null;
    target.dispatchEvent(new Event("popstate"));
    expect(history.pushState).toHaveBeenCalledTimes(2);
    expect(history.state).toEqual({ gameGuard: true });
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("uses the injected close watcher and timer to suppress only the Escape close", () => {
    const target = new EventTarget();
    const first = new EventTarget();
    const second = new EventTarget();
    const createCloseWatcher = vi
      .fn(() => new EventTarget())
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const history = { length: 1, pushState: vi.fn(), state: null };
    const onBack = vi.fn();
    const setTimeout = vi.fn<(handler: () => void, ms: number) => void>();
    guardBackNavigation(
      { createCloseWatcher, history, onBack, stateKey: "gameGuard", timer: { setTimeout } },
      target,
    );

    expect(createCloseWatcher).toHaveBeenCalledOnce();
    target.dispatchEvent(Object.assign(new Event("keydown"), { key: "Escape" }));
    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 0);
    first.dispatchEvent(new Event("close"));
    expect(onBack).not.toHaveBeenCalled();
    expect(createCloseWatcher).toHaveBeenCalledTimes(2);

    setTimeout.mock.calls[0]?.[0]();
    second.dispatchEvent(new Event("close"));
    expect(onBack).toHaveBeenCalledOnce();
    expect(history.pushState).not.toHaveBeenCalled();
  });
});

function trusted(type: string, fields: object = {}, cancelable = true): Event {
  return Object.assign(
    Object.defineProperty(new Event(type, { cancelable }), "isTrusted", { value: true }),
    fields,
  );
}

class KeyedHistory extends EventTarget {
  #index = 1;
  #sequence = 0;
  #makeEntry(state: unknown) {
    const id = String(++this.#sequence);
    return { id, key: id, sameDocument: true, state };
  }
  #entries = [this.#makeEntry(null), this.#makeEntry(null)];
  constructor(singleEntry = false) {
    super();
    if (singleEntry) {
      this.#entries.pop();
      this.#index = 0;
    }
  }
  get length() {
    return this.#entries.length;
  }
  get state() {
    return this.#entries[this.#index]!.state;
  }
  get currentEntry() {
    return { ...this.#entries[this.#index]!, index: this.#index };
  }
  entries() {
    return this.#entries.map((entry, index) => ({ ...entry, index }));
  }
  replaceFirstEntry() {
    this.#entries[0] = this.#makeEntry(null);
  }
  pushState = vi.fn((state: unknown) => {
    const from = this.currentEntry;
    this.#entries.splice(++this.#index, this.length, this.#makeEntry(state));
    this.dispatchEvent(trusted("currententrychange", { from, navigationType: "push" }));
  });
  #queued: (() => void)[] = [];
  traverseTo = vi.fn((key: string, { info }: { info: object }) => {
    let finish!: (entry: KeyedHistory["currentEntry"]) => void;
    const promise = new Promise<KeyedHistory["currentEntry"]>((resolve) => {
      finish = resolve;
    });
    this.#queued.push(() => {
      const index = this.#entries.findIndex((entry) => entry.key === key);
      if (index !== -1 && index !== this.#index) {
        this.move(index, { info });
      }
      finish(this.currentEntry);
    });
    return { committed: promise, finished: promise };
  });
  finishCleanup() {
    this.#queued.shift()?.();
  }
  move(
    index: number,
    {
      cancelable,
      ...navigate
    }: { cancelable?: boolean; info?: object; userInitiated?: boolean } = {},
  ) {
    const from = this.currentEntry;
    const event = trusted(
      "navigate",
      {
        destination: this.entries()[index],
        navigationType: "traverse",
        signal: new AbortController().signal,
        ...navigate,
      },
      cancelable ?? !navigate.userInitiated,
    );
    if (this.dispatchEvent(event)) {
      this.#index = index;
      this.dispatchEvent(trusted("currententrychange", { from, navigationType: "traverse" }));
    }
    return event;
  }
}

class TestWatcher extends EventTarget {
  destroy = vi.fn();
}

function fixture({
  createCloseWatcher,
  history = new KeyedHistory(),
  installed,
  keyed = true,
  onBack = vi.fn(),
}: {
  createCloseWatcher?: () => TestWatcher;
  keyed?: boolean;
  onBack?: () => void;
  history?: KeyedHistory;
  installed?: { readonly closes: boolean; readonly userAgent: string };
} = {}) {
  const target = Object.assign(new EventTarget(), keyed ? { navigation: history } : {});
  const app = {
    close: vi.fn(() => {
      app.closed = installed?.closes === true;
    }),
    closed: false,
    history,
    matchMedia: () => ({ matches: true }),
    navigator: { maxTouchPoints: 0, userAgent: installed?.userAgent ?? "" },
  };
  if (installed !== undefined) {
    Object.assign(target, app);
    Object.defineProperty(target, "closed", { get: () => app.closed });
  }
  const timers: (() => void)[] = [];
  const guard = createBackNavigationGuard(
    {
      createCloseWatcher,
      history,
      onBack,
      stateKey: "game",
      timer: {
        setTimeout: (handler) => timers.push(handler),
      },
    },
    target,
  );
  return {
    close: app.close,
    guard,
    history,
    onBack,
    target,
    flushInputTask: () => timers.splice(0).forEach((run) => run()),
    flushOneTimer: () => timers.shift()?.(),
    gesture: () => target.dispatchEvent(trusted("pointerdown", { pointerType: "mouse" })),
  };
}

describe("createBackNavigationGuard", () => {
  it("arms in the captured trusted entry gesture and releases the exact marker once on Home", async () => {
    const { flushInputTask, gesture, guard, history, onBack, target } = fixture();
    const base = history.currentEntry;
    const activatePlay = () => guard.setEnabled(true);
    target.addEventListener("pointerdown", activatePlay, { once: true });
    gesture();
    expect(history.pushState).toHaveBeenCalledOnce();
    expect(history.currentEntry.index).toBe(base.index + 1);
    gesture();
    expect(history.pushState).toHaveBeenCalledOnce();

    guard.setEnabled(false);
    guard.setEnabled(false);
    expect(history.traverseTo).toHaveBeenCalledExactlyOnceWith(base.key, { info: {} });
    history.finishCleanup();
    await Promise.resolve();
    await Promise.resolve();
    expect(history.currentEntry.id).toBe(base.id);
    expect(history.state).toBeNull();
    expect(onBack).not.toHaveBeenCalled();
    flushInputTask();
    history.move(base.index + 1, { userInitiated: true });
    gesture();
    guard.setEnabled(true);
    expect(history.pushState).toHaveBeenCalledOnce();
    expect(onBack).not.toHaveBeenCalled();
    guard.dispose();
    expect(history.traverseTo).toHaveBeenCalledOnce();
  });

  it("abandons a queued cleanup after a competing traversal leaves the marker, even after dispose", () => {
    const { gesture, guard, history, onBack } = fixture();
    guard.setEnabled(true);
    gesture();
    guard.dispose();
    expect(history.traverseTo).toHaveBeenCalledOnce();
    history.move(1);
    history.move(0);
    history.finishCleanup();
    expect(history.currentEntry.index).toBe(0);
    expect(onBack).not.toHaveBeenCalled();
    gesture();
    guard.setEnabled(true);
    expect(history.pushState).toHaveBeenCalledOnce();
  });

  it("does not rearm during an unwind or reuse an expired gesture when play resumes", async () => {
    const { flushInputTask, gesture, guard, history } = fixture();
    guard.setEnabled(true);
    gesture();
    guard.setEnabled(false);
    guard.setEnabled(true);
    gesture();
    expect(history.pushState).toHaveBeenCalledOnce();
    flushInputTask();
    history.finishCleanup();
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(history.pushState).toHaveBeenCalledOnce();
    gesture();
    expect(history.pushState).toHaveBeenCalledTimes(2);
    expect(history.length).toBe(3);
    guard.dispose();
    history.finishCleanup();
  });

  it("restores only the exact marker consumed by a noncancelable user Back", async () => {
    const { flushInputTask, gesture, guard, history, onBack, target } = fixture();
    guard.setEnabled(true);
    gesture();
    const marker = history.currentEntry;
    history.move(1, { userInitiated: true });
    flushInputTask();
    expect(history.traverseTo).toHaveBeenCalledExactlyOnceWith(marker.key, { info: {} });
    history.finishCleanup();
    await vi.waitFor(() => expect(onBack).toHaveBeenCalledOnce());
    target.dispatchEvent(trusted("keydown", { key: "Escape" }));
    flushInputTask();
    expect(history.currentEntry.id).toBe(marker.id);
    history.move(1, { cancelable: true, userInitiated: true });
    flushInputTask();
    expect(onBack).toHaveBeenCalledTimes(2);
    expect(history.pushState).toHaveBeenCalledOnce();
    guard.dispose();
    history.finishCleanup();
  });

  it("ignores foreign traversals, including browser forward onto an old marker", () => {
    const { gesture, guard, history, onBack } = fixture();
    guard.setEnabled(true);
    gesture();
    history.move(1);
    history.move(2, { userInitiated: true });
    history.move(1, { userInitiated: true });
    gesture();
    history.move(0, { userInitiated: true });
    expect(onBack).not.toHaveBeenCalled();
    expect(history.traverseTo).not.toHaveBeenCalled();
    guard.dispose();
  });

  it("leaves unrelated forward entries and old marker states alone", () => {
    const history = new KeyedHistory();
    history.pushState({ game: true });
    history.move(1);
    const { gesture, guard, onBack } = fixture({ history });
    guard.setEnabled(true);
    gesture();
    expect(history.pushState).toHaveBeenCalledOnce();
    history.move(2, { userInitiated: true });
    gesture();
    guard.setEnabled(false);
    expect(history.pushState).toHaveBeenCalledOnce();
    expect(history.traverseTo).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
    guard.dispose();
  });

  it("skips history on unsupported hosts and never treats synthetic or stale input as activation", () => {
    const native = fixture({ keyed: false });
    native.guard.setEnabled(true);
    native.gesture();
    native.target.dispatchEvent(trusted("popstate"));
    native.guard.dispose();
    expect(native.history.pushState).not.toHaveBeenCalled();
    expect(native.history.traverseTo).not.toHaveBeenCalled();
    expect(native.onBack).not.toHaveBeenCalled();

    const { flushInputTask, gesture, guard, history, target } = fixture();
    gesture();
    flushInputTask();
    guard.setEnabled(true);
    target.dispatchEvent(new Event("mousedown"));
    target.dispatchEvent(trusted("pointerdown", { pointerType: "touch" }));
    target.dispatchEvent(trusted("keydown", { key: "Escape" }));
    expect(history.pushState).not.toHaveBeenCalled();
    target.dispatchEvent(trusted("pointerup", { pointerType: "touch" }));
    expect(history.pushState).toHaveBeenCalledOnce();
    guard.dispose();
    history.finishCleanup();
  });

  it("destroys watchers across Escape, reentrant scope changes and disposal", () => {
    const watchers: TestWatcher[] = [];
    const createCloseWatcher = vi.fn(() => {
      const watcher = new TestWatcher();
      watchers.push(watcher);
      return watcher;
    });
    const onBack = vi.fn(() => {
      guard.setEnabled(false);
      guard.setEnabled(true);
    });
    const { flushInputTask, flushOneTimer, guard, target } = fixture({
      createCloseWatcher,
      keyed: false,
      onBack,
    });
    expect(createCloseWatcher).not.toHaveBeenCalled();
    guard.setEnabled(true);
    target.dispatchEvent(trusted("keydown", { key: "Escape" }));
    watchers[0]!.dispatchEvent(new Event("close"));
    expect(onBack).not.toHaveBeenCalled();
    expect(watchers[0]!.destroy).toHaveBeenCalledOnce();

    target.dispatchEvent(trusted("keydown", { key: "Escape" }));
    // The first Escape's timer must not end the more recent Escape's deduplication.
    flushOneTimer();
    watchers[0]!.dispatchEvent(new Event("close"));
    watchers[1]!.dispatchEvent(new Event("close"));
    expect(onBack).not.toHaveBeenCalled();
    flushInputTask();
    watchers[2]!.dispatchEvent(new Event("close"));
    expect(onBack).toHaveBeenCalledOnce();
    expect(createCloseWatcher).toHaveBeenCalledTimes(4);
    guard.dispose();
    watchers[3]!.dispatchEvent(new Event("close"));
    guard.setEnabled(true);
    expect(onBack).toHaveBeenCalledOnce();
    expect(watchers.every((watcher) => watcher.destroy.mock.calls.length === 1)).toBe(true);
  });
});

describe("confirmed departure", () => {
  it("keeps the marker on cancelable browser Back so Cancel needs no rearm", () => {
    const { flushInputTask, gesture, guard, history, onBack } = fixture();
    guard.setEnabled(true);
    gesture();
    const marker = history.currentEntry;
    expect(history.move(1, { cancelable: true, userInitiated: true }).defaultPrevented).toBe(true);
    flushInputTask();
    expect(history.currentEntry.id).toBe(marker.id);
    expect(history.pushState).toHaveBeenCalledOnce();
    expect(onBack).toHaveBeenCalledOnce();
    guard.dispose();
    history.finishCleanup();
  });

  it.each([true, false])(
    "runs the supported one-entry standalone close, result %s",
    async (closes) => {
      const watchers: TestWatcher[] = [];
      const createCloseWatcher = () => {
        const watcher = new TestWatcher();
        watchers.push(watcher);
        return watcher;
      };
      let confirmation: Promise<boolean> | undefined;
      const onBack = vi.fn(() => {
        if (watchers.length === 2) {
          confirmation = guard.leave();
        }
      });
      const { close, gesture, guard, history } = fixture({
        createCloseWatcher,
        history: new KeyedHistory(true),
        installed: { closes, userAgent: "Chrome/159.0" },
        keyed: false,
        onBack,
      });
      expect(guard.canLeave()).toBe(false);
      guard.setEnabled(true);
      gesture();
      watchers[0]!.dispatchEvent(new Event("close")); // Cancel keeps the scope enabled.
      expect(onBack).toHaveBeenCalledOnce();
      expect(guard.canLeave()).toBe(true);

      watchers[1]!.dispatchEvent(new Event("close"));
      expect(await confirmation).toBe(closes);
      expect(close).toHaveBeenCalledOnce();
      expect(watchers[1]!.destroy).toHaveBeenCalledOnce();
      expect(guard.canLeave()).toBe(!closes);
      expect(watchers).toHaveLength(closes ? 2 : 3);
      expect(history.pushState).not.toHaveBeenCalled();
      expect(history.traverseTo).not.toHaveBeenCalled();
      guard.dispose();
    },
  );

  it("gates departure on the base predecessor, not the marker or history length", async () => {
    const { close, gesture, guard, history } = fixture({ history: new KeyedHistory(true) });
    guard.setEnabled(true);
    gesture();
    const marker = history.currentEntry;
    expect(history.length).toBe(2);
    expect(guard.canLeave()).toBe(false);
    expect(await guard.leave()).toBe(false);
    expect(history.currentEntry.id).toBe(marker.id);
    expect(history.traverseTo).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    guard.dispose();
    history.finishCleanup();
  });

  it.each([undefined, "Firefox/156.0 Android", "Chrome/159.0"])(
    "keeps the scope when neither a keyed predecessor nor supported close is available (%s)",
    async (userAgent) => {
      const { close, guard, history } = fixture({
        ...(userAgent === undefined ? {} : { installed: { closes: true, userAgent } }),
        keyed: false,
      });
      guard.setEnabled(true);
      expect(guard.canLeave()).toBe(false);
      expect(await guard.leave()).toBe(false);
      expect(close).not.toHaveBeenCalled();
      expect(history.traverseTo).not.toHaveBeenCalled();
      guard.dispose();
    },
  );

  it("makes one ordinary keyed departure to the live predecessor after the marker drains", async () => {
    const { gesture, guard, history, onBack } = fixture();
    const base = history.currentEntry;
    const previous = history.entries()[base.index - 1]!;
    guard.setEnabled(true);
    expect(guard.canLeave()).toBe(true);
    gesture();
    const confirmed = guard.leave();
    expect(await guard.leave()).toBe(false);
    expect(history.traverseTo).toHaveBeenCalledExactlyOnceWith(base.key, { info: {} });
    history.finishCleanup();
    await vi.waitFor(() => expect(history.traverseTo).toHaveBeenCalledTimes(2));
    expect(history.traverseTo).toHaveBeenLastCalledWith(previous.key, { info: {} });
    expect(history.currentEntry.id).toBe(base.id);
    history.finishCleanup();
    expect(await confirmed).toBe(true);
    expect(history.currentEntry.id).toBe(previous.id);
    expect(await guard.leave()).toBe(false);
    expect(onBack).not.toHaveBeenCalled();
    guard.dispose();
  });

  it("restores the exact marker when the final traversal is canceled", async () => {
    const { gesture, guard, history, onBack } = fixture();
    const base = history.currentEntry;
    const previous = history.entries()[base.index - 1]!;
    guard.setEnabled(true);
    gesture();
    const marker = history.currentEntry;
    history.addEventListener("navigate", (event) => {
      if ((event as Event & { destination?: { id: string } }).destination?.id === previous.id) {
        event.preventDefault();
      }
    });
    const confirmed = guard.leave();
    history.finishCleanup();
    await vi.waitFor(() => expect(history.traverseTo).toHaveBeenCalledTimes(2));
    history.finishCleanup();
    await vi.waitFor(() => expect(history.traverseTo).toHaveBeenCalledTimes(3));
    expect(history.traverseTo).toHaveBeenLastCalledWith(marker.key, { info: {} });
    history.finishCleanup();
    expect(await confirmed).toBe(false);
    expect(history.currentEntry.id).toBe(marker.id);
    expect(guard.canLeave()).toBe(true);
    expect(onBack).not.toHaveBeenCalled();
    guard.dispose();
    history.finishCleanup();
  });

  it("restores the marker without submitting Back when the selected predecessor changes", async () => {
    const { gesture, guard, history } = fixture();
    guard.setEnabled(true);
    gesture();
    const marker = history.currentEntry;
    const confirmed = guard.leave();
    history.finishCleanup();
    history.replaceFirstEntry();
    await vi.waitFor(() => expect(history.traverseTo).toHaveBeenCalledTimes(2));
    expect(history.traverseTo).toHaveBeenLastCalledWith(marker.key, { info: {} });
    history.finishCleanup();
    expect(await confirmed).toBe(false);
    expect(history.currentEntry.id).toBe(marker.id);
    guard.dispose();
    history.finishCleanup();
  });

  it.each(["competing traversal", "resume", "dispose"] as const)(
    "drops the pending departure on %s",
    async (interruption) => {
      const { gesture, guard, history } = fixture();
      guard.setEnabled(true);
      gesture();
      const confirmed = guard.leave();
      if (interruption === "competing traversal") {
        history.move(1);
      } else if (interruption === "resume") {
        guard.setEnabled(false);
        guard.setEnabled(true);
      } else {
        guard.dispose();
      }
      history.finishCleanup();
      expect(await confirmed).toBe(false);
      expect(history.traverseTo).toHaveBeenCalledOnce();
      guard.dispose();
    },
  );

  it("does not depart through an inert marker from another session", async () => {
    const history = new KeyedHistory();
    history.pushState({ game: "game-kit-back:retired" });
    const { gesture, guard } = fixture({ history });
    guard.setEnabled(true);
    gesture();
    expect(guard.canLeave()).toBe(false);
    expect(await guard.leave()).toBe(false);
    expect(history.traverseTo).not.toHaveBeenCalled();
    guard.dispose();
  });
});
