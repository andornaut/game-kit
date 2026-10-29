import { describe, expect, it } from "vitest";

import {
  BACK_GUARD_GESTURES,
  backCloseWatcher,
  backGuardState,
  browserCloseWatcher,
  type CloseWatcherLike,
  guardBackNavigation,
  type HistoryLike,
  INSTALLED_APP_DISPLAY_QUERY,
  isFirefoxAndroidApp,
  type LeaveHost,
} from "./backNavigation";
// The guard entry's state key, and what seen records for each back the guard keeps on the game.
const STATE_KEY = "testGameBackGuard";
const BACK = "back";

// Options that record each back in seen.
function recordBacks(seen: string[]) {
  return { onBack: () => seen.push(BACK), stateKey: STATE_KEY };
}

// The page's session history: the previous page's entry, if the game was opened from one, then
// the game's own entries. Going back past the game's first entry leaves the page, which hides it;
// going further than the history reaches does nothing, and the user's back there is the
// browser's own (an installed app closes), which systemBacks counts. The user's back, as in
// Firefox, reaches only an entry the user interacted with while it was current, and is the
// browser's own when no entry before the current one has interaction.
class FakeHistory extends EventTarget implements HistoryLike {
  systemBacks = 0;
  private readonly entries: { interacted: boolean; page: "game" | "previous"; state: unknown }[];
  private index: number;

  constructor(previous: boolean) {
    super();
    const game = { interacted: false, page: "game", state: null } as const;
    this.entries = previous
      ? [{ interacted: true, page: "previous", state: null }, { ...game }]
      : [{ ...game }];
    this.index = this.entries.length - 1;
  }

  // Whether the user's back stays in the history: an entry before the current one has
  // interaction.
  get canGoBack(): boolean {
    return this.entries.slice(0, this.index).some(({ interacted }) => interacted);
  }

  get gameEntries(): number {
    return this.entries.filter(({ page }) => page === "game").length;
  }

  get left(): boolean {
    return this.entries[this.index]?.page === "previous";
  }

  get length(): number {
    return this.entries.length;
  }

  get state(): unknown {
    return this.entries[this.index]?.state;
  }

  // The user's back: over entries without interaction, and the browser's own where none before
  // the current one has it.
  back(): void {
    if (!this.canGoBack) {
      this.systemBacks += 1;
      return;
    }
    let target = this.index - 1;
    while (this.entries[target]?.interacted !== true) {
      target -= 1;
    }
    this.go(target - this.index);
  }

  // The player's input, recorded on the current entry.
  interact(): void {
    const entry = this.entries[this.index];
    if (entry !== undefined) {
      entry.interacted = true;
    }
  }

  go(delta: number): void {
    const target = this.entries[this.index + delta];
    if (target === undefined) {
      return;
    }
    this.index += delta;
    this.dispatchEvent(new Event(target.page === "previous" ? "pagehide" : "popstate"));
  }

  pushState(data: unknown): void {
    this.entries.splice(this.index + 1, Infinity, {
      interacted: false,
      page: "game",
      state: data,
    });
    this.index += 1;
  }
}

class FakeCloseWatcher extends EventTarget implements CloseWatcherLike {
  destroyed = false;

  destroy(): void {
    this.destroyed = true;
  }
}

// The browser's close watchers: a close request spends the newest active one, firing its close.
class FakeCloseWatchers {
  private readonly watchers: FakeCloseWatcher[] = [];

  get active(): number {
    return this.watchers.filter(({ destroyed }) => !destroyed).length;
  }

  get created(): number {
    return this.watchers.length;
  }

  readonly create = (): CloseWatcherLike => {
    const watcher = new FakeCloseWatcher();
    this.watchers.push(watcher);
    return watcher;
  };

  // A close request: whether a watcher took it.
  request(): boolean {
    const watcher = this.watchers.filter(({ destroyed }) => !destroyed).at(-1);
    if (watcher === undefined) {
      return false;
    }
    watcher.destroy();
    watcher.dispatchEvent(new Event("close"));
    return true;
  }
}

