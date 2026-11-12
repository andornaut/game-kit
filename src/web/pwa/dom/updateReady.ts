// The page's side of updating: follows a service worker registration's waiting version and shows
// the update offer by offerShown, or updates by itself when a save requires it. The policy is in
// ../updateReady.
import {
  offerShown,
  type OfferState,
  type RequiredUpdateState,
  resumeCheckDue,
  SKIP_WAITING_MESSAGE,
} from "../updateReady.ts";

// The parts of the Service Worker API this uses, so tests can pass fakes.
export interface ServiceWorkerLike extends EventTarget {
  postMessage(message: unknown): void;
  readonly state: string;
}

export interface RegistrationLike extends EventTarget {
  readonly active: ServiceWorkerLike | null;
  readonly installing: ServiceWorkerLike | null;
  update(): Promise<unknown>;
  readonly waiting: ServiceWorkerLike | null;
}

export interface ContainerLike extends EventTarget {
  readonly controller: unknown;
}

// The worker waiting behind the version that controls the page, if any: a newer version, fully
// installed and checked. A page no version controls has none, since it loaded from the network
// and never switches.
export function waitingWorkerOf(
  container: ContainerLike,
  registration: RegistrationLike,
): ServiceWorkerLike | undefined {
  return container.controller === null ? undefined : (registration.waiting ?? undefined);
}

// Tells the waiting worker to take over, then reloads once it controls the page. Without this a
// waiting worker activates on the next launch, and controllerchange never fires mid-session.
export function activateWaitingWorker(
  container: ContainerLike,
  reload: () => void,
  worker: ServiceWorkerLike,
): void {
  let reloaded = false;
  container.addEventListener("controllerchange", () => {
    if (!reloaded) {
      reloaded = true;
      reload();
    }
  });
  worker.postMessage(SKIP_WAITING_MESSAGE);
}

// The tab's sessionStorage, as far as the reload guard goes.
export type SessionLike = Pick<Storage, "getItem" | "removeItem" | "setItem">;

// The session key set before requireNewer reloads a page no version controls, and removed once a
// version controls the page. While it is set, an uncontrolled page never reloads again.
export const CONTROL_RELOAD_KEY = "game-kit:control-reload";

// What the update flow needs of the page, so tests can pass fakes.
export interface UpdatePage {
  readonly container: ContainerLike;
  now(): number;
  online(): boolean;
  reload(): void;
  // The tab's sessionStorage, or undefined where it is unavailable. Without it requireNewer never
  // reloads a page no version controls.
  readonly session: SessionLike | undefined;
}

export interface UpdateReports {
  // Called with a required update's state on each change, only after requireNewer(). The game
  // shows its travelling loading bar for "updating" and its one "connect to update" message for
  // "unavailable".
  readonly onRequireNewer: (state: RequiredUpdateState) => void;
  // Called with whether the game offers the update, on each change of offerShown: a newer version
  // fully installed and checked waits behind the one controlling the page, the home screen is in
  // front and no update is required. Never on a page no version controls.
  readonly onUpdateShown: (shown: boolean) => void;
}

export interface UpdateFlow {
  // The offer's button: switch to the waiting version, or with none waiting reload into the
  // active one. Does nothing while a switch is reloading. A save a newer version wrote uses
  // requireNewer instead.
  accept(): void;
  // Hides the offer for the rest of the page session, for this and any later waiting version,
  // without consuming or activating its waiting worker. Arrival and resume checks continue.
  dismissOffer(): void;
  // A key, touch or click, or play started without input. Each arrival home after it checks for
  // a newer version.
  noteInteraction(): void;
  // The device reconnected (the window's online event). A required update retries.
  noteOnline(): void;
  // A save a newer version wrote: update by itself, never offering it, and report each state
  // through onRequireNewer. A waiting version activates and the page reloads into it at once;
  // otherwise this checks for a newer version and activates it once it waits, fully installed and
  // verified. A page no version controls registers, waits for its install to activate and reloads
  // once to become controlled. Idempotent; it lasts for the page.
  requireNewer(): void;
  // Offer eligibility: whether the home screen, the only place the offer shows, is in front. Each
  // arrival after input checks for a newer version. Independent of registration; it never clears
  // a dismissal.
  setOfferVisible(visible: boolean): void;
  // Whether the page is in view. Coming back into view on the home screen checks for a newer
  // version, at most once per RESUME_CHECK_MS; a required update retries on every return.
  setVisible(visible: boolean): void;
  // Follows the registration's waiting version, checking for a newer one first on a controlled
  // page unless offline or one already waits.
  watch(registration: RegistrationLike): void;
}

