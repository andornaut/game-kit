import {
  type AppCloseHost,
  BACK_GUARD_GESTURES,
  backGuardState,
  canExitApp,
  ESCAPE_KEY,
  isBackGuardState,
} from "../index.ts";

export interface HistoryLike {
  // How many entries the window's session history holds, before and after the current one.
  readonly length: number;
  pushState(data: unknown, unused: string): void;
  readonly state: unknown;
}

// The part of a CloseWatcher the game uses: it fires close on a close request (the Android back
// gesture or button, or Escape on a keyboard) and is spent by it. TypeScript's DOM lib has no
// CloseWatcher type.
export type CloseWatcherLike = EventTarget;

// Creates a CloseWatcher, where the browser has them.
export type CloseWatcherFactory = () => CloseWatcherLike;
export type DestroyableCloseWatcher = CloseWatcherLike & { destroy(): void };
export type DestroyableCloseWatcherFactory = () => DestroyableCloseWatcher;

// The page's timer, which ends an Escape press's handling once its close has fired.
export interface TimerHost {
  setTimeout(handler: () => void, ms: number): unknown;
}

export interface BackGuardContext {
  // Called on each back the guard keeps on the game, for the game to decide what back means.
  readonly onBack: () => void;
  // The key the guard entry's history state sets true, which tells the entry from any other
  // state, a page reloaded on it included. Unique to the game, as its history is shared with
  // other pages.
  readonly stateKey: string;
  readonly timer: TimerHost;
  readonly createCloseWatcher: CloseWatcherFactory | undefined;
  readonly history: HistoryLike;
}

// The browser's CloseWatcher, where it has one (Chrome 120 and later, Firefox 149 and later).
export function browserCloseWatcher(): DestroyableCloseWatcherFactory | undefined {
  const CloseWatcher = (globalThis as { CloseWatcher?: new () => DestroyableCloseWatcher })
    .CloseWatcher;
  return CloseWatcher === undefined ? undefined : () => new CloseWatcher();
}

function eventKey(event: Event): unknown {
  return (event as { key?: unknown }).key;
}

// Keeps back (Android gesture or button, or the browser's Back) on the game, in a browser tab or
// installed as an app; each back calls onBack.
// Two ways catch it:
// - A close watcher, where the browser has CloseWatcher, created at load and again after each
//   close it fires. It adds no history entry, so with nothing before the game the history holds
//   one entry, as an installed app's window needs for a script to close it.
// - A guard history entry for back to pop, pushed again on each pop, where there is no close
//   watcher (backCloseWatcher) or the history already holds more than one entry, so the window
//   could not close anyway. It also catches a desktop browser's Back button, which is not a close
//   request. The user's back skips an entry with no user interaction recorded on it (Firefox) or
//   one that added an entry without user activation (Chrome), and with no other entry before it
//   leaves the page. So the guard goes on top of the game's entry only from the player's first
//   input (BACK_GUARD_GESTURES), never at load, and again from any later input that finds it
//   missing; back before that input is the browser's own.
// This cannot stop the system closing the app or a browser showing its own leave prompt.
export function guardBackNavigation(
  { createCloseWatcher, history, onBack, stateKey, timer }: BackGuardContext,
  eventTarget: EventTarget,
): void {
  // Whether an Escape keydown is being handled: the close it causes is the keyboard's, not back.
  let escaping = false;
  let watcher: CloseWatcherLike | undefined;

  const usesGuard = () => createCloseWatcher === undefined || history.length > 1;
  const isGuard = () => isBackGuardState(stateKey, history.state);
  const pushGuard = () => {
    if (usesGuard() && !isGuard()) {
      history.pushState(backGuardState(stateKey), "");
    }
  };
  const onClose = () => {
    watcher = undefined;
    watchClose();
    if (!escaping) {
      onBack();
    }
  };
  const watchClose = () => {
    if (createCloseWatcher !== undefined && watcher === undefined) {
      watcher = createCloseWatcher();
      watcher.addEventListener("close", onClose, { once: true });
    }
  };
  const onGesture = (event: Event) => {
    // Escape is no user activation, so it pushes no guard.
    if (event.type === "keydown" && eventKey(event) === ESCAPE_KEY) {
      escaping = true;
      timer.setTimeout(() => {
        escaping = false;
      }, 0);
    } else {
      pushGuard();
    }
    watchClose();
  };
  const onPopState = () => {
    // Forward onto the guard entry is not a back press.
    if (isGuard()) {
      return;
    }
    pushGuard();
    onBack();
  };
  for (const type of BACK_GUARD_GESTURES) {
    eventTarget.addEventListener(type, onGesture, { capture: true, passive: true });
  }
  eventTarget.addEventListener("popstate", onPopState);
  watchClose();
}

