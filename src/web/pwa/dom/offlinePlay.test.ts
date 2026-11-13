import { afterEach, describe, expect, it, vi } from "vitest";

import { type RequiredUpdateState, RESUME_CHECK_MS, SKIP_WAITING_MESSAGE } from "../updateReady.ts";
import {
  INTERACTION_EVENTS,
  type OfflineActivity,
  type OfflinePage,
  type OfflinePlay,
  type RegisteringContainer,
  startOfflinePlay,
} from "./offlinePlay.ts";
import {
  CONTROL_RELOAD_KEY,
  type RegistrationLike,
  type ServiceWorkerLike,
  type SessionLike,
  SWITCH_TIMEOUT_MS,
} from "./updateReady.ts";
import type { VisibilitySource } from "./visibility.ts";

class FakeDocument extends EventTarget implements VisibilitySource {
  visibilityState: DocumentVisibilityState = "visible";

  setVisibility(state: DocumentVisibilityState): void {
    this.visibilityState = state;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}

const OPTIONS = { serviceWorkerUrl: "/sw.js?sound=ogg" };

class FakeWorker extends EventTarget implements ServiceWorkerLike {
  readonly messages: unknown[] = [];
  state = "installed";

  postMessage(message: unknown, transfer?: Transferable[]): void {
    this.messages.push((message as { type?: unknown })?.type ?? message);
    (transfer?.[0] as MessagePort | undefined)?.postMessage("activating");
  }
}

// A deployed version: waiting behind the running one, still installing, or none newer.
type Deployed = "installing" | "none" | "waiting";

// What an update check finds: nothing newer, a newer version that starts installing, or no server.
type Found = "fails" | "installs" | "none";

class FakeRegistration extends EventTarget implements RegistrationLike {
  active: FakeWorker | null = null;
  found: Found = "none";
  installing: FakeWorker | null = null;
  updates = 0;
  waiting: FakeWorker | null = null;

  constructor(deployed: Deployed) {
    super();
    if (deployed === "installing") {
      this.installing = new FakeWorker();
    } else if (deployed === "waiting") {
      this.waiting = new FakeWorker();
    }
  }

  update(): Promise<unknown> {
    this.updates += 1;
    if (this.found === "fails") {
      return Promise.reject(new Error("offline"));
    }
    if (this.found === "installs") {
      foundInstall(this);
    }
    return Promise.resolve();
  }
}

class FakeSession implements SessionLike {
  readonly items = new Map<string, string>();

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  removeItem(key: string): void {
    this.items.delete(key);
  }

  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

class FakeContainer extends EventTarget implements RegisteringContainer {
  readonly registered: [string, { scope: string }][] = [];

  constructor(
    readonly controller: unknown,
    private readonly registration: Promise<RegistrationLike>,
    private readonly controllerOnChange: () => ServiceWorkerLike | null,
  ) {
    super();
  }

  getRegistration(): Promise<RegistrationLike | undefined> {
    return Promise.resolve(undefined);
  }

  override dispatchEvent(event: Event): boolean {
    if (event.type === "controllerchange") {
      Object.defineProperty(this, "controller", {
        configurable: true,
        value: this.controllerOnChange(),
      });
    }
    return super.dispatchEvent(event);
  }

