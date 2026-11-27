// A fresh push is at the tail. A reload alone cannot locate the cross-origin entries that
// Navigation.entries() omits. Carry evidence from the outgoing first-install document instead.
interface Entry {
  readonly id: string;
  readonly index: number;
  readonly key: string;
}

interface TailNavigation extends EventTarget {
  readonly activation: {
    readonly entry: Entry;
    readonly from: Entry | null;
    readonly navigationType: string;
  } | null;
  readonly currentEntry: Entry | null;
  entries(): readonly Entry[];
}

interface ReloadEvent extends Event {
  readonly destination: { readonly url: string };
  readonly navigationType: string;
  readonly signal: AbortSignal;
}

const KEY = "game-kit:back-reload-tail";
const reloadTails = new WeakMap<Window, string>();

function navigationOf(page: Window): TailNavigation | undefined {
  const navigation = (page as Window & { readonly navigation?: TailNavigation }).navigation;
  return typeof navigation?.entries === "function" ? navigation : undefined;
}

function sameEntry(first: Entry | null | undefined, second: Entry): boolean {
  return first?.id === second.id && first.key === second.key;
}

function snapshot(page: Window, navigation: TailNavigation | undefined, kind: "push" | "reload") {
  const activation = navigation?.activation;
  const current = navigation?.currentEntry;
  if (
    page.top !== page ||
    page.length !== 0 ||
    navigation === undefined ||
    current == null ||
    activation?.navigationType !== kind ||
    !sameEntry(activation.entry, current) ||
    (kind === "reload" && !sameEntry(activation.from, current))
  ) {
    return undefined;
  }
  const entries = navigation.entries();
  let length: number;
  try {
    length = page.history.length;
  } catch {
    // History can become inaccessible as its document deactivates.
    return undefined;
  }
  if (
    current.index < 0 ||
    current.index !== entries.length - 1 ||
    !sameEntry(entries[current.index], current) ||
    length < entries.length
  ) {
    return undefined;
  }
  return {
    hidden: length - entries.length,
    identity: JSON.stringify([length, entries.map(({ id, key }) => [id, key])]),
  };
}

// Claim storage at browser launch so a later reload cannot reuse an unclaimed witness.
function claimReloadTail(page: Window, navigation: TailNavigation | undefined): void {
  try {
    const { sessionStorage } = page;
    const stored = sessionStorage.getItem(KEY);
    if (stored !== null) {
      sessionStorage.removeItem(KEY);
      if (stored === snapshot(page, navigation, "reload")?.identity) {
        reloadTails.set(page, stored);
      }
    }
  } catch {
    // Storage can be unavailable. The guard then uses only its live history evidence.
  }
}

function witnessReload(identity: string, navigation: TailNavigation, page: Window): () => void {
  const href = page.location.href;
  let reload: ReloadEvent | undefined;
  const stop = () => {
    navigation.removeEventListener("navigate", onNavigate);
    page.removeEventListener("pagehide", onHide);
    reload?.signal.removeEventListener("abort", stop);
  };
  const onNavigate = (event: Event) => {
    const request = event as ReloadEvent;
    if (
      reload !== undefined ||
      !event.isTrusted ||
      event.defaultPrevented ||
      request.navigationType !== "reload" ||
      request.destination.url !== href ||
      snapshot(page, navigation, "push")?.identity !== identity
    ) {
      stop();
      return;
    }
    reload = request;
    request.signal.addEventListener("abort", stop, { once: true });
  };
  const onHide = (event: PageTransitionEvent) => {
    stop();
    if (
      event.isTrusted &&
      !event.persisted &&
      reload !== undefined &&
      !reload.defaultPrevented &&
      !reload.signal.aborted &&
      snapshot(page, navigation, "push")?.identity === identity
    ) {
      try {
        page.sessionStorage.setItem(KEY, identity);
      } catch {
        // A storage failure must never block the reload.
      }
    }
  };
  navigation.addEventListener("navigate", onNavigate);
  page.addEventListener("pagehide", onHide);
  page.setTimeout(() => {
    if (reload === undefined) {
      stop();
    }
  }, 0);
  return stop;
}

export function browserLaunchLocation(firstInstallReload: () => boolean, page: Window) {
  const navigation = navigationOf(page);
  claimReloadTail(page, navigation);
  const opened = snapshot(page, navigation, "push");
  return {
    get href() {
      return page.location.href;
    },
    reload() {
      const stop =
        navigation !== undefined &&
        opened !== undefined &&
        opened.hidden > 0 &&
        firstInstallReload() &&
        snapshot(page, navigation, "push")?.identity === opened.identity
          ? witnessReload(opened.identity, navigation, page)
          : undefined;
      try {
        page.location.reload();
      } catch (error) {
        stop?.();
        throw error;
      }
    },
  };
}

export function takeBackReloadTail(history: { readonly length: number }, target: EventTarget) {
  const page = target as Window;
  const stored = reloadTails.get(page);
  if (stored === undefined || page.history !== history) {
    return undefined;
  }
  reloadTails.delete(page);
  const live = snapshot(page, navigationOf(page), "reload");
  return live?.identity === stored ? live.hidden : undefined;
}