export interface BackNavigationContext extends Omit<BackGuardContext, "createCloseWatcher"> {
  readonly createCloseWatcher: DestroyableCloseWatcherFactory | undefined;
}

export interface BackNavigationGuard {
  setEnabled(enabled: boolean): void;
  /** Whether the enabled scope has a known platform departure. */
  canLeave(): boolean;
  /** Attempt the known departure once. True acknowledges a close or observed traversal. */
  leave(): Promise<boolean>;
  dispose(): void;
}

interface HistoryEntry {
  readonly id: string;
  readonly index: number;
  readonly key: string;
  readonly sameDocument: boolean;
}

interface KeyedNavigation extends EventTarget {
  readonly activation?: { readonly entry: HistoryEntry; readonly navigationType: string } | null;
  readonly currentEntry: HistoryEntry | null;
  entries(): readonly HistoryEntry[];
  traverseTo(
    key: string,
    options: { info: object },
  ): {
    readonly committed: Promise<HistoryEntry>;
    readonly finished: Promise<unknown>;
  };
}

type BackNavigateEvent = Event & {
  readonly destination: HistoryEntry;
  readonly info: unknown;
  readonly navigationType: string;
  readonly signal: AbortSignal;
  readonly userInitiated: boolean;
};

type EntryChangeEvent = Event & {
  readonly from: HistoryEntry;
  readonly navigationType: string | null;
};

interface Marker {
  readonly base: HistoryEntry;
  readonly entry: HistoryEntry;
  readonly token: string;
}

type AppCloseWindow = AppCloseHost & { close(): void; readonly closed: boolean };

type Departure =
  | { readonly host: AppCloseWindow; readonly kind: "close" }
  | {
      readonly base: HistoryEntry;
      readonly kind: "back";
      readonly marker: Marker | undefined;
      readonly previous: HistoryEntry;
    };

const ARM_EVENTS = [
  "keydown",
  "mousedown",
  "pointerdown",
  "pointerup",
  "touchend",
  "click",
] as const;
const CAPTURE_INPUT = { capture: true, passive: true } as const;
const MARKER_PREFIX = "game-kit-back:";
const markerToken = (stateKey: string, state: unknown): unknown =>
  (state as Record<string, unknown> | null)?.[stateKey];
const isMarkerToken = (token: unknown) =>
  token === true || (typeof token === "string" && token.startsWith(MARKER_PREFIX));

function keyedNavigation(target: EventTarget): KeyedNavigation | undefined {
  const navigation = (target as { navigation?: KeyedNavigation }).navigation;
  return typeof navigation?.traverseTo === "function" && typeof navigation.entries === "function"
    ? navigation
    : undefined;
}

