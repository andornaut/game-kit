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
  postMessage(message: unknown, transfer?: Transferable[]): void;
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

// Blocked keeps this document on its pinned build and permits a later explicit retry.
// Reloading means this exact worker acquired control and reload() was called.
export type SwitchResult = "blocked" | "reloading";

// Ten seconds bounds local validation and control acquisition, not installation or networking.
// The worker cannot start skipWaiting after this deadline. If control arrives after the bound,
// the old document stays pinned and no removed reload listener can interrupt its game.
export const SWITCH_TIMEOUT_MS = 10_000;

export function activateWaitingWorker(
  container: ContainerLike,
  reload: () => void,
  worker: ServiceWorkerLike,
): Promise<SwitchResult> {
  if (worker.state !== "installed") {
    return Promise.resolve("blocked");
  }
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    let done = false;
    let reloaded = false;
    const changed = () => {
      if (!reloaded && container.controller === worker) {
        reloaded = true;
        container.removeEventListener("controllerchange", changed);
        finish("reloading");
        reload();
      }
    };
    const finish = (result: SwitchResult) => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      channel.port1.close();
      channel.port2.close();
      worker.removeEventListener("statechange", changedState);
      if (result === "blocked") {
        container.removeEventListener("controllerchange", changed);
      }
      resolve(result);
    };
    const changedState = () => {
      if (worker.state === "redundant") {
        finish("blocked");
      }
    };
    const timer = setTimeout(() => finish("blocked"), SWITCH_TIMEOUT_MS);
    channel.port1.onmessage = ({ data }: MessageEvent<unknown>) => {
      // Acceptance alone does not establish control. Only controllerchange may reload.
      if (data !== "activating") {
        finish("blocked");
      }
    };
    container.addEventListener("controllerchange", changed);
    worker.addEventListener("statechange", changedState);
    try {
      worker.postMessage({ deadline: Date.now() + SWITCH_TIMEOUT_MS, type: SKIP_WAITING_MESSAGE }, [
        channel.port2,
      ]);
    } catch {
      finish("blocked");
    }
  });
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
  accept(): Promise<SwitchResult>;
  // An arrival at the home screen: the first launch and each return to it from play, never a
  // menu or card over it closing. Clears a dismissal and checks for a newer version unless
  // offline, nothing is watched yet or a check is under way; watch's first check serves an
  // arrival that came before it. Call it with setOfferVisible(true), in either order; it never
  // changes offer eligibility.
  arriveHome(): void;
  // Hides the offer, for this and any later waiting version, until the next arrival home
  // (arriveHome) or the page coming back into view on the home screen (setVisible), without
  // consuming or activating its waiting worker.
  dismissOffer(): void;
  // Deprecated no-op: arriveHome now starts the arrival check, so input no longer matters.
  // CLEANUP (added 2026-11-12): remove once every consuming game has dropped its calls.
  noteInteraction(): void;
  // The device reconnected (the window's online event). A required update retries.
  noteOnline(): void;
  // A save a newer version wrote: update by itself, never offering it, and report each state
  // through onRequireNewer. A waiting version activates and the page reloads into it at once;
  // otherwise this checks for a newer version and activates it once it waits, fully installed and
  // verified. A page no version controls registers, waits for its install to activate and reloads
  // once to become controlled. Idempotent; it lasts for the page.
  // The caller keeps Start, save loading and writes blocked in both reported states. Neither a
  // blocked switch nor an unavailable update releases that guard; only the new document may
  // recheck the save against its running version.
  requireNewer(): void;
  // Offer eligibility only: whether the home screen, the only place the offer shows, is in front
  // with no menu or card over it. Independent of registration; it never checks and never clears a
  // dismissal.
  setOfferVisible(visible: boolean): void;
  // Whether the page is in view. Coming back into view while the offer is eligible is a resume on
  // the home screen: it clears a dismissal every time, and checks for a newer version at most
  // once per RESUME_CHECK_MS. A required update retries on every return.
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
// here delays the game: launchReady owns its separate boot boundary. Checks run in the
// background, while accept() and the required-save policy govern this running document.
// register() requests a service worker registration that ends in watch(), and settles once it has
// or failed; requireNewer calls it when nothing is watched or a first install failed.
export function createUpdateFlow(
  page: UpdatePage,
  register: () => Promise<unknown>,
  reports: UpdateReports,
): UpdateFlow {
  const { container } = page;
  const initialController = container.controller;
  let state: OfferState = {
    dismissed: false,
    offerVisible: false,
    reloading: false,
    required: false,
    waiting: false,
  };
  let accepting: Promise<SwitchResult> | undefined;
  let checks = 0;
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
    // Another document may have completed the switch while this document kept its old build.
    if (
      container.controller !== initialController &&
      registration.active === container.controller &&
      registration.active?.state === "activated"
    ) {
      update({ reloading: true });
      report("updating");
      page.reload();
      return;
    }
    const waiting = registration.waiting;
    if (waiting !== null) {
      update({ reloading: true });
      report("updating");
      const blocked = () => {
        // required stays latched while reconnect/view retries become available again.
        update({ reloading: false });
        report("unavailable");
      };
      void activateWaitingWorker(container, () => page.reload(), waiting).then((result) => {
        if (result === "blocked") {
          blocked();
        }
      }, blocked);
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
  // A check for an arrival or resume home, unless offline, nothing is watched or one is under way.
  const arrivalCheck = () => {
    if (checks === 0 && watched !== undefined && page.online()) {
      check(watched).catch(() => undefined);
    }
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
      if (accepting !== undefined) {
        return accepting;
      }
      if (state.reloading) {
        return Promise.resolve("blocked");
      }
      update({ reloading: true });
      const candidate = watched?.waiting ?? waitingWorker;
      if (candidate === undefined || candidate.state !== "installed") {
        page.reload();
        return Promise.resolve("reloading");
      }
      accepting = activateWaitingWorker(container, () => page.reload(), candidate).then(
        (result) => {
          if (result === "blocked") {
            accepting = undefined;
            update({ reloading: false });
          }
          return result;
        },
      );
      return accepting;
    },
    arriveHome() {
      update({ dismissed: false });
      arrivalCheck();
    },
    dismissOffer: () => update({ dismissed: true }),
    noteInteraction() {
      // Deprecated no-op; see UpdateFlow.
    },
    noteOnline: () => advance(true),
    requireNewer() {
      if (!state.required) {
        update({ required: true });
        advance(true);
      }
    },
    setOfferVisible: (offerVisible) => update({ offerVisible }),
    setVisible(visible) {
      // Worker callbacks may not have run while hidden. Read the current snapshot independently
      // of the network-check throttle and offer eligibility.
      if (visible) {
        read();
      }
      const due = resumeCheckDue({
        lastCheck,
        now: page.now(),
        offerVisible: state.offerVisible,
        online: page.online(),
        visible,
      });
      // A resume on the home screen is an arrival: the dismissal clears even when the check is
      // throttled, so a version found by an earlier check shows again.
      if (visible && state.offerVisible) {
        update({ dismissed: false });
      }
      if (due) {
        arrivalCheck();
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
