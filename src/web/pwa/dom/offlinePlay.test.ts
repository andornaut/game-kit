import { afterEach, describe, expect, it, vi } from "vitest";

import { RESUME_CHECK_MS, SKIP_WAITING_MESSAGE } from "../updateReady.ts";
import {
  INTERACTION_EVENTS,
  type OfflineActivity,
  type OfflinePage,
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
  const clock = { now: 0 };
  const shown: boolean[] = [];
  const visibilitySource = new FakeDocument();
  const page: OfflinePage = {
    container,
    eventTarget: new EventTarget(),
    now: () => clock.now,
    online: () => true,
    reload: () => undefined,
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("startOfflinePlay", () => {
  it("defers first registration until client readiness after its prepared frame independently of offers", async () => {
    const activities: OfflineActivity[] = [];
    const { container, play } = openPage(
      false,
      "none",
      (activity) => activities.push(activity),
      "manual",
    );
    await expect(play.bootable).resolves.toBeUndefined();
    play.setOfferVisible(true);
    play.setOfferVisible(false);
    play.flow.beginOfferVisit();
    play.setOfferVisible(true);
    play.setRegistrationReady(false);
    expect(container.registered).toEqual([]);
    expect(activities).toEqual(["idle"]);
    play.setRegistrationReady(true);
    expect(container.registered).toEqual([[OPTIONS.serviceWorkerUrl, { scope: "/" }]]);
    expect(activities).toEqual(["idle", "registering"]);
    await settle();
    expect(activities).toEqual(["idle", "registering", "idle"]);
    play.setRegistrationReady(false);
    play.setRegistrationReady(true);
    play.setOfferVisible(false);
    play.setOfferVisible(true);
    expect(container.registered).toHaveLength(1);
  });

  it("registers controlled manual pages immediately without activation before interaction", async () => {
    const activities: OfflineActivity[] = [];
    const { container, play, registration, shown } = openPage(
      true,
      "waiting",
      (activity) => activities.push(activity),
      "manual",
    );
    expect(container.registered).toHaveLength(1);
    play.setRegistrationReady(false);
    await settle();
    await expect(play.bootable).resolves.toBeUndefined();
    play.setOfferVisible(true);
    expect(shown).toEqual([true]);
    expect(registration?.waiting?.messages).toEqual([]);
    expect(activities).toEqual(["idle", "registering", "idle"]);
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
    play.setOfferVisible(true);
    expect(registration?.updates).toBe(1);
    page.eventTarget.dispatchEvent(new Event("pointerdown"));
    play.flow.dismissOffer();
    play.setRegistrationReady(false);
    play.setRegistrationReady(true);
    expect(registration?.updates).toBe(1);
    play.setOfferVisible(false);
    play.setOfferVisible(true);
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

  it("observes first registration and an in-flight install only after home without holding play", async () => {
    const activities: OfflineActivity[] = [];
    const { play, registration } = openPage(false, "installing", (activity) =>
      activities.push(activity),
    );
    if (registration?.installing === null || registration?.installing === undefined) {
      throw new Error("Missing test installer");
    }
    const worker = registration.installing;
    worker.state = "installing";
    await expect(play.bootable).resolves.toBeUndefined();
    expect(activities).toEqual(["idle"]);
    play.setOnHome(true);
    expect(activities).toEqual(["idle", "registering"]);
    await settle();
    expect(activities.at(-1)).toBe("installing");
    worker.state = "installed";
    worker.dispatchEvent(new Event("statechange"));
    expect(activities.at(-1)).toBe("idle");
  });

  it("observes a later install and clears activity when that worker becomes redundant", async () => {
    const activities: OfflineActivity[] = [];
    const { play, registration } = openPage(false, "none", (activity) => activities.push(activity));
    play.setOnHome(true);
    await settle();
    if (registration === undefined) {
      throw new Error("Missing test registration");
    }
    const worker = new FakeWorker();
    worker.state = "installing";
    registration.installing = worker;
    registration.dispatchEvent(new Event("updatefound"));
    registration.dispatchEvent(new Event("updatefound"));
    expect(activities).toEqual(["idle", "registering", "idle", "installing"]);
    worker.state = "redundant";
    worker.dispatchEvent(new Event("statechange"));
    expect(activities.at(-1)).toBe("idle");
  });

  it("boots after a failed registration, and isolates observer errors from registration and boot", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const activities: OfflineActivity[] = [];
    const failed = openPage(false, "fails", (activity) => activities.push(activity));
    failed.play.setOnHome(true);
    await expect(failed.play.bootable).resolves.toBeUndefined();
    await settle();
    expect(activities).toEqual(["idle", "registering", "idle"]);
    expect(warn).toHaveBeenCalledTimes(1);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const observed = openPage(false, "none", () => {
      throw new Error("observer");
    });
    observed.play.setOnHome(true);
    await settle();
    expect(observed.container.registered).toHaveLength(1);
    await expect(observed.play.bootable).resolves.toBeUndefined();
    expect(errors).toHaveBeenCalled();
  });
  // Each step is true for the home screen in front, false for it hidden.
  it.each<[string, boolean, boolean[], number]>([
    ["registers a controlled page at once", true, [], 1],
    ["holds a first visit's registration until home shows", false, [false], 0],
    ["registers a first visit on its first arrival home", false, [false, true], 1],
  ])("%s", async (_, controlled, steps, registrations) => {
    const { container, play } = openPage(controlled, "none");
    steps.forEach((step) => play.setOnHome(step));
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
    play.setOnHome(true);
    expect({ messages: registration?.waiting?.messages, shown }).toEqual(
      interaction === undefined
        ? { messages: [SKIP_WAITING_MESSAGE], shown: [] }
        : { messages: [], shown: [true] },
    );
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
    opened.play.setOnHome(true);
    const before = opened.registration?.updates ?? 0;
    opened.clock.now = RESUME_CHECK_MS;
    resume(opened);
    expect((opened.registration?.updates ?? 0) - before).toBe(checks);
  });
});