// Whether this tab may reload an uncontrolled page into a controlled one: true once, until a
// version controls a page. False without session storage, so no reload can repeat.
function claimControlReload(session: SessionLike | undefined): boolean {
  try {
    if (session === undefined || session.getItem(CONTROL_RELOAD_KEY) !== null) {
      return false;
    }
    session.setItem(CONTROL_RELOAD_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

function releaseControlReload(session: SessionLike | undefined): void {
  try {
    session?.removeItem(CONTROL_RELOAD_KEY);
  } catch {
    // Without storage the guard was never claimed.
  }
}

// Shows the update offer through reports.onUpdateShown, on each change of offerShown. Nothing
// here delays the game or reloads the page on its own: the game shows its first screen at once,
// checks run in the background, and only accept() or requireNewer() switches versions.
// register() requests a service worker registration that ends in watch(), and settles once it has
// or failed; requireNewer calls it when nothing is watched or a first install failed.
export function createUpdateFlow(
  page: UpdatePage,
  register: () => Promise<unknown>,
  reports: UpdateReports,
): UpdateFlow {
  const { container } = page;
  let state: OfferState = {
    dismissed: false,
    offerVisible: false,
    reloading: false,
    required: false,
    waiting: false,
  };
  let checks = 0;
  let interacted = false;
  let lastCheck: number | undefined;
  let registering = 0;
  let requiredState: RequiredUpdateState | undefined;
  let shown = false;
  let waitingWorker: ServiceWorkerLike | undefined;
  let watched: RegistrationLike | undefined;
  if (container.controller !== null) {
    releaseControlReload(page.session);
  }
  const update = (change: Partial<OfferState>) => {
    state = { ...state, ...change };
    const visible = offerShown(state);
    if (visible !== shown) {
      shown = visible;
      reports.onUpdateShown(visible);
    }
  };
  const report = (next: RequiredUpdateState) => {
    if (requiredState !== next) {
      requiredState = next;
      reports.onRequireNewer(next);
    }
  };
  const requestRegistration = () => {
    registering += 1;
    void register().finally(() => {
      registering -= 1;
      advance(false);
    });
  };
  // Moves a required update on from the registration's state. retry starts a check or a
  // registration when nothing is under way; without it, nothing under way is "unavailable".
  const advance = (retry: boolean) => {
    if (!state.required || state.reloading) {
      return;
    }
    const registration = watched;
    if (registration === undefined) {
      if (retry && registering === 0) {
        requestRegistration();
      }
      report(registering > 0 ? "updating" : "unavailable");
      return;
    }
    if (container.controller === null) {
      if (registration.active?.state === "activated") {
        if (claimControlReload(page.session)) {
          update({ reloading: true });
          report("updating");
          page.reload();
        } else {
          report("unavailable");
        }
        return;
      }
      const pending = [registration.installing, registration.waiting, registration.active].filter(
        (worker) => worker !== null,
      );
      for (const worker of pending) {
        worker.addEventListener("statechange", read);
      }
      if (pending.length === 0 && retry && registering === 0 && page.online()) {
        requestRegistration();
      }
      report(pending.length > 0 || registering > 0 ? "updating" : "unavailable");
      return;
    }
    const waiting = registration.waiting;
    if (waiting !== null) {
      update({ reloading: true });
      report("updating");
      activateWaitingWorker(container, () => page.reload(), waiting);
      return;
    }
    if (registration.installing === null && retry && checks === 0 && page.online()) {
      check(registration).catch(() => undefined);
    }
    report(registration.installing !== null || checks > 0 ? "updating" : "unavailable");
  };
  const check = (registration: RegistrationLike) => {
    lastCheck = page.now();
    checks += 1;
    return registration.update().finally(() => {
      checks -= 1;
      advance(false);
    });
  };
  // Follows the version installing now, whether its updatefound came before watch (the browser's
  // own check on navigation) or after, until it waits; a listener added twice runs once.
  function read(): void {
    const registration = watched;
    if (registration === undefined) {
      return;
    }
    registration.installing?.addEventListener("statechange", read);
    waitingWorker = waitingWorkerOf(container, registration);
    update({ waiting: waitingWorker !== undefined });
    advance(false);
  }
  return {
    accept() {
      if (state.reloading) {
        return;
      }
      update({ reloading: true });
      if (waitingWorker === undefined) {
        page.reload();
      } else {
        activateWaitingWorker(container, () => page.reload(), waitingWorker);
      }
    },
    dismissOffer: () => update({ dismissed: true }),
    noteInteraction() {
      interacted = true;
    },
    noteOnline: () => advance(true),
    requireNewer() {
      if (!state.required) {
        update({ required: true });
        advance(true);
      }
    },
    setOfferVisible(offerVisible) {
      const arrived = offerVisible && !state.offerVisible && interacted;
      update({ offerVisible });
      if (arrived && page.online() && watched !== undefined) {
        check(watched).catch(() => undefined);
      }
    },
    setVisible(visible) {
      const due = resumeCheckDue({
        lastCheck,
        now: page.now(),
        offerVisible: state.offerVisible,
        online: page.online(),
        visible,
      });
      if (due && watched !== undefined) {
        check(watched).catch(() => undefined);
      }
      if (visible) {
        advance(true);
      }
    },
    watch(registration) {
      watched = registration;
      registration.addEventListener("updatefound", read);
      // A version already waiting, a first install or no network: nothing to check first.
      const waiting = waitingWorkerOf(container, registration) !== undefined;
      if (waiting || container.controller === null || !page.online()) {
        read();
        return;
      }
      check(registration).then(read, read);
    },
  };
}