// Runs what leaving waits for when told to, and counts the window's closes.
class FakeLeaveHost implements LeaveHost {
  closes = 0;
  private readonly waiting: (() => void)[] = [];

  close(): void {
    this.closes += 1;
  }

  setTimeout(handler: () => void): void {
    this.waiting.push(handler);
  }

  wait(): void {
    this.waiting.splice(0).forEach((handler) => handler());
  }
}

const CHROME_ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
const FIREFOX_ANDROID_UA = "Mozilla/5.0 (Android 15; Mobile; rv:150.0) Gecko/150.0 Firefox/150.0";

// A browser with CloseWatcher or without, Chrome's user agent or Firefox for Android's.
interface Browser {
  closeWatcher: boolean;
  firefoxAndroid?: boolean;
  previous: boolean;
}

describe("guardBackNavigation", () => {
  // A page in a browser opened from a previous page or with nothing before the game (an
  // installed app's launch, or a tab opened on the game).
  function open({ closeWatcher, firefoxAndroid = false, previous }: Browser) {
    const history = new FakeHistory(previous);
    const host = new FakeLeaveHost();
    const watchers = closeWatcher ? new FakeCloseWatchers() : undefined;
    const seen: string[] = [];
    const userAgent = firefoxAndroid ? FIREFOX_ANDROID_UA : CHROME_ANDROID_UA;
    const guard = guardBackNavigation(
      recordBacks(seen),
      history,
      host,
      backCloseWatcher(userAgent, watchers?.create),
      history,
    );
    // The Android back gesture: a close request, which the history takes when no watcher does.
    // Firefox for Android makes one only when its history can go back, and is otherwise the
    // browser's own.
    const back = () => {
      if (firefoxAndroid && !history.canGoBack) {
        history.systemBacks += 1;
        return;
      }
      if (watchers?.request() !== true) {
        history.back();
      }
    };
    // A key press, or with no key a tap, whose pointerdown the browser records on no entry and
    // whose pointerup it records on the current one before the page sees it. Escape is no user
    // activation.
    const input = (key?: string) => {
      if (key === undefined) {
        history.dispatchEvent(new Event("pointerdown"));
        history.interact();
        history.dispatchEvent(new Event("pointerup"));
        return;
      }
      if (key !== "Escape") {
        history.interact();
      }
      history.dispatchEvent(Object.assign(new Event("keydown"), { key }));
    };
    return { back, guard, history, host, input, seen, watchers };
  }

  // One with the player's first input given.
  function played(browser: Browser) {
    const page = open(browser);
    page.input();
    return page;
  }

  const BROWSERS: Browser[] = [
    { closeWatcher: false, previous: false },
    { closeWatcher: false, previous: true },
    { closeWatcher: true, previous: false },
    { closeWatcher: true, previous: true },
    { closeWatcher: true, firefoxAndroid: true, previous: false },
    { closeWatcher: true, firefoxAndroid: true, previous: true },
  ];

  // Whether the browser catches back with close watchers, so the guard entry is needed only with
  // a previous page.
  const watchesClose = ({ closeWatcher, firefoxAndroid = false }: Browser) =>
    closeWatcher && !firefoxAndroid;

  // A guard entry only where a close watcher does not catch back, or a previous page means the
  // window could not close anyway.
  it.each(BROWSERS)(
    "CloseWatcher $closeWatcher, Firefox Android $firefoxAndroid, previous $previous: stays through each back",
    (browser) => {
      const { back, history, seen } = played(browser);
      back();
      back();
      expect({
        gameEntries: history.gameEntries,
        left: history.left,
        seen,
        systemBacks: history.systemBacks,
      }).toEqual({
        gameEntries: watchesClose(browser) && !browser.previous ? 1 : 2,
        left: false,
        seen: [BACK, BACK],
        systemBacks: 0,
      });
    },
  );

  it.each([
    { closeWatcher: true, name: "Chrome", userAgent: CHROME_ANDROID_UA, watches: true },
    { closeWatcher: true, name: "Firefox", userAgent: FIREFOX_ANDROID_UA, watches: false },
    { closeWatcher: false, name: "Chrome", userAgent: CHROME_ANDROID_UA, watches: false },
  ])(
    "$name for Android with CloseWatcher $closeWatcher catches back with close watchers $watches",
    ({ closeWatcher, userAgent, watches }) => {
      const create = closeWatcher ? new FakeCloseWatchers().create : undefined;
      expect(backCloseWatcher(userAgent, create) !== undefined).toBe(watches);
    },
  );

  it.each([
    { app: true, firefoxApp: false, name: "Chrome", userAgent: CHROME_ANDROID_UA },
    { app: false, firefoxApp: false, name: "Firefox", userAgent: FIREFOX_ANDROID_UA },
    { app: true, firefoxApp: true, name: "Firefox", userAgent: FIREFOX_ANDROID_UA },
  ])("$name for Android, installed $app, is Firefox's installed app $firefoxApp", (row) => {
    const asked: string[] = [];
    const displayModeMatches = (query: string) => {
      asked.push(query);
      return row.app;
    };
    expect(isFirefoxAndroidApp(row.userAgent, displayModeMatches)).toBe(row.firefoxApp);
    expect(asked.every((query) => query === INSTALLED_APP_DISPLAY_QUERY)).toBe(true);
  });

  // A desktop browser's Back is no close request: the guard entry takes it.
  it.each([false, true])(
    "with a previous page and CloseWatcher %s, the browser's Back stays on the game",
    (closeWatcher) => {
      const { history, seen } = played({ closeWatcher, previous: true });
      history.back();
      expect({ left: history.left, seen }).toEqual({
        left: false,
        seen: [BACK],
      });
    },
  );

  // With nothing before the game, a close at once where the history holds one entry, or, after
  // stepping back over the guard, one the browser may refuse, the game left on its own entry.
  it.each([
    { closeWatcher: false, closes: [0, 1], left: false, previous: false },
    { closeWatcher: false, closes: [0, 0], left: true, previous: true },
    { closeWatcher: true, closes: [1, 1], left: false, previous: false },
    { closeWatcher: true, closes: [0, 0], left: true, previous: true },
    { closeWatcher: true, closes: [0, 1], firefoxAndroid: true, left: false, previous: false },
    { closeWatcher: true, closes: [0, 0], firefoxAndroid: true, left: true, previous: true },
  ])(
    "CloseWatcher $closeWatcher, Firefox Android $firefoxAndroid, previous $previous: leaving closes $closes",
    (row) => {
      const { guard, history, host, seen } = played(row);
      guard.leave();
      const closesAtOnce = host.closes;
      host.wait();
      expect({
        closes: [closesAtOnce, host.closes],
        left: history.left,
        seen,
        state: history.state,
      }).toEqual({ closes: row.closes, left: row.left, seen: [], state: null });
    },
  );

  // Where the window stays after leaving, the next back is the system's, which closes an
  // installed app, unless an input first restores the guard or the watcher.
  it.each(
    BROWSERS.filter(({ previous }) => !previous).flatMap((browser) => [
      { ...browser, input: false },
      { ...browser, input: true },
    ]),
  )(
    "CloseWatcher $closeWatcher, Firefox Android $firefoxAndroid: after leaving, input $input before back",
    (row) => {
      const { back, guard, history, host, input, seen } = played({ ...row, previous: false });
      guard.leave();
      host.wait();
      if (row.input) {
        input();
      }
      back();
      expect({ seen, systemBacks: history.systemBacks }).toEqual({
        seen: row.input ? [BACK] : [],
        systemBacks: row.input ? 0 : 1,
      });
    },
  );

  // The guard waits for input; a close watcher needs none.
  it.each([
    { closeWatcher: false, presses: [], watching: 0 },
    { closeWatcher: true, presses: [BACK], watching: 1 },
    { closeWatcher: true, firefoxAndroid: true, presses: [], watching: 0 },
  ])(
    "CloseWatcher $closeWatcher, Firefox Android $firefoxAndroid: back before any input presses $presses",
    (row) => {
      const { back, history, seen, watchers } = open({ ...row, previous: false });
      back();
      expect({
        gameEntries: history.gameEntries,
        seen,
        systemBacks: history.systemBacks,
        watching: watchers?.active ?? 0,
      }).toEqual({
        gameEntries: 1,
        seen: row.presses,
        systemBacks: row.presses.length === 0 ? 1 : 0,
        watching: row.watching,
      });
    },
  );

  it("watches for the next back with a new watcher after each close", () => {
    const { back, watchers } = played({ closeWatcher: true, previous: false });
    back();
    back();
    expect({ active: watchers?.active, created: watchers?.created }).toEqual({
      active: 1,
      created: 3,
    });
  });

  it("leaves Escape's close to the game's keys and watches again", () => {
    const { host, input, seen, watchers } = played({ closeWatcher: true, previous: false });
    input("Escape");
    watchers?.request();
    host.wait();
    expect({ active: watchers?.active, seen }).toEqual({ active: 1, seen: [] });
  });

  it("watches again when the page comes back from the back-forward cache", () => {
    const { guard, history, watchers } = played({ closeWatcher: true, previous: true });
    guard.leave();
    const afterLeaving = watchers?.active;
    history.dispatchEvent(new Event("pageshow"));
    expect([afterLeaving, watchers?.active]).toEqual([0, 1]);
  });

  // Only input the browser records before the page sees it pushes the guard: a key press other
  // than Escape, or a pointerup.
  it.each([
    { gameEntries: 2, key: "a", type: "keydown" },
    { gameEntries: 1, key: "Escape", type: "keydown" },
    { gameEntries: 1, key: undefined, type: "pointerdown" },
    { gameEntries: 2, key: undefined, type: "pointerup" },
  ])("$type with key $key, twice, leaves $gameEntries game entries", (row) => {
    const history = new FakeHistory(false);
    guardBackNavigation(recordBacks([]), history, new FakeLeaveHost(), undefined, history);
    for (let press = 0; press < 2; press += 1) {
      history.dispatchEvent(Object.assign(new Event(row.type), { key: row.key }));
    }
    expect(history.gameEntries).toBe(row.gameEntries);
  });

  it("does not push a second guard when the page reloads on one", () => {
    const { history } = played({ closeWatcher: false, previous: false });
    guardBackNavigation(recordBacks([]), history, new FakeLeaveHost(), undefined, history);
    history.dispatchEvent(new Event(BACK_GUARD_GESTURES[0]));
    expect(history.gameEntries).toBe(2);
  });

  it("ignores a popstate that lands on the guard entry, as going forward does", () => {
    const { history, seen } = played({ closeWatcher: false, previous: false });
    history.dispatchEvent(new Event("popstate"));
    expect(seen).toEqual([]);
  });

  it("marks the guard entry with its game's state key", () => {
    const { history } = played({ closeWatcher: false, previous: false });
    expect(history.state).toEqual(backGuardState(STATE_KEY));
  });

  it("takes another game's guard state for an entry of its own", () => {
    const history = new FakeHistory(false);
    history.pushState(backGuardState(`other-${STATE_KEY}`));
    const seen: string[] = [];
    guardBackNavigation(recordBacks(seen), history, new FakeLeaveHost(), undefined, history);
    history.dispatchEvent(new Event(BACK_GUARD_GESTURES[0]));
    expect(history.gameEntries).toBe(3);
  });
});

describe("browserCloseWatcher", () => {
  it.each([
    ["a browser with CloseWatcher", true],
    ["a browser without", false],
  ])("creates close watchers in %s: %s", (_, has) => {
    const global = globalThis as { CloseWatcher?: unknown };
    const before = global.CloseWatcher;
    global.CloseWatcher = has ? EventTarget : undefined;
    try {
      const factory = browserCloseWatcher();
      expect(factory?.() instanceof EventTarget).toBe(has);
    } finally {
      global.CloseWatcher = before;
    }
  });
});
