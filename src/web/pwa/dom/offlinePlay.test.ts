import { afterEach, describe, expect, it, vi } from "vitest";

import { RESUME_CHECK_MS, SKIP_WAITING_MESSAGE } from "../updateReady.ts";
import {
  INTERACTION_EVENTS,
  type OfflineActivity,
  type OfflinePage,
  type OfflinePlay,
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

const OPTIONS = { serviceWorkerUrl: "/sw.js?sound=ogg" };

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
) {
  const registration = deployed === "fails" ? undefined : new FakeRegistration(deployed);
  const container = new FakeContainer(
    controlled ? {} : null,
    registration === undefined
      ? Promise.reject(new Error("no worker"))
      : Promise.resolve(registration),
  );
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
    visibilitySource,
  };
  const play = startOfflinePlay(
    {
      ...OPTIONS,
      ...(onOfflineActivity === undefined ? {} : { onOfflineActivity }),
      onUpdateShown: (visible) => shown.push(visible),
    },
    page,
  );
  return { clock, container, page, play, registration, shown, visibilitySource };
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

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("startOfflinePlay", () => {
  it("defers first registration until client readiness after its prepared frame independently of offers", async () => {
    const { container, play } = openPage(false, "none");
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

  it("keeps arrival and resume checks eligible after dismissal without readiness changes", async () => {
    const { clock, page, play, registration, shown, visibilitySource } = openPage(true, "none");
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
    expect(Object.keys(play).sort()).toEqual(["flow", "registrationReady"]);
    expect(Object.keys(play.flow).sort()).toEqual([
      "accept",
      "beginOfferVisit",
      "dismissOffer",
      "noteInteraction",
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

  it("hides the offer on dismiss for the visit, and shows it again for a new visit", async () => {
    const { clock, play, registration, shown } = openPage(true, "waiting");
    await settle();
    showHome(play, true);
    play.flow.dismissOffer();
    showHome(play, false);
    showHome(play, true);
    expect(shown).toEqual([true, false]);
    play.flow.beginOfferVisit();
    expect(shown).toEqual([true, false, true]);
    expect({ messages: registration?.waiting?.messages, reloads: clock.reloads }).toEqual({
      messages: [],
      reloads: 0,
    });
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
    play.flow.beginOfferVisit();
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
