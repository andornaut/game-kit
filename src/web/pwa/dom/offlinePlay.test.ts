import { afterEach, describe, expect, it, vi } from "vitest";

import { RESUME_CHECK_MS, SKIP_WAITING_MESSAGE } from "../updateReady.ts";
import {
  INTERACTION_EVENTS,
  type OfflineActivity,
  type OfflinePage,
  type OfflinePlay,
  type OfflinePlayOptions,
  type RegisteringContainer,
  startOfflinePlay,
} from "./offlinePlay.ts";
import type { RegistrationLike, ServiceWorkerLike } from "./updateReady.ts";
import type { VisibilitySource } from "./visibility.ts";

class FakeDocument extends EventTarget implements VisibilitySource {
  visibilityState: DocumentVisibilityState = "visible";

  setVisibility(state: DocumentVisibilityState): void {
    this.visibilityState = state;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}

const OPTIONS = { bootWaitMs: 4000, serviceWorkerUrl: "/sw.js?sound=ogg" };

class FakeWorker extends EventTarget implements ServiceWorkerLike {
  readonly messages: unknown[] = [];
  state = "installed";

  postMessage(message: unknown): void {
    this.messages.push(message);
  }
}

// A deployed version: waiting behind the running one, still installing, or none newer.
type Deployed = "installing" | "none" | "waiting";

class FakeRegistration extends EventTarget implements RegistrationLike {
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
    return Promise.resolve();
  }
}

class FakeContainer extends EventTarget implements RegisteringContainer {
  readonly registered: [string, { scope: string }][] = [];

