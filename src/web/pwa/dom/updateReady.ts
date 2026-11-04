// The page's side of updating: follows a service worker registration's newer versions and acts
// on updateAction's decisions. The policy is in ../updateReady.
import {
  type NewerVersion,
  resumeCheckDue,
  SKIP_WAITING_MESSAGE,
  updateAction,
  type UpdateFlowOptions,
  type UpdateState,
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

// The newer version a registration holds for a page some version controls, and its worker once it
// waits. A page no version controls reads none here: createUpdateFlow follows its newer versions
// itself, since its first install is the page's own build.
export function newerVersionOf(
  container: ContainerLike,
  registration: RegistrationLike,
): { newer: NewerVersion; worker?: ServiceWorkerLike } {
  if (container.controller === null) {
    return { newer: "none" };
  }
  if (registration.waiting !== null) {
    return { newer: "waiting", worker: registration.waiting };
  }
  return { newer: registration.installing === null ? "none" : "pending" };
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

// A page no version controls runs the build of the worker installing or waiting when watch
// begins (its first install), or of the registration's active worker when neither exists. Each
// worker that installs after that is a newer version: pending while it installs, and from installed
// on as good as waiting, whether it then waits or activates at once with no client to wait for. It
// never controls the page, so no worker switches it: accepting it reloads into it.
function uncontrolledNewerVersion(later: readonly ServiceWorkerLike[]): NewerVersion {
  if (later.some(({ state }) => ["activated", "activating", "installed"].includes(state))) {
    return "waiting";
  }
  return later.some(({ state }) => ["installing", "parsed"].includes(state)) ? "pending" : "none";
}

export interface UpdateFlow {
  // The plate's button: switch to the waiting version, or with none waiting reload, so the
  // browser fetches the newer version (a game may show the plate with none waiting, such as for
  // a save a newer version wrote). Does nothing while a switch is reloading.
  accept(): void;
  // Resolves once no newer version is about to take over, so the game may show its first screen
  // and write its save. Construct the game and load its assets meanwhile: only the first screen
  // and the save wait for this. It never resolves for a page that reloads first.
  readonly bootable: Promise<void>;
  // Starts an explicit offer visit and clears its dismissal, including while hidden.
  beginOfferVisit(): void;
  // Hides the offer for this visit without consuming or activating its waiting worker.
  dismissOffer(): void;
  endBootWait(): void;
  noteInteraction(): void;
  // The registration failed, so there is no newer version to wait for.
  noRegistration(): void;
  // Offer eligibility: whether the home screen, the only place the offer shows, is in front. Each
  // arrival after input checks for a newer version. Independent of registration and visit
  // lifetime.
  setOfferVisible(visible: boolean): void;
  // Whether the page is in view. Coming back into view on the home screen checks for a newer
  // version, at most once per RESUME_CHECK_MS.
  setVisible(visible: boolean): void;
  // Follows the registration's newer versions, checking for one first unless offline.
  watch(registration: RegistrationLike): void;
}

// Acts on updateAction whenever its state changes: lets the game boot, switches to the waiting
// version, or shows the update plate through show(visible), the last only on a change. A page
// some version controls starts with a newer one pending, so the boot waits for watch or
// noRegistration; a first visit has none to wait for. On a page no version controls, a newer
// version (see uncontrolledNewerVersion) follows the same rules as a waiting one, and switching
// to it reloads.
export function createUpdateFlow(
  container: ContainerLike,
  now: () => number,
  online: () => boolean,
  reload: () => void,
  show: (visible: boolean) => void,
  options: UpdateFlowOptions = {},
): UpdateFlow {
  let state: UpdateState = {
    activationPolicy: options.activationPolicy,
    interacted: false,
    newer: container.controller === null ? "none" : "pending",
    onHome: false,
    online: online(),
    reloading: false,
    waitOver: false,
  };
  let lastCheck: number | undefined;
  let shown = false;
  let dismissed = false;
  let waitingWorker: ServiceWorkerLike | undefined;
  let watched: RegistrationLike | undefined;
  let boot: () => void = () => undefined;
  const bootable = new Promise<void>((resolve) => {
    boot = resolve;
  });
  const check = (registration: RegistrationLike) => {
    lastCheck = now();
    return registration.update();
  };
  const switchVersion = (worker: ServiceWorkerLike) => {
    state = { ...state, reloading: true };
    activateWaitingWorker(container, reload, worker);
  };
  const update = (change: Partial<UpdateState>) => {
    state = { ...state, ...change };
    const action = updateAction(state);
    if (action === "switch") {
      if (waitingWorker === undefined) {
        state = { ...state, reloading: true };
        reload();
      } else {
        switchVersion(waitingWorker);
      }
    } else if (action === "run" || action === "prompt") {
      boot();
    }
    const visible = !dismissed && updateAction(state) === "prompt";
    if (visible !== shown) {
      shown = visible;
      show(visible);
    }
  };
  const setOfferVisible = (onHome: boolean) => {
    const arrived = onHome && !state.onHome && state.interacted;
    update({ onHome });
    if (arrived && online() && watched !== undefined) {
      check(watched).catch(() => undefined);
    }
  };
  update({});
  return {
    accept() {
      if (state.reloading) {
        return;
      }
      if (waitingWorker === undefined) {
        update({ reloading: true });
        reload();
        return;
      }
      switchVersion(waitingWorker);
      update({});
    },
    beginOfferVisit() {
      dismissed = false;
      update({});
    },
    bootable,
    dismissOffer() {
      dismissed = true;
      update({});
    },
    endBootWait: () => update({ waitOver: true }),
    noRegistration: () => update({ newer: "none" }),
    noteInteraction() {
      if (!state.interacted) {
        update({ interacted: true });
      }
    },
    setOfferVisible,
    setVisible(visible) {
      const due = resumeCheckDue({
        lastCheck,
        now: now(),
        onHome: state.onHome,
        online: online(),
        visible,
      });
      if (due && watched !== undefined) {
        check(watched).catch(() => undefined);
      }
    },
    watch(registration) {
      watched = registration;
      const own = registration.installing ?? registration.waiting;
      const later: ServiceWorkerLike[] = [];
      // Follows the version installing now, whether its updatefound came before watch (the
      // browser's own check on navigation) or after; a listener added twice runs once.
      const read = () => {
        const { installing } = registration;
        installing?.addEventListener("statechange", read);
        if (container.controller === null) {
          if (installing !== null && installing !== own && !later.includes(installing)) {
            later.push(installing);
          }
          waitingWorker = undefined;
          update({ newer: uncontrolledNewerVersion(later), online: online() });
          return;
        }
        const { newer, worker } = newerVersionOf(container, registration);
        waitingWorker = worker;
        update({ newer, online: online() });
      };
      registration.addEventListener("updatefound", read);
      // A version already waiting, a first install or no network: nothing to check first.
      const waiting = newerVersionOf(container, registration).newer === "waiting";
      if (waiting || container.controller === null || !online()) {
        read();
        return;
      }
      check(registration).then(read, read);
    },
  };
}