  register(url: string, options: { scope: string }): Promise<RegistrationLike> {
    this.registered.push([url, options]);
    return this.registration;
  }
}

const settle = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

// A page a version controls (controlled) or a first visit, whose registration finds deployed, or
// fails. It starts online unless offline, with the tab's session storage if given.
function openPage(
  controlled: boolean,
  deployed: Deployed | "fails",
  onOfflineActivity?: (activity: OfflineActivity) => void,
  {
    autoLaunch = true,
    offline = false,
    session,
  }: { offline?: boolean; session?: SessionLike | undefined; autoLaunch?: boolean } = {},
) {
  const registration = deployed === "fails" ? undefined : new FakeRegistration(deployed);
  const container = new FakeContainer(
    controlled ? {} : null,
    registration === undefined
      ? Promise.reject(new Error("no worker"))
      : Promise.resolve(registration),
    () => registration?.waiting ?? registration?.active ?? null,
  );
  const clock = { now: 0, online: !offline, reloads: 0 };
  const required: RequiredUpdateState[] = [];
  const shown: boolean[] = [];
  const visibilitySource = new FakeDocument();
  const page: OfflinePage = {
    container,
    eventTarget: new EventTarget(),
    now: () => clock.now,
    online: () => clock.online,
    reload: () => {
      clock.reloads += 1;
    },
    session,
    visibilitySource,
  };
  const play = startOfflinePlay(
    {
      ...OPTIONS,
      ...(onOfflineActivity === undefined ? {} : { onOfflineActivity }),
      onRequireNewer: (state) => required.push(state),
      onUpdateShown: (visible) => shown.push(visible),
    },
    page,
  );
  if (autoLaunch) {
    void play.launchReady();
  }
  return { clock, container, page, play, registration, required, shown, visibilitySource };
}

// The home screen coming to the front or leaving it, as a game reports it: it shows or hides the
// update offer, and its arrival readies first registration.
function showHome(play: OfflinePlay, offerVisible: boolean): void {
  play.flow.setOfferVisible(offerVisible);
  if (offerVisible) {
    play.registrationReady();
  }
}

function requireRegistration(registration: FakeRegistration | undefined): FakeRegistration {
  if (registration === undefined) {
    throw new Error("Missing test registration");
  }
  return registration;
}

// The registration's worker from the start, set installing.
function startInstall(registration: FakeRegistration | undefined): FakeWorker {
  const worker = requireRegistration(registration).installing;
  if (worker === null) {
    throw new Error("Missing test installer");
  }
  worker.state = "installing";
  return worker;
}

// A new worker found installing on the registration.
function foundInstall(registration: FakeRegistration | undefined): FakeWorker {
  const found = requireRegistration(registration);
  const worker = new FakeWorker();
  worker.state = "installing";
  found.installing = worker;
  found.dispatchEvent(new Event("updatefound"));
  return worker;
}

// The installing worker leaving the "installing" state for state, waiting once installed.
function endInstall(
  registration: FakeRegistration | undefined,
  worker: FakeWorker,
  state: string,
): void {
  const found = requireRegistration(registration);
  found.installing = null;
  if (state === "installed") {
    found.waiting = worker;
  }
  worker.state = state;
  worker.dispatchEvent(new Event("statechange"));
}

// The installing worker activating as the registration's first version, through "activating" to
// "activated".
function activateInstall(registration: FakeRegistration | undefined, worker: FakeWorker): void {
  const found = requireRegistration(registration);
  found.installing = null;
  found.waiting = null;
  found.active = worker;
  for (const state of ["activating", "activated"]) {
    worker.state = state;
    worker.dispatchEvent(new Event("statechange"));
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("startOfflinePlay", () => {
  it("snapshots launch before registering and never arms a later installed worker", async () => {
    const { container, play, registration } = openPage(true, "installing", undefined, {
      autoLaunch: false,
    });
    const found = requireRegistration(registration);
    const worker = startInstall(found);
    const lookup = vi.spyOn(container, "getRegistration").mockResolvedValue(found);
    expect(container.registered).toEqual([]);
    play.registrationReady();
    expect(container.registered).toEqual([]);
    expect(await play.launchReady()).toBe("continue");
    expect(container.registered).toHaveLength(1);
    endInstall(found, worker, "installed");
    play.flow.arriveHome();
    play.flow.setVisible(true);
    expect(await play.launchReady()).toBe("continue");
    expect(lookup).toHaveBeenCalledOnce();
    expect(worker.messages).toEqual([]);
  });

  it("activates only a complete waiting launch snapshot before game startup", async () => {
    const { clock, container, play, registration } = openPage(true, "waiting", undefined, {
      autoLaunch: false,
    });
    vi.spyOn(container, "getRegistration").mockResolvedValue(requireRegistration(registration));
    const launch = play.launchReady();
    await settle();
    expect(container.registered).toEqual([]);
    expect(registration?.waiting?.messages).toEqual([SKIP_WAITING_MESSAGE]);
    container.dispatchEvent(new Event("controllerchange"));
    expect(await launch).toBe("reloading");
    expect(clock.reloads).toBe(1);
  });

  it("never substitutes a later worker for a redundant launch candidate", async () => {
    const { clock, container, play, registration } = openPage(true, "waiting", undefined, {
      autoLaunch: false,
    });
    const found = requireRegistration(registration);
    const candidate = found.waiting;
    if (candidate === null) {
      throw new Error("Missing candidate");
    }
    vi.spyOn(candidate, "postMessage").mockImplementation(() => {
      candidate.state = "redundant";
      found.waiting = new FakeWorker();
      candidate.dispatchEvent(new Event("statechange"));
    });
    vi.spyOn(container, "getRegistration").mockResolvedValue(found);
    expect(await play.launchReady()).toBe("blocked");
    expect(await play.launchReady()).toBe("blocked");
    expect(found.waiting?.messages).toEqual([]);
    container.dispatchEvent(new Event("controllerchange"));
    expect(clock.reloads).toBe(0);
  });

  it("resets a blocked Update now so the offer can retry without reload listener leaks", async () => {
    const { clock, container, play, registration, shown } = openPage(true, "waiting");
    await settle();
    showHome(play, true);
    const worker = requireRegistration(registration).waiting;
    if (worker === null) {
      throw new Error("Missing candidate");
    }
    const post = vi.spyOn(worker, "postMessage").mockImplementation((_, transfer) => {
      (transfer?.[0] as MessagePort).postMessage("blocked");
    });
    expect(await play.flow.accept()).toBe("blocked");
    expect(shown).toEqual([true, false, true]);
    container.dispatchEvent(new Event("controllerchange"));
    expect(clock.reloads).toBe(0);
    post.mockRestore();
    const retry = play.flow.accept();
    container.dispatchEvent(new Event("controllerchange"));
    expect(await retry).toBe("reloading");
    expect(clock.reloads).toBe(1);
  });

  it("bounds an unanswered activation handshake and removes the reload listener", async () => {
    vi.useFakeTimers();
    const { clock, container, play, registration } = openPage(true, "waiting", undefined, {
      autoLaunch: false,
    });
    const found = requireRegistration(registration);
    vi.spyOn(container, "getRegistration").mockResolvedValue(found);
    if (found.waiting === null) {
      throw new Error("Missing candidate");
    }
    vi.spyOn(found.waiting, "postMessage").mockImplementation(() => undefined);
    const launch = play.launchReady();
    await vi.advanceTimersByTimeAsync(SWITCH_TIMEOUT_MS);
    expect(await launch).toBe("blocked");
    container.dispatchEvent(new Event("controllerchange"));
    expect(clock.reloads).toBe(0);
  });

  it("does not report reloading on acceptance without control and safely bounds the wait", async () => {
    vi.useFakeTimers();
    const { clock, container, play, registration } = openPage(true, "waiting", undefined, {
      autoLaunch: false,
    });
    vi.spyOn(container, "getRegistration").mockResolvedValue(requireRegistration(registration));
    const launch = play.launchReady();
    let result: unknown;
    void launch.then((value) => {
      result = value;
    });
    await vi.advanceTimersByTimeAsync(SWITCH_TIMEOUT_MS - 1);
    expect(result).toBeUndefined();
    expect(clock.reloads).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(await launch).toBe("blocked");
    container.dispatchEvent(new Event("controllerchange"));
    expect(clock.reloads).toBe(0);
  });

  it("resolves first-visit launch without lookup or registration", async () => {
    const { container, play } = openPage(false, "installing", undefined, { autoLaunch: false });
    const lookup = vi.spyOn(container, "getRegistration");
    expect(await play.launchReady()).toBe("continue");
    expect(lookup).not.toHaveBeenCalled();
    expect(container.registered).toEqual([]);
    play.registrationReady();
    expect(container.registered).toHaveLength(1);
  });

  it("bounds registration lookup and ignores a waiting candidate returned after startup continues", async () => {
    vi.useFakeTimers();
    const { clock, container, play, registration } = openPage(true, "waiting", undefined, {
      autoLaunch: false,
    });
    let finishLookup: ((registration: RegistrationLike) => void) | undefined;
    vi.spyOn(container, "getRegistration").mockReturnValue(
      new Promise((resolve) => {
        finishLookup = resolve;
      }),
    );
    const launch = play.launchReady();
    await vi.advanceTimersByTimeAsync(SWITCH_TIMEOUT_MS);
    expect(await launch).toBe("blocked");
    expect(container.registered).toHaveLength(1);
    finishLookup?.(requireRegistration(registration));
    await vi.advanceTimersByTimeAsync(0);
    expect(registration?.waiting?.messages).toEqual([]);
    expect(clock.reloads).toBe(0);
  });

  it("reloads on explicit acceptance after another document already activated the offered worker", async () => {
    const { clock, container, play, registration } = openPage(true, "waiting");
    await settle();
    const found = requireRegistration(registration);
    const worker = found.waiting;
    if (worker === null) {
      throw new Error("Missing worker");
    }
    worker.state = "activated";
    found.waiting = null;
    found.active = worker;
    container.dispatchEvent(new Event("controllerchange"));
    expect(clock.reloads).toBe(0);
    expect(await play.flow.accept()).toBe("reloading");
    expect(clock.reloads).toBe(1);
    expect(worker.messages).toEqual([]);
  });
  it("defers first registration until client readiness after its prepared frame independently of offers", async () => {
    const { container, play } = openPage(false, "none");
    play.flow.setOfferVisible(true);
    play.flow.setOfferVisible(false);
    play.flow.setOfferVisible(true);
    expect(container.registered).toEqual([]);
    play.registrationReady();
    expect(container.registered).toEqual([[OPTIONS.serviceWorkerUrl, { scope: "/" }]]);
    await settle();
    play.registrationReady();
    play.flow.setOfferVisible(false);
    play.flow.setOfferVisible(true);
    expect(container.registered).toHaveLength(1);
  });

  it("hides a version that waits after a dismissal until the next arrival home", async () => {
    const { play, registration, shown } = openPage(true, "none");
    await settle();
    play.flow.arriveHome();
    showHome(play, true);
    play.flow.dismissOffer();
    const worker = foundInstall(registration);
    endInstall(registration, worker, "installed");
    expect(shown).toEqual([]);
    play.flow.arriveHome();
    expect(shown).toEqual([true]);
  });

  it("reports a first visit's precache from its registration request until its install ends", async () => {
    const activities: OfflineActivity[] = [];
    const { play, registration } = openPage(false, "installing", (activity) =>
      activities.push(activity),
    );
    const worker = startInstall(registration);
    expect(activities).toEqual(["idle"]);
    play.registrationReady();
    expect(activities).toEqual(["idle", "precaching"]);
    await settle();
    expect(activities).toEqual(["idle", "precaching"]);
    endInstall(registration, worker, "installed");
    expect(activities).toEqual(["idle", "precaching", "idle"]);
  });

  it("ends a first visit's precache when registration fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const activities: OfflineActivity[] = [];
    const { play } = openPage(false, "fails", (activity) => activities.push(activity));
    play.registrationReady();
    expect(activities).toEqual(["idle", "precaching"]);
    await settle();
    expect(activities).toEqual(["idle", "precaching", "idle"]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  // A hard reload has no controller while a worker is already installed and waiting or active.
  it.each<Deployed>(["none", "waiting"])(
    "ends a first visit's precache when registration resolves with %s and no worker installing",
    async (deployed) => {
      const activities: OfflineActivity[] = [];
      const { play } = openPage(false, deployed, (activity) => activities.push(activity));
      play.registrationReady();
      expect(activities).toEqual(["idle", "precaching"]);
      await settle();
      expect(activities).toEqual(["idle", "precaching", "idle"]);
    },
  );

  it.each<[string, Deployed, "installed" | "redundant"]>([
    ["after its precache install", "installing", "installed"],
    ["after its precache install fails", "installing", "redundant"],
    ["after a precache that found no worker installing", "none", "installed"],
  ])("reports a first visit's later install as updating %s", async (_, deployed, ended) => {
    const activities: OfflineActivity[] = [];
    const { play, registration } = openPage(false, deployed, (activity) =>
      activities.push(activity),
    );
    const own = registration?.installing ?? null;
    if (own !== null) {
      own.state = "installing";
    }
    play.registrationReady();
    await settle();
    if (own !== null) {
      endInstall(registration, own, ended);
    }
    expect(activities).toEqual(["idle", "precaching", "idle"]);
    const later = foundInstall(registration);
    expect(activities).toEqual(["idle", "precaching", "idle", "updating"]);
    endInstall(registration, later, "redundant");
    expect(activities).toEqual(["idle", "precaching", "idle", "updating", "idle"]);
  });

  it("reports a controlled page's installs as updating and its registration alone as idle", async () => {
    const activities: OfflineActivity[] = [];
    const { container, registration } = openPage(true, "installing", (activity) =>
      activities.push(activity),
    );
    const worker = startInstall(registration);
    expect(container.registered).toHaveLength(0);
    expect(activities).toEqual(["idle"]);
    await settle();
    expect(activities).toEqual(["idle", "updating"]);
    endInstall(registration, worker, "installed");
    expect(activities).toEqual(["idle", "updating", "idle"]);
    foundInstall(registration);
    expect(activities).toEqual(["idle", "updating", "idle", "updating"]);
  });

  it("keeps a controlled page idle when its registration finds no worker installing", async () => {
    const activities: OfflineActivity[] = [];
    const { container } = openPage(true, "none", (activity) => activities.push(activity));
    expect(container.registered).toHaveLength(0);
    await settle();
    expect(container.registered).toHaveLength(1);
    expect(activities).toEqual(["idle"]);
  });

  it("isolates a throwing activity callback from registration", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const activities: OfflineActivity[] = [];
    const { container, play } = openPage(false, "none", (activity) => {
      activities.push(activity);
      throw new Error("observer");
    });
    play.registrationReady();
    await settle();
    expect(activities).toEqual(["idle", "precaching", "idle"]);
    expect(errors).toHaveBeenCalledTimes(3);
    expect(errors).toHaveBeenCalledWith("Offline activity callback failed.", expect.any(Error));
    expect(container.registered).toHaveLength(1);
  });

  // Each step is true for the home screen in front, false for it hidden.
  it.each<[string, boolean, boolean[], number]>([
    ["registers a controlled page at once", true, [], 1],
    ["holds a first visit's registration until home shows", false, [false], 0],
    ["registers a first visit on its first arrival home", false, [false, true], 1],
  ])("%s", async (_, controlled, steps, registrations) => {
    const { container, play } = openPage(controlled, "none");
    steps.forEach((step) => showHome(play, step));
    await settle();
    expect(container.registered).toEqual(
      Array.from({ length: registrations }, () => [OPTIONS.serviceWorkerUrl, { scope: "/" }]),
    );
  });

  it("never asks the game to wait and never switches or reloads on its own", async () => {
    vi.useFakeTimers();
    const { clock, play, registration, shown } = openPage(true, "waiting");
    const installing = foundInstall(registration);
    showHome(play, true);
    await vi.advanceTimersByTimeAsync(10 * RESUME_CHECK_MS);
    endInstall(registration, installing, "redundant");
    expect(Object.keys(play).sort()).toEqual(["flow", "launchReady", "registrationReady"]);
    expect(Object.keys(play.flow).sort()).toEqual([
      "accept",
      "arriveHome",
      "dismissOffer",
      "noteInteraction",
      "noteOnline",
      "requireNewer",
      "setOfferVisible",
      "setVisible",
      "watch",
    ]);
    expect({ messages: registration?.waiting?.messages, reloads: clock.reloads }).toEqual({
      messages: [],
      reloads: 0,
    });
    expect(shown).toEqual([true]);
  });

  // A waiting version is offered on the home screen, whether or not the player has interacted.
  it.each<[string, string | undefined]>([
    ...INTERACTION_EVENTS.map((type): [string, string] => [type, type]),
    ["no input", undefined],
  ])("on a controlled page, offers a waiting version after %s", async (_, interaction) => {
    const { clock, page, play, registration, shown } = openPage(true, "waiting");
    if (interaction !== undefined) {
      page.eventTarget.dispatchEvent(new Event(interaction));
    }
    await settle();
    expect(shown).toEqual([]);
    showHome(play, true);
    expect(shown).toEqual([true]);
    showHome(play, false);
    expect(shown).toEqual([true, false]);
    expect({ messages: registration?.waiting?.messages, reloads: clock.reloads }).toEqual({
      messages: [],
      reloads: 0,
    });
  });

  it("offers a version once its background install has finished and it waits", async () => {
    const { play, registration, shown } = openPage(true, "none");
    await settle();
    showHome(play, true);
    const worker = foundInstall(registration);
    expect(shown).toEqual([]);
    endInstall(registration, worker, "installed");
    expect(shown).toEqual([true]);
  });

  it("switches to the waiting version on accept, and reloads once it controls the page", async () => {
    const { clock, container, play, registration, shown } = openPage(true, "waiting");
    await settle();
    showHome(play, true);
    play.flow.accept();
    play.flow.accept();
    expect(registration?.waiting?.messages).toEqual([SKIP_WAITING_MESSAGE]);
    expect({ reloads: clock.reloads, shown }).toEqual({ reloads: 0, shown: [true, false] });
    container.dispatchEvent(new Event("controllerchange"));
    container.dispatchEvent(new Event("controllerchange"));
    expect(clock.reloads).toBe(1);
  });

  // A controlled page with a version waiting, arrived home and shown the offer, then dismissed.
  async function dismissedHome(offline = false) {
    const opened = openPage(true, "waiting", undefined, { offline });
    await settle();
    opened.play.flow.arriveHome();
    showHome(opened.play, true);
    opened.play.flow.dismissOffer();
    await settle();
    const updates = requireRegistration(opened.registration).updates;
    return { ...opened, checks: () => requireRegistration(opened.registration).updates - updates };
  }

  it("keeps the offer hidden after closing a card on the home screen, without checking", async () => {
    const { checks, page, play, shown } = await dismissedHome();
    play.flow.setOfferVisible(false);
    page.eventTarget.dispatchEvent(new Event("pointerdown"));
    play.flow.noteInteraction();
    play.flow.setOfferVisible(true);
    expect({ checks: checks(), shown }).toEqual({ checks: 0, shown: [true, false] });
  });

  it.each<[string, (play: OfflinePlay) => void]>([
    [
      "arriving before the offer is eligible",
      (play) => {
        play.flow.arriveHome();
        showHome(play, true);
      },
    ],
    [
      "arriving after the offer is eligible",
      (play) => {
        showHome(play, true);
        play.flow.arriveHome();
      },
    ],
  ])("shows the offer again on a return to the title from play, %s", async (_, arrive) => {
    const { checks, clock, play, registration, shown } = await dismissedHome();
    showHome(play, false);
    arrive(play);
    expect({ checks: checks(), shown }).toEqual({ checks: 1, shown: [true, false, true] });
    expect({ messages: registration?.waiting?.messages, reloads: clock.reloads }).toEqual({
      messages: [],
      reloads: 0,
    });
  });

  it("shows the offer again on an offline return to the title, without checking", async () => {
    const { checks, play, shown } = await dismissedHome(true);
    showHome(play, false);
    play.flow.arriveHome();
    showHome(play, true);
    expect({ checks: checks(), shown }).toEqual({ checks: 0, shown: [true, false, true] });
  });

  // A minimized installed app stays alive, so a resume on the home screen counts as an arrival.
  it.each<[string, number, number]>([
    ["a minute after the last check, checking once", RESUME_CHECK_MS, 1],
    ["within a minute of the last check, without checking", RESUME_CHECK_MS - 1, 0],
  ])("shows the offer again on a resume on the home screen %s", async (_, now, expected) => {
    const { checks, clock, shown, visibilitySource } = await dismissedHome();
    clock.now = now;
    visibilitySource.setVisibility("hidden");
    visibilitySource.setVisibility("visible");
    expect({ checks: checks(), shown }).toEqual({ checks: expected, shown: [true, false, true] });
  });

  it("keeps a dismissal through a resume while the offer is not eligible", async () => {
    const { checks, clock, play, shown, visibilitySource } = await dismissedHome();
    showHome(play, false);
    clock.now = RESUME_CHECK_MS;
    visibilitySource.setVisibility("hidden");
    visibilitySource.setVisibility("visible");
    showHome(play, true);
    expect({ checks: checks(), shown }).toEqual({ checks: 0, shown: [true, false] });
  });

  // The game arrives home on its first launch, before or after watch's first check starts.
  it.each<[string, boolean]>([
    ["before the registration is watched", false],
    ["while the first check is under way", true],
  ])("checks once on first launch when arriving %s", async (_, afterWatch) => {
    const { play, registration } = openPage(true, "none");
    const found = requireRegistration(registration);
    found.update = () => {
      found.updates += 1;
      return new Promise(() => {
        // The check never settles, so it stays under way.
      });
    };
    if (afterWatch) {
      await settle();
    }
    play.flow.arriveHome();
    showHome(play, true);
    await settle();
    expect(found.updates).toBe(1);
  });

  // A page no version controls loaded from the network, and the next launch runs the newest
  // installed version, so no worker is ever offered there.
  it.each<[string, Deployed, string[]]>([
    ["its own first install", "installing", []],
    ["a later worker that waits", "installing", ["installing", "installed"]],
    ["a later worker that activates", "installing", ["installing", "installed", "activated"]],
    ["a later worker with none installing at watch", "none", ["installing", "installed"]],
    ["a worker already waiting at watch", "waiting", []],
  ])("on an uncontrolled page, offers nothing for %s", async (_, deployed, later) => {
    const { clock, page, play, registration, shown } = openPage(false, deployed);
    const found = requireRegistration(registration);
    const own = found.installing;
    if (own !== null) {
      own.state = "installing";
    }
    page.eventTarget.dispatchEvent(new Event("pointerdown"));
    showHome(play, true);
    await settle();
    if (own !== null) {
      endInstall(found, own, "installed");
    }
    const worker = new FakeWorker();
    later.forEach((state, index) => {
      worker.state = state;
      if (index === 0) {
        found.installing = worker;
        found.dispatchEvent(new Event("updatefound"));
        return;
      }
      found.installing = null;
      found.waiting = state === "installed" ? worker : null;
      worker.dispatchEvent(new Event("statechange"));
    });
    showHome(play, false);
    showHome(play, true);
    expect({ messages: found.waiting?.messages ?? [], reloads: clock.reloads, shown }).toEqual({
      messages: [],
      reloads: 0,
      shown: [],
    });
  });

  // On the home screen a minute after the launch's check, coming back into view checks again.
  it.each<[string, number, (page: ReturnType<typeof openPage>) => void]>([
    [
      "the page shown again",
      1,
      ({ visibilitySource }) => {
        visibilitySource.setVisibility("hidden");
        visibilitySource.setVisibility("visible");
      },
    ],
    [
      "a return from the back-forward cache",
      1,
      ({ page }) => {
        page.eventTarget.dispatchEvent(new Event("pagehide"));
        page.eventTarget.dispatchEvent(new Event("pageshow"));
      },
    ],
    [
      "a pageshow while already visible",
      0,
      ({ page }) => page.eventTarget.dispatchEvent(new Event("pageshow")),
    ],
  ])("after %s, checks for a newer version %i more times", async (_, checks, resume) => {
    const opened = openPage(true, "none");
    await settle();
    showHome(opened.play, true);
    const before = opened.registration?.updates ?? 0;
    opened.clock.now = RESUME_CHECK_MS;
    resume(opened);
    expect((opened.registration?.updates ?? 0) - before).toBe(checks);
  });
});

describe("requireNewer", () => {
  it.each(["online", "visible"] as const)(
    "keeps the newer-save requirement latched after a blocked switch and retries on %s",
    async (retry) => {
      const { clock, container, page, play, registration, required, shown, visibilitySource } =
        openPage(true, "waiting");
      await settle();
      showHome(play, true);
      const worker = requireRegistration(registration).waiting;
      if (worker === null) {
        throw new Error("Missing worker");
      }
      const post = vi.spyOn(worker, "postMessage").mockImplementation((_, transfer) => {
        (transfer?.[0] as MessagePort).postMessage("blocked");
      });
      play.flow.requireNewer();
      await vi.waitFor(() => expect(required).toEqual(["updating", "unavailable"]));
      expect(clock.reloads).toBe(0);
      play.flow.requireNewer();
      play.flow.setOfferVisible(false);
      play.flow.setOfferVisible(true);
      expect(post).toHaveBeenCalledOnce();
      expect(shown).toEqual([true, false]);
      post.mockRestore();
      if (retry === "online") {
        page.eventTarget.dispatchEvent(new Event("online"));
      } else {
        visibilitySource.setVisibility("hidden");
        visibilitySource.setVisibility("visible");
      }
      expect(worker.messages).toEqual([SKIP_WAITING_MESSAGE]);
      expect(required).toEqual(["updating", "unavailable", "updating"]);
      container.dispatchEvent(new Event("controllerchange"));
      await settle();
      expect(clock.reloads).toBe(1);
      expect(shown).toEqual([true, false]);
      // No ready/unblocked report is emitted to the caller holding the save guard.
      expect(required.at(-1)).toBe("updating");
    },
  );

  it("retries a replacement after a required activation candidate becomes redundant", async () => {
    const { clock, container, page, play, registration, required, shown } = openPage(
      true,
      "waiting",
    );
    await settle();
    const found = requireRegistration(registration);
    const original = found.waiting;
    if (original === null) {
      throw new Error("Missing worker");
    }
    const post = vi.spyOn(original, "postMessage").mockImplementation(() => undefined);
    play.flow.requireNewer();
    original.state = "redundant";
    found.waiting = null;
    original.dispatchEvent(new Event("statechange"));
    await settle();
    expect(required).toEqual(["updating", "unavailable"]);
    expect(clock.reloads).toBe(0);
    const replacement = new FakeWorker();
    found.waiting = replacement;
    page.eventTarget.dispatchEvent(new Event("online"));
    expect(replacement.messages).toEqual([SKIP_WAITING_MESSAGE]);
    container.dispatchEvent(new Event("controllerchange"));
    await settle();
    expect(clock.reloads).toBe(1);
    expect(required).toEqual(["updating", "unavailable", "updating"]);
    expect(shown).toEqual([]);
    post.mockRestore();
  });

  it("reports a rejected activation helper as unavailable and retains the retryable requirement", async () => {
    const { clock, container, page, play, registration, required, shown } = openPage(
      true,
      "waiting",
    );
    await settle();
    const NativeMessageChannel = globalThis.MessageChannel;
    vi.stubGlobal(
      "MessageChannel",
      class {
        constructor() {
          throw new Error("channel unavailable");
        }
      },
    );
    play.flow.requireNewer();
    await settle();
    expect(required).toEqual(["updating", "unavailable"]);
    expect(clock.reloads).toBe(0);
    vi.stubGlobal("MessageChannel", NativeMessageChannel);
    page.eventTarget.dispatchEvent(new Event("online"));
    expect(registration?.waiting?.messages).toEqual([SKIP_WAITING_MESSAGE]);
    container.dispatchEvent(new Event("controllerchange"));
    await settle();
    expect(clock.reloads).toBe(1);
    expect(shown).toEqual([]);
    vi.unstubAllGlobals();
  });

  it("keeps ordinary title arrivals and visibility resumes offer-only until requireNewer", async () => {
    const { clock, container, play, registration, required, visibilitySource } = openPage(
      true,
      "none",
    );
    await settle();
    const worker = foundInstall(registration);
    endInstall(registration, worker, "installed");
    showHome(play, true);
    play.flow.arriveHome();
    clock.now = RESUME_CHECK_MS;
    visibilitySource.setVisibility("hidden");
    visibilitySource.setVisibility("visible");
    await settle();
    expect(worker.messages).toEqual([]);
    expect(required).toEqual([]);
    expect(clock.reloads).toBe(0);
    play.flow.requireNewer();
    expect(worker.messages).toEqual([SKIP_WAITING_MESSAGE]);
    container.dispatchEvent(new Event("controllerchange"));
    await settle();
    expect(clock.reloads).toBe(1);
  });

  it("reloads a required old document if another client activated its candidate after a blocked attempt", async () => {
    const { clock, container, page, play, registration, required, shown } = openPage(
      true,
      "waiting",
    );
    await settle();
    const found = requireRegistration(registration);
    const candidate = found.waiting;
    if (candidate === null) {
      throw new Error("Missing worker");
    }
    const post = vi.spyOn(candidate, "postMessage").mockImplementation((_, transfer) => {
      (transfer?.[0] as MessagePort).postMessage("blocked");
    });
    play.flow.requireNewer();
    await vi.waitFor(() => expect(required).toEqual(["updating", "unavailable"]));
    candidate.state = "activated";
    found.waiting = null;
    found.active = candidate;
    container.dispatchEvent(new Event("controllerchange"));
    expect(clock.reloads).toBe(0);
    page.eventTarget.dispatchEvent(new Event("online"));
    expect(clock.reloads).toBe(1);
    expect(required).toEqual(["updating", "unavailable", "updating"]);
    expect(shown).toEqual([]);
    post.mockRestore();
  });

  it("activates a waiting version at once, before or after registration, and reloads into it", async () => {
    const { clock, container, play, registration, required, shown } = openPage(true, "waiting");
    showHome(play, true);
    play.flow.requireNewer();
    expect(required).toEqual(["updating"]);
    await settle();
    expect(registration?.waiting?.messages).toEqual([SKIP_WAITING_MESSAGE]);
    expect({ reloads: clock.reloads, shown }).toEqual({ reloads: 0, shown: [] });
    container.dispatchEvent(new Event("controllerchange"));
    container.dispatchEvent(new Event("controllerchange"));
    expect({ reloads: clock.reloads, required }).toEqual({ reloads: 1, required: ["updating"] });
  });

  it("checks for a newer version, and activates it once it is installed and verified", async () => {
    const { clock, container, play, registration, required, shown } = openPage(true, "none");
    await settle();
    showHome(play, true);
    const found = requireRegistration(registration);
    found.found = "installs";
    play.flow.requireNewer();
    expect({ required, updates: found.updates }).toEqual({ required: ["updating"], updates: 2 });
    const worker = found.installing;
    if (worker === null) {
      throw new Error("Missing test installer");
    }
    await settle();
    expect(worker.messages).toEqual([]);
    endInstall(found, worker, "installed");
    expect(worker.messages).toEqual([SKIP_WAITING_MESSAGE]);
    container.dispatchEvent(new Event("controllerchange"));
    expect({ reloads: clock.reloads, required, shown }).toEqual({
      reloads: 1,
      required: ["updating"],
      shown: [],
    });
  });

  it.each<[string, Found]>([
    ["the server has nothing newer", "none"],
    ["the check fails", "fails"],
  ])("reports unavailable when %s", async (_, found) => {
    const { clock, play, registration, required } = openPage(true, "none");
    await settle();
    requireRegistration(registration).found = found;
    play.flow.requireNewer();
    await settle();
    expect({ reloads: clock.reloads, required }).toEqual({
      reloads: 0,
      required: ["updating", "unavailable"],
    });
  });

  it("reports unavailable offline without checking, and retries once the device reconnects", async () => {
    const { clock, container, page, play, registration, required } = openPage(
      true,
      "none",
      undefined,
      { offline: true },
    );
    await settle();
    const found = requireRegistration(registration);
    found.found = "installs";
    play.flow.requireNewer();
    expect({ required, updates: found.updates }).toEqual({ required: ["unavailable"], updates: 0 });
    clock.online = true;
    page.eventTarget.dispatchEvent(new Event("online"));
    expect({ required, updates: found.updates }).toEqual({
      required: ["unavailable", "updating"],
      updates: 1,
    });
    const worker = found.installing;
    if (worker === null) {
      throw new Error("Missing test installer");
    }
    endInstall(found, worker, "installed");
    container.dispatchEvent(new Event("controllerchange"));
    expect(clock.reloads).toBe(1);
  });

  it("retries each time the page comes back into view", async () => {
    const { play, registration, required, visibilitySource } = openPage(true, "none");
    await settle();
    const found = requireRegistration(registration);
    play.flow.requireNewer();
    await settle();
    visibilitySource.setVisibility("hidden");
    visibilitySource.setVisibility("visible");
    await settle();
    expect({ required, updates: found.updates }).toEqual({
      required: ["updating", "unavailable", "updating", "unavailable"],
      updates: 3,
    });
    found.found = "installs";
    visibilitySource.setVisibility("hidden");
    visibilitySource.setVisibility("visible");
    const worker = found.installing;
    if (worker === null) {
      throw new Error("Missing test installer");
    }
    endInstall(found, worker, "installed");
    expect(worker.messages).toEqual([SKIP_WAITING_MESSAGE]);
  });

  it("reports unavailable when the install fails, and leaves the retry to reconnection or view", async () => {
    const { clock, play, registration, required } = openPage(true, "none");
    await settle();
    const found = requireRegistration(registration);
    found.found = "installs";
    play.flow.requireNewer();
    const worker = found.installing;
    if (worker === null) {
      throw new Error("Missing test installer");
    }
    await settle();
    endInstall(found, worker, "redundant");
    await settle();
    expect({ reloads: clock.reloads, required, updates: found.updates }).toEqual({
      reloads: 0,
      required: ["updating", "unavailable"],
      updates: 2,
    });
  });

  it("is idempotent", async () => {
    const opened = openPage(true, "none");
    await settle();
    opened.play.flow.requireNewer();
    opened.play.flow.requireNewer();
    await settle();
    opened.play.flow.requireNewer();
    expect({ required: opened.required, updates: opened.registration?.updates }).toEqual({
      required: ["updating", "unavailable"],
      updates: 2,
    });
    const waiting = openPage(true, "waiting");
    await settle();
    waiting.play.flow.requireNewer();
    waiting.play.flow.requireNewer();
    expect(waiting.registration?.waiting?.messages).toEqual([SKIP_WAITING_MESSAGE]);
  });

  it("hides a shown offer and never shows it while required", async () => {
    const { play, registration, required, shown } = openPage(true, "none", undefined, {
      offline: true,
    });
    await settle();
    showHome(play, true);
    const worker = foundInstall(registration);
    endInstall(registration, worker, "installed");
    expect(shown).toEqual([true]);
    play.flow.requireNewer();
    showHome(play, false);
    play.flow.arriveHome();
    showHome(play, true);
    play.flow.accept();
    expect({ messages: worker.messages, required, shown }).toEqual({
      messages: [SKIP_WAITING_MESSAGE],
      required: ["updating"],
      shown: [true, false],
    });
  });

  it("registers an uncontrolled page, waits for its install to activate and reloads once", async () => {
    const session = new FakeSession();
    const activities: OfflineActivity[] = [];
    const { clock, container, play, registration, required, visibilitySource } = openPage(
      false,
      "installing",
      (activity) => activities.push(activity),
      { session },
    );
    const worker = startInstall(registration);
    play.flow.requireNewer();
    expect({ activities, registered: container.registered.length, required }).toEqual({
      activities: ["idle", "precaching"],
      registered: 1,
      required: ["updating"],
    });
    await settle();
    play.registrationReady();
    endInstall(registration, worker, "installed");
    expect(clock.reloads).toBe(0);
    activateInstall(registration, worker);
    expect({ key: session.getItem(CONTROL_RELOAD_KEY), reloads: clock.reloads }).toEqual({
      key: "1",
      reloads: 1,
    });
    worker.dispatchEvent(new Event("statechange"));
    visibilitySource.setVisibility("hidden");
    visibilitySource.setVisibility("visible");
    await settle();
    expect({ registered: container.registered.length, reloads: clock.reloads, required }).toEqual({
      registered: 1,
      reloads: 1,
      required: ["updating"],
    });
  });

  // The page after the guarded reload is still uncontrolled (a hard reload or a disabled worker),
  // or the tab has no session storage.
  it.each<[string, () => SessionLike | undefined]>([
    [
      "after its one reload",
      () => {
        const session = new FakeSession();
        session.setItem(CONTROL_RELOAD_KEY, "1");
        return session;
      },
    ],
    ["without session storage", () => undefined],
  ])("never reloads an uncontrolled page %s", async (_, makeSession) => {
    const { clock, page, play, registration, required, visibilitySource } = openPage(
      false,
      "none",
      undefined,
      { session: makeSession() },
    );
    const active = new FakeWorker();
    active.state = "activated";
    requireRegistration(registration).active = active;
    play.flow.requireNewer();
    await settle();
    page.eventTarget.dispatchEvent(new Event("online"));
    visibilitySource.setVisibility("hidden");
    visibilitySource.setVisibility("visible");
    await settle();
    expect({ reloads: clock.reloads, required }).toEqual({
      reloads: 0,
      required: ["updating", "unavailable"],
    });
  });

  it("clears the reload guard once a version controls the page", () => {
    const session = new FakeSession();
    session.setItem(CONTROL_RELOAD_KEY, "1");
    openPage(true, "none", undefined, { session });
    expect(session.getItem(CONTROL_RELOAD_KEY)).toBeNull();
  });

  it("registers again on an uncontrolled page after its first install fails", async () => {
    const session = new FakeSession();
    const { clock, container, play, registration, required } = openPage(
      false,
      "installing",
      undefined,
      { session },
    );
    const worker = startInstall(registration);
    play.flow.requireNewer();
    await settle();
    endInstall(registration, worker, "redundant");
    expect(required).toEqual(["updating", "unavailable"]);
    play.flow.noteOnline();
    expect(container.registered).toHaveLength(2);
    const retry = new FakeWorker();
    retry.state = "installing";
    requireRegistration(registration).installing = retry;
    await settle();
    activateInstall(registration, retry);
    expect({ reloads: clock.reloads, required }).toEqual({
      reloads: 1,
      required: ["updating", "unavailable", "updating"],
    });
  });
});
