// The page's side of updating: follows a service worker registration's waiting version and shows
// the update offer by offerShown. The policy is in ../updateReady.
import {
  offerShown,
  type OfferState,
  resumeCheckDue,
  SKIP_WAITING_MESSAGE,
} from "../updateReady.ts";

// The parts of the Service Worker API this uses, so tests can pass fakes.
export interface ServiceWorkerLike extends EventTarget {
  postMessage(message: unknown): void;
  readonly state: string;
}

export interface RegistrationLike extends EventTarget {
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

export interface UpdateFlow {
  // The offer's button: switch to the waiting version, or with none waiting reload into the
  // active one (a game may show its offer with none waiting, such as for a save a newer version
  // wrote). Does nothing while a switch is reloading.
  accept(): void;
  // Starts an explicit offer visit and clears its dismissal, including while hidden.
  beginOfferVisit(): void;
  // Hides the offer for this visit without consuming or activating its waiting worker.
  dismissOffer(): void;
  // A key, touch or click, or play started without input. Each arrival home after it checks for
  // a newer version.
  noteInteraction(): void;
  // Offer eligibility: whether the home screen, the only place the offer shows, is in front. Each
  // arrival after input checks for a newer version. Independent of registration and visit
  // lifetime.
  setOfferVisible(visible: boolean): void;
  // Whether the page is in view. Coming back into view on the home screen checks for a newer
  // version, at most once per RESUME_CHECK_MS.
  setVisible(visible: boolean): void;
  // Follows the registration's waiting version, checking for a newer one first on a controlled
  // page unless offline or one already waits.
  watch(registration: RegistrationLike): void;
}

// Shows the update offer through show(visible), on each change of offerShown. Nothing here delays
// the game or reloads the page on its own: the game shows its first screen at once, checks run in
// the background, and only accept() switches versions.
export function createUpdateFlow(
  container: ContainerLike,
  now: () => number,
  online: () => boolean,
  reload: () => void,
  show: (visible: boolean) => void,
): UpdateFlow {
  let state: OfferState = {
    dismissed: false,
    offerVisible: false,
    reloading: false,
    waiting: false,
  };
  let interacted = false;
  let lastCheck: number | undefined;
  let shown = false;
  let waitingWorker: ServiceWorkerLike | undefined;
  let watched: RegistrationLike | undefined;
  const check = (registration: RegistrationLike) => {
    lastCheck = now();
    return registration.update();
  };
  const update = (change: Partial<OfferState>) => {
    state = { ...state, ...change };
    const visible = offerShown(state);
    if (visible !== shown) {
      shown = visible;
      show(visible);
    }
  };
  return {
    accept() {
      if (state.reloading) {
        return;
      }
      update({ reloading: true });
      if (waitingWorker === undefined) {
        reload();
      } else {
        activateWaitingWorker(container, reload, waitingWorker);
      }
    },
    beginOfferVisit: () => update({ dismissed: false }),
    dismissOffer: () => update({ dismissed: true }),
    noteInteraction() {
      interacted = true;
    },
    setOfferVisible(offerVisible) {
      const arrived = offerVisible && !state.offerVisible && interacted;
      update({ offerVisible });
      if (arrived && online() && watched !== undefined) {
        check(watched).catch(() => undefined);
      }
    },
    setVisible(visible) {
      const due = resumeCheckDue({
        lastCheck,
        now: now(),
        offerVisible: state.offerVisible,
        online: online(),
        visible,
      });
      if (due && watched !== undefined) {
        check(watched).catch(() => undefined);
      }
    },
    watch(registration) {
      watched = registration;
      // Follows the version installing now, whether its updatefound came before watch (the
      // browser's own check on navigation) or after, until it waits; a listener added twice runs
      // once.
      const read = () => {
        registration.installing?.addEventListener("statechange", read);
        waitingWorker = waitingWorkerOf(container, registration);
        update({ waiting: waitingWorker !== undefined });
      };
      registration.addEventListener("updatefound", read);
      // A version already waiting, a first install or no network: nothing to check first.
      const waiting = waitingWorkerOf(container, registration) !== undefined;
      if (waiting || container.controller === null || !online()) {
        read();
        return;
      }
      check(registration).then(read, read);
    },
  };
}