  constructor(
    readonly controller: unknown,
    private readonly registration: Promise<RegistrationLike>,
  ) {
    super();
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
// fails.
function openPage(
  controlled: boolean,
  deployed: Deployed | "fails",
  onOfflineActivity?: (activity: OfflineActivity) => void,
  activationPolicy: OfflinePlayOptions["activationPolicy"] = "automatic",
) {
  const registration = deployed === "fails" ? undefined : new FakeRegistration(deployed);
  const container = new FakeContainer(
    controlled ? {} : null,
    registration === undefined
      ? Promise.reject(new Error("no worker"))
      : Promise.resolve(registration),
  );
  const timers: { handler: () => void; ms: number }[] = [];
  const clock = { now: 0, reloads: 0 };
  const shown: boolean[] = [];
  const visibilitySource = new FakeDocument();
  const page: OfflinePage = {
    container,
    eventTarget: new EventTarget(),
    now: () => clock.now,
    online: () => true,
    reload: () => {
      clock.reloads += 1;
    },
    setTimeout: (handler, ms) => timers.push({ handler, ms }),
    visibilitySource,
  };
  const play = startOfflinePlay(
    {
      ...OPTIONS,
      activationPolicy,
      ...(onOfflineActivity === undefined ? {} : { onOfflineActivity }),
      onUpdateShown: (visible) => shown.push(visible),
    },
    page,
  );
  return { clock, container, page, play, registration, shown, timers, visibilitySource };
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

// The installing worker leaving the "installing" state for state.
function endInstall(
  registration: FakeRegistration | undefined,
  worker: FakeWorker,
  state: string,
): void {
  requireRegistration(registration).installing = null;
  worker.state = state;
  worker.dispatchEvent(new Event("statechange"));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("startOfflinePlay", () => {
  it("defers first registration until client readiness after its prepared frame independently of offers", async () => {
    const { container, play } = openPage(false, "none", undefined, "manual");
    await expect(play.bootable).resolves.toBeUndefined();
    play.flow.setOfferVisible(true);
    play.flow.setOfferVisible(false);
    play.flow.beginOfferVisit();
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

  it("registers controlled manual pages immediately without activation before interaction", async () => {
    const { container, play, registration, shown } = openPage(true, "waiting", undefined, "manual");
    expect(container.registered).toHaveLength(1);
    play.registrationReady();
    expect(container.registered).toHaveLength(1);
    await settle();
    await expect(play.bootable).resolves.toBeUndefined();
    play.flow.setOfferVisible(true);
    expect(shown).toEqual([true]);
    expect(registration?.waiting?.messages).toEqual([]);
    play.flow.accept();
    expect(registration?.waiting?.messages).toEqual([SKIP_WAITING_MESSAGE]);
  });

  it("keeps manual arrival and resume checks eligible after dismissal without readiness changes", async () => {
    const { clock, page, play, registration, shown, visibilitySource } = openPage(
      true,
      "none",
      undefined,
      "manual",
    );
    await settle();
    expect(registration?.updates).toBe(1);
    play.flow.setOfferVisible(true);
    expect(registration?.updates).toBe(1);
    page.eventTarget.dispatchEvent(new Event("pointerdown"));
    play.flow.dismissOffer();
    play.registrationReady();
    expect(registration?.updates).toBe(1);
    play.flow.setOfferVisible(false);
    play.flow.setOfferVisible(true);
    expect(registration?.updates).toBe(2);
    clock.now = RESUME_CHECK_MS - 1;
    visibilitySource.setVisibility("hidden");
    visibilitySource.setVisibility("visible");
    expect(registration?.updates).toBe(2);
    clock.now = RESUME_CHECK_MS;
    visibilitySource.setVisibility("hidden");
    visibilitySource.setVisibility("visible");
    expect(registration?.updates).toBe(3);
    if (registration === undefined) {
      throw new Error("Missing test registration");
    }
    registration.waiting = new FakeWorker();
    registration.dispatchEvent(new Event("updatefound"));
    expect(shown).toEqual([]);
    play.flow.beginOfferVisit();
    expect(shown).toEqual([true]);
  });

  it("reports a first visit's precache from its registration request until its install ends", async () => {
    const activities: OfflineActivity[] = [];
    const { play, registration } = openPage(false, "installing", (activity) =>
      activities.push(activity),
    );
    const worker = startInstall(registration);
    await expect(play.bootable).resolves.toBeUndefined();
    expect(activities).toEqual(["idle"]);
    play.registrationReady();
    expect(activities).toEqual(["idle", "precaching"]);
    await settle();
    expect(activities).toEqual(["idle", "precaching"]);
    endInstall(registration, worker, "installed");
    expect(activities).toEqual(["idle", "precaching", "idle"]);
  });

  it("ends a first visit's precache when registration fails, and still boots", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const activities: OfflineActivity[] = [];
    const { play } = openPage(false, "fails", (activity) => activities.push(activity));
    play.registrationReady();
    expect(activities).toEqual(["idle", "precaching"]);
    await settle();
    expect(activities).toEqual(["idle", "precaching", "idle"]);
    expect(warn).toHaveBeenCalledTimes(1);
    await expect(play.bootable).resolves.toBeUndefined();
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
    expect(container.registered).toHaveLength(1);
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
    expect(container.registered).toHaveLength(1);
    await settle();
    expect(activities).toEqual(["idle"]);
  });

  it("isolates a throwing activity callback from registration and boot", async () => {
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
    await expect(play.bootable).resolves.toBeUndefined();
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

  // A waiting version takes over at once before the player interacts, and is offered on the home
  // screen after.
  it.each<[string, string | undefined]>([
    ...INTERACTION_EVENTS.map((type): [string, string] => [type, type]),
    ["no input", undefined],
  ])("with a waiting version, after %s, offers it or switches", async (_, interaction) => {
    const { page, play, registration, shown } = openPage(true, "waiting");
    if (interaction !== undefined) {
      page.eventTarget.dispatchEvent(new Event(interaction));
    }
    await settle();
    showHome(play, true);
    expect({ messages: registration?.waiting?.messages, shown }).toEqual(
      interaction === undefined
        ? { messages: [SKIP_WAITING_MESSAGE], shown: [] }
        : { messages: [], shown: [true] },
    );
  });

  // A page no version controls runs its first install's build. A worker that installs after it is
  // newer: pending while it installs, then offered on the home screen, or before input taken by a
  // reload, whether it waits or activates at once.
  it.each<[string, Deployed, string[], boolean, { reloads: number; shown: boolean[] }]>([
    ["offers nothing for its own first install", "installing", [], true, { reloads: 0, shown: [] }],
    [
      "offers nothing while a later worker installs",
      "installing",
      ["installing"],
      true,
      { reloads: 0, shown: [] },
    ],
    [
      "offers a later worker that activates at once, and reloads",
      "installing",
      ["installing", "installed", "activating", "activated"],
      true,
      { reloads: 1, shown: [true, false] },
    ],
    [
      "offers a later worker that waits, and reloads",
      "installing",
      ["installing", "installed"],
      true,
      { reloads: 1, shown: [true, false] },
    ],
    [
      "offers nothing for a later worker that fails",
      "installing",
      ["installing", "redundant"],
      true,
      { reloads: 0, shown: [] },
    ],
    [
      "offers a later worker with none installing at watch, and reloads",
      "none",
      ["installing", "installed", "activated"],
      true,
      { reloads: 1, shown: [true, false] },
    ],
    [
      "reloads into a later worker before input",
      "installing",
      ["installing", "installed", "activated"],
      false,
      { reloads: 1, shown: [] },
    ],
  ])("on an uncontrolled page, %s", async (_, deployed, later, interacted, expected) => {
    const { clock, page, play, registration, shown } = openPage(false, deployed);
    if (registration === undefined) {
      throw new Error("Missing test registration");
    }
    const own = registration.installing;
    if (own !== null) {
      own.state = "installing";
    }
    if (interacted) {
      page.eventTarget.dispatchEvent(new Event("pointerdown"));
    }
    showHome(play, true);
    await settle();
    const advance = (worker: FakeWorker, state: string) => {
      worker.state = state;
      if (state !== "installing") {
        registration.installing = null;
      }
      worker.dispatchEvent(new Event("statechange"));
    };
    if (own !== null) {
      ["installed", "activating", "activated"].forEach((state) => advance(own, state));
    }
    const worker = new FakeWorker();
    later.forEach((state, index) => {
      if (index === 0) {
        worker.state = state;
        registration.installing = worker;
        registration.dispatchEvent(new Event("updatefound"));
      } else {
        advance(worker, state);
      }
    });
    if (shown.at(-1) === true) {
      play.flow.accept();
    }
    expect({ reloads: clock.reloads, shown }).toEqual(expected);
  });

  it("holds the boot while a newer version installs, until bootWaitMs runs out", async () => {
    const { play, timers } = openPage(true, "installing");
    let booted = false;
    void play.bootable.then(() => {
      booted = true;
    });
    await settle();
    const before = booted;
    timers.filter(({ ms }) => ms === OPTIONS.bootWaitMs).forEach(({ handler }) => handler());
    await settle();
    expect([before, booted]).toEqual([false, true]);
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
