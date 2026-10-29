// Updating to a newer version of a game the service worker (serviceWorker.ts) precached. The
// game has a home screen, where it may show an update plate whose button switches versions.

// The message a page posts to a waiting service worker to make it take over now.
// serviceWorker.ts imports only its type, so the built worker holds nothing else.
export const SKIP_WAITING_MESSAGE = "skip-waiting";
export type SkipWaitingMessage = typeof SKIP_WAITING_MESSAGE;

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

// A newer version than the one controlling the page: none found, still being checked for or
// installing, or installed and waiting behind the running one.
type NewerVersion = "none" | "pending" | "waiting";

export interface UpdateState {
  // A key, touch or click, or play started, since the page loaded.
  interacted: boolean;
  newer: NewerVersion;
  // The home screen is in front, never mid-game or in a menu over it.
  onHome: boolean;
  // navigator.onLine: false means there is no network to check for a newer version on.
  online: boolean;
  // The waiting version was told to take over, and the page reloads once it does.
  reloading: boolean;
  // The boot's wait for a newer version to be checked for and installed has run out.
  waitOver: boolean;
}

// wait: hold the boot, so a newer version can be checked for and installed first.
// run: run the version the page loaded, with no update plate.
// switch: have the waiting version take over and reload into it.
// prompt: show the home screen's update plate, whose button switches.
type UpdateAction = "prompt" | "run" | "switch" | "wait";

// Before the player has interacted, a waiting version takes over at once. On a fresh load the
// boot waits for the check and install, so that reload comes before the game draws. Once they
// have interacted the page never reloads on its own, and the update plate shows on each arrival
// home. A switch that has not reloaded by the end of the boot wait lets the game boot.
export function updateAction({
  interacted,
  newer,
  onHome,
  online,
  reloading,
  waitOver,
}: UpdateState): UpdateAction {
  if (reloading) {
    return waitOver ? "run" : "wait";
  }
  if (newer === "waiting") {
    if (!interacted) {
      return "switch";
    }
    return onHome ? "prompt" : "run";
  }
  return newer === "pending" && online && !interacted && !waitOver ? "wait" : "run";
}

// The shortest time between checks for a newer version when the page comes back into view, so
// switching apps on the home screen asks the server at most once a minute.
export const RESUME_CHECK_MS = 60_000;

export interface ResumeState {
  // When the last check for a newer version ran, on now()'s clock, if one has.
  lastCheck: number | undefined;
  now: number;
  onHome: boolean;
  online: boolean;
  // The page is in view: the app or tab came back to the front.
  visible: boolean;
}

// Whether the page coming back into view checks for a newer version. An installed app usually
// resumes without relaunching, so the launch's check can be long past, and a player resuming on
// the home screen never arrives there to check. Mid-game or in a menu, the next arrival home
// checks instead.
export function resumeCheckDue({ lastCheck, now, onHome, online, visible }: ResumeState): boolean {
  return (
    visible && onHome && online && (lastCheck === undefined || now - lastCheck >= RESUME_CHECK_MS)
  );
}

// The newer version a registration holds, and its worker once it waits. A first install has no
// controller to wait behind, so it never counts.
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

export interface UpdateFlow {
  // The plate's button: switch to the waiting version, or with none waiting reload, so the
  // browser fetches the newer version (a game may show the plate with none waiting, such as for
  // a save a newer version wrote). Does nothing while a switch is reloading.
  accept(): void;
  // Resolves once no newer version is about to take over, so the game may show its first screen
  // and write its save. Construct the game and load its assets meanwhile: only the first screen
  // and the save wait for this. It never resolves for a page that reloads first.
  readonly bootable: Promise<void>;
  endBootWait(): void;
  noteInteraction(): void;
  // The registration failed, so there is no newer version to wait for.
  noRegistration(): void;
  // Whether the home screen is in front. Each arrival home after input checks for a newer version.
  setOnHome(onHome: boolean): void;
  // Whether the page is in view. Coming back into view on the home screen checks for a newer
  // version, at most once per RESUME_CHECK_MS.
  setVisible(visible: boolean): void;
  // Follows the registration's newer versions, checking for one first unless offline.
  watch(registration: RegistrationLike): void;
}

// Acts on updateAction whenever its state changes: lets the game boot, switches to the waiting
// version, or shows the update plate through show(visible), the last only on a change. A page
// some version controls starts with a newer one pending, so the boot waits for watch or
// noRegistration; a first visit has none to wait for.
export function createUpdateFlow(
  container: ContainerLike,
  now: () => number,
  online: () => boolean,
  reload: () => void,
  show: (visible: boolean) => void,
): UpdateFlow {
  let state: UpdateState = {
    interacted: false,
    newer: container.controller === null ? "none" : "pending",
    onHome: false,
    online: online(),
    reloading: false,
    waitOver: false,
  };
  let lastCheck: number | undefined;
  let shown = false;
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
    if (action === "switch" && waitingWorker !== undefined) {
      switchVersion(waitingWorker);
    } else if (action === "run" || action === "prompt") {
      boot();
    }
    const visible = updateAction(state) === "prompt";
    if (visible !== shown) {
      shown = visible;
      show(visible);
    }
  };
  update({});
  return {
    accept() {
      if (state.reloading) {
        return;
      }
      if (waitingWorker === undefined) {
        reload();
        return;
      }
      switchVersion(waitingWorker);
      update({});
    },
    bootable,
    endBootWait: () => update({ waitOver: true }),
    noRegistration: () => update({ newer: "none" }),
    noteInteraction() {
      if (!state.interacted) {
        update({ interacted: true });
      }
    },
    setOnHome(onHome) {
      const arrived = onHome && !state.onHome && state.interacted;
      update({ onHome });
      if (arrived && online() && watched !== undefined) {
        check(watched).catch(() => undefined);
      }
    },
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
      // Follows the version installing now, whether its updatefound came before watch (the
      // browser's own check on navigation) or after; a listener added twice runs once.
      const read = () => {
        registration.installing?.addEventListener("statechange", read);
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

// Registers the service worker through register and hands the registration to flow.watch, or
// tells flow there is none when register rejects. A page some version controls registers at once,
// so its update check runs while the game loads. A first visit registers on the game's first
// arrival home, so the precache's downloads do not compete with the game's own. Returns the
// game's home hook, to call in place of flow.setOnHome on each change of whether the home screen
// is in front.
export function registerWhenDue(
  container: ContainerLike,
  flow: UpdateFlow,
  register: () => Promise<RegistrationLike>,
): (onHome: boolean) => void {
  let registered = false;
  const start = () => {
    registered = true;
    register().then(
      (registration) => flow.watch(registration),
      () => flow.noRegistration(),
    );
  };
  if (container.controller !== null) {
    start();
  }
  return (onHome) => {
    flow.setOnHome(onHome);
    if (onHome && !registered) {
      start();
    }
  };
}