// The caller enables this only while it owns platform Back. The Navigation API identifies the
// exact same-document entries. Without it there is no safe relative traversal, so only an
// available CloseWatcher handles Back.
export function createBackNavigationGuard(
  { createCloseWatcher, history, onBack, stateKey, timer }: BackNavigationContext,
  eventTarget: EventTarget,
): BackNavigationGuard {
  const navigation = keyedNavigation(eventTarget);
  const host = eventTarget as Partial<AppCloseWindow>;
  const app =
    typeof host.close === "function" &&
    typeof host.matchMedia === "function" &&
    host.navigator !== undefined &&
    host.history === history
      ? (host as AppCloseWindow)
      : undefined;
  const initiallyClosable = app !== undefined && canExitApp(createCloseWatcher, app);
  const launch = navigation?.activation;
  // The entry list omits cross-origin history. A fresh push starts at the tail.
  const launchHidden =
    navigation !== undefined &&
    launch?.navigationType === "push" &&
    launch.entry.id === navigation.currentEntry?.id
      ? history.length - navigation.entries().length
      : undefined;
  let enabled = false;
  let disposed = false;
  let generation = 0;
  let entryRevision = 0;
  let leaving = false;
  let restoring = false;
  let activation: object | undefined;
  let escapePress: object | undefined;
  let watcher:
    { readonly close: () => void; readonly instance: DestroyableCloseWatcher } | undefined;
  let owned: Marker | undefined;
  let lastMarker: Marker | undefined;
  let unwinding = false;
  let back: { readonly marker: Marker; readonly signal: AbortSignal } | undefined;
  let pushing = false;

  const currentMarker = (marker: Marker) =>
    navigation?.currentEntry?.id === marker.entry.id &&
    markerToken(stateKey, history.state) === marker.token;

  const arm = () => {
    const base = navigation?.currentEntry;
    const state = markerToken(stateKey, history.state);
    if (
      !enabled ||
      leaving ||
      restoring ||
      activation === undefined ||
      pushing ||
      owned !== undefined ||
      unwinding ||
      (createCloseWatcher !== undefined && history.length <= 1) ||
      navigation === undefined ||
      base == null ||
      base.index < 0 ||
      isMarkerToken(state)
    ) {
      return;
    }
    const entries = navigation.entries();
    const hidden = history.length - entries.length;
    if (
      hidden !== 0 &&
      (hidden !== launchHidden || navigation.activation !== launch || base.id !== launch?.entry.id)
    ) {
      return;
    }
    const forward = entries.slice(base.index + 1);
    if (
      forward.length !== 0 &&
      (forward.length !== 1 ||
        lastMarker?.base.id !== base.id ||
        forward[0]?.id !== lastMarker.entry.id)
    ) {
      return;
    }
    const token = MARKER_PREFIX + crypto.getRandomValues(new Uint32Array(4)).join("-");
    const started = generation;
    activation = undefined;
    pushing = true;
    try {
      history.pushState({ [stateKey]: token }, "");
    } catch (error) {
      if (error instanceof DOMException && error.name === "SecurityError") {
        return;
      }
      throw error;
    } finally {
      pushing = false;
    }
    const entry = navigation.currentEntry;
    if (
      entry !== null &&
      entry.id !== base.id &&
      entry.index === base.index + 1 &&
      markerToken(stateKey, history.state) === token &&
      navigation.entries()[base.index]?.id === base.id
    ) {
      const marker = { base, entry, token };
      lastMarker = marker;
      if (enabled && generation === started) {
        owned = marker;
      } else {
        unwind(marker);
      }
    }
  };

  // Validate the pair at submission and dispatch. A competing request for the same key can
  // reuse its promises. Only a cancelable event can veto an invalidated request at dispatch.
  const travel = (
    destination: HistoryEntry,
    valid: () => boolean,
    crossDocument = false,
  ): Promise<number | undefined> => {
    if (navigation === undefined || !valid()) {
      return Promise.resolve(undefined);
    }
    return new Promise((resolve) => {
      const info = {};
      let approval: { readonly revision: number; readonly signal: AbortSignal } | undefined;
      const finish = (revision?: number) => {
        navigation.removeEventListener("navigate", verify);
        eventTarget.removeEventListener("pagehide", onPageHide);
        resolve(revision);
      };
      const verify = (event: Event) => {
        const move = event as BackNavigateEvent;
        if (!event.isTrusted || move.info !== info) {
          return;
        }
        if (
          !valid() ||
          move.navigationType !== "traverse" ||
          move.destination.id !== destination.id ||
          move.destination.sameDocument === crossDocument
        ) {
          if (event.cancelable) {
            event.preventDefault();
          }
          return;
        }
        approval = { revision: entryRevision, signal: move.signal };
      };
      const onPageHide = (event: Event) => {
        if (event.isTrusted) {
          finish(
            approval?.revision === entryRevision && !approval.signal.aborted
              ? entryRevision
              : undefined,
          );
        }
      };
      navigation.addEventListener("navigate", verify);
      if (crossDocument) {
        eventTarget.addEventListener("pagehide", onPageHide);
      }
      try {
        const traversal = navigation.traverseTo(destination.key, { info });
        void Promise.allSettled([traversal.committed, traversal.finished]).then(
          ([committed, finished]) => {
            finish(
              committed.status === "fulfilled" &&
                committed.value.id === destination.id &&
                finished.status === "fulfilled" &&
                approval !== undefined &&
                approval.revision + 1 === entryRevision &&
                !approval.signal.aborted &&
                navigation.currentEntry?.id === destination.id
                ? entryRevision
                : undefined,
            );
          },
        );
      } catch {
        finish();
      }
    });
  };

  const adjacent = (entry: HistoryEntry, direction: -1 | 1) => {
    const entries = navigation?.entries();
    const index = entry.index;
    return entries?.[index]?.id === entry.id ? entries[index + direction] : undefined;
  };

  const unwind = (marker: Marker) => {
    if (unwinding || !currentMarker(marker) || adjacent(marker.entry, -1)?.id !== marker.base.id) {
      return undefined;
    }
    unwinding = true;
    return travel(
      marker.base,
      () => currentMarker(marker) && adjacent(marker.entry, -1)?.id === marker.base.id,
    ).finally(() => {
      unwinding = false;
    });
  };

  const restoreMarker = async (marker: Marker, started: number): Promise<void> => {
    const canRestore = () =>
      enabled &&
      generation === started &&
      owned === undefined &&
      navigation?.currentEntry?.id === marker.base.id &&
      adjacent(marker.base, 1)?.id === marker.entry.id;
    if (restoring || !canRestore()) {
      return;
    }
    restoring = true;
    await travel(marker.entry, canRestore)
      .then((revision) => {
        if (
          revision === entryRevision &&
          enabled &&
          generation === started &&
          currentMarker(marker)
        ) {
          owned = marker;
        }
      })
      .finally(() => {
        restoring = false;
      });
  };

  const departure = (): Departure | undefined => {
    if (!enabled || disposed || leaving || restoring || unwinding || pushing) {
      return undefined;
    }
    const marker = owned;
    if (marker === undefined && isMarkerToken(markerToken(stateKey, history.state))) {
      return undefined;
    }
    if (
      marker === undefined &&
      initiallyClosable &&
      app !== undefined &&
      !app.closed &&
      canExitApp(createCloseWatcher, app)
    ) {
      return { host: app, kind: "close" };
    }
    if (
      marker !== undefined &&
      (!currentMarker(marker) || adjacent(marker.entry, -1)?.id !== marker.base.id)
    ) {
      return undefined;
    }
    const base = marker?.base ?? lastMarker?.base ?? navigation?.currentEntry;
    const previous = base == null ? undefined : adjacent(base, -1);
    if (
      base == null ||
      (marker === undefined && navigation?.currentEntry?.id !== base.id) ||
      previous === undefined ||
      !previous.id ||
      !previous.key ||
      previous.id === lastMarker?.entry.id
    ) {
      return undefined;
    }
    return { base, kind: "back", marker, previous };
  };

  const onNavigate = (event: Event) => {
    if (!event.isTrusted) {
      return;
    }
    entryRevision += 1;
    const move = event as BackNavigateEvent;
    const marker = owned;
    back = undefined;
    if (
      !enabled ||
      leaving ||
      marker === undefined ||
      !currentMarker(marker) ||
      move.navigationType !== "traverse" ||
      !move.userInitiated ||
      !move.destination.sameDocument ||
      move.destination.id !== marker.base.id ||
      event.defaultPrevented
    ) {
      return;
    }
    if (event.cancelable) {
      event.preventDefault();
      const revision = entryRevision;
      const started = generation;
      // Let the browser finish canceling this Back before the callback can confirm departure.
      timer.setTimeout(() => {
        if (
          enabled &&
          generation === started &&
          entryRevision === revision &&
          owned === marker &&
          currentMarker(marker)
        ) {
          onBack();
        }
      }, 0);
    } else {
      back = { marker, signal: move.signal };
    }
  };
  const onEntryChange = (event: Event) => {
    if (!event.isTrusted) {
      return;
    }
    entryRevision += 1;
    const marker = owned;
    if (marker === undefined || currentMarker(marker)) {
      return;
    }
    owned = undefined;
    activation = undefined;
    const request = back;
    back = undefined;
    const change = event as EntryChangeEvent;
    if (
      enabled &&
      !leaving &&
      request?.marker === marker &&
      !request.signal.aborted &&
      change.navigationType === "traverse" &&
      change.from.id === marker.entry.id &&
      navigation?.currentEntry?.id === marker.base.id
    ) {
      const started = generation;
      const revision = entryRevision;
      // Wait for the browser Back to finish. Only its exact forward marker can be recovered.
      timer.setTimeout(() => {
        if (!enabled || leaving || generation !== started || entryRevision !== revision) {
          return;
        }
        void restoreMarker(marker, started).then(() => {
          if (
            enabled &&
            !leaving &&
            generation === started &&
            (owned === marker || navigation?.currentEntry?.id === marker.base.id)
          ) {
            onBack();
          }
        });
      }, 0);
    }
  };

  const releaseWatcher = () => {
    const previous = watcher;
    watcher = undefined;
    previous?.instance.removeEventListener("close", previous.close);
    previous?.instance.destroy();
  };
  const watch = () => {
    if (!enabled || leaving || watcher !== undefined || createCloseWatcher === undefined) {
      return;
    }
    const started = generation;
    const instance = createCloseWatcher();
    if (!enabled || generation !== started || watcher !== undefined) {
      instance.destroy();
      return;
    }
    const close = () => {
      if (!enabled || watcher?.instance !== instance || watcher.close !== close) {
        return;
      }
      releaseWatcher();
      try {
        if (escapePress === undefined && !leaving) {
          onBack();
        }
      } finally {
        watch();
      }
    };
    watcher = { close, instance };
    instance.addEventListener("close", close, { once: true });
  };

  const onGesture = (event: Event) => {
    if (!event.isTrusted) {
      return;
    }
    if (event.type === "keydown") {
      const key = event as KeyboardEvent;
      if (key.key === ESCAPE_KEY) {
        const press = {};
        escapePress = press;
        timer.setTimeout(() => {
          if (escapePress === press) {
            escapePress = undefined;
          }
        }, 0);
        return;
      }
      if (key.repeat || key.isComposing || key.altKey || key.ctrlKey || key.metaKey) {
        return;
      }
    }
    const userActivation = (eventTarget as { navigator?: Pick<Navigator, "userActivation"> })
      .navigator?.userActivation;
    if (
      userActivation?.isActive === false ||
      (event.type === "pointerdown" && (event as PointerEvent).pointerType !== "mouse") ||
      (event.type === "pointerup" && (event as PointerEvent).pointerType === "mouse") ||
      (event.type === "click" && userActivation === undefined)
    ) {
      return;
    }
    const lease = {};
    activation = lease;
    timer.setTimeout(() => {
      if (activation === lease) {
        activation = undefined;
      }
    }, 0);
    arm();
  };
  for (const type of ARM_EVENTS) {
    eventTarget.addEventListener(type, onGesture, CAPTURE_INPUT);
  }
  navigation?.addEventListener("navigate", onNavigate);
  navigation?.addEventListener("currententrychange", onEntryChange);

  const disable = () => {
    enabled = false;
    generation += 1;
    activation = undefined;
    back = undefined;
    const marker = owned;
    owned = undefined;
    try {
      releaseWatcher();
    } finally {
      if (marker !== undefined) {
        unwind(marker);
      }
    }
  };
  return {
    canLeave() {
      return departure() !== undefined;
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      escapePress = undefined;
      for (const type of ARM_EVENTS) {
        eventTarget.removeEventListener(type, onGesture, CAPTURE_INPUT);
      }
      navigation?.removeEventListener("navigate", onNavigate);
      navigation?.removeEventListener("currententrychange", onEntryChange);
      disable();
    },
    leave() {
      const next = departure();
      if (next === undefined) {
        return Promise.resolve(false);
      }
      const started = generation;
      const stillEnabled = () => enabled && generation === started;
      leaving = true;
      const complete = async () => {
        if (next.kind === "close") {
          releaseWatcher();
          if (!stillEnabled() || !canExitApp(createCloseWatcher, next.host)) {
            return false;
          }
          try {
            next.host.close();
            return next.host.closed;
          } catch {
            return false;
          }
        }
        const { base, marker, previous } = next;
        const drain = marker === undefined ? entryRevision : await unwind(marker);
        if (drain !== entryRevision || !stillEnabled()) {
          return false;
        }
        const valid = () =>
          stillEnabled() &&
          navigation?.currentEntry?.id === base.id &&
          adjacent(base, -1)?.id === previous.id;
        if ((await travel(previous, valid, !previous.sameDocument)) !== undefined) {
          return true;
        }
        if (marker !== undefined && stillEnabled()) {
          await restoreMarker(marker, started);
        }
        return false;
      };
      return complete()
        .then((departed) => {
          if (departed && stillEnabled()) {
            disable();
          }
          return departed;
        })
        .finally(() => {
          leaving = false;
          watch();
        });
    },
    setEnabled(next) {
      if (disposed || next === enabled) {
        return;
      }
      if (next) {
        enabled = true;
        generation += 1;
        watch();
        arm();
      } else {
        disable();
      }
    },
  };
}
