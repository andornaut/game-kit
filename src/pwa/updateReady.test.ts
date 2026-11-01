import { describe, expect, it, vi } from "vitest";

import {
  activateWaitingWorker,
  type ContainerLike,
  createUpdateFlow,
  newerVersionOf,
  registerWhenDue,
  type RegistrationLike,
  RESUME_CHECK_MS,
  resumeCheckDue,
  type ResumeState,
  type ServiceWorkerLike,
  SKIP_WAITING_MESSAGE,
  updateAction,
  type UpdateState,
} from "./updateReady";

class FakeWorker extends EventTarget implements ServiceWorkerLike {
  readonly messages: unknown[] = [];
  state = "installing";

  postMessage(message: unknown): void {
    this.messages.push(message);
  }
}

class FakeContainer extends EventTarget implements ContainerLike {
  constructor(public controller: unknown) {
    super();
  }

  takeOver(): void {
    this.dispatchEvent(new Event("controllerchange"));
  }
}

class FakeRegistration extends EventTarget implements RegistrationLike {
  installing: FakeWorker | null = null;
  updates = 0;
  waiting: FakeWorker | null = null;

  // The deploy update() finds: none, or a new version that starts installing.
  constructor(private readonly deployed: boolean = false) {
    super();
  }

  // The installing version finishes and waits behind the running one.
  finishInstall(): FakeWorker {
    const worker = this.installing ?? new FakeWorker();
    this.installing = null;
    this.waiting = worker;
    worker.state = "installed";
    worker.dispatchEvent(new Event("statechange"));
    return worker;
  }

  startInstall(): FakeWorker {
    const worker = new FakeWorker();
    this.installing = worker;
    this.dispatchEvent(new Event("updatefound"));
    return worker;
  }

  update(): Promise<unknown> {
    this.updates += 1;
    if (this.deployed) {
      this.startInstall();
    }
    return Promise.resolve(this);
  }
}

const RUNNING_WORKER = {};

// Lets the flow's promise callbacks run.
const settle = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

describe("updateAction", () => {
  const fresh: UpdateState = {
    interacted: false,
    newer: "pending",
    onHome: false,
    online: true,
    reloading: false,
    waitOver: false,
  };
  const playing: UpdateState = { ...fresh, interacted: true, newer: "waiting", waitOver: true };
  const cases: { expected: ReturnType<typeof updateAction>; name: string; state: UpdateState }[] = [
    { expected: "wait", name: "a fresh load checking for a newer version", state: fresh },
    { expected: "run", name: "a fresh load offline", state: { ...fresh, online: false } },
    {
      expected: "run",
      name: "a fresh load whose wait ran out",
      state: { ...fresh, waitOver: true },
    },
    { expected: "run", name: "no newer version", state: { ...fresh, newer: "none" } },
    {
      expected: "switch",
      name: "a waiting version before input",
      state: { ...fresh, newer: "waiting" },
    },
    {
      expected: "switch",
      name: "a waiting version before input, offline, after the wait",
      state: { ...fresh, newer: "waiting", online: false, waitOver: true },
    },
    {
      expected: "switch",
      name: "a waiting version before input, on the home screen",
      state: { ...fresh, newer: "waiting", onHome: true, waitOver: true },
    },
    {
      expected: "prompt",
      name: "a waiting version, after input, home",
      state: { ...playing, onHome: true },
    },
    { expected: "run", name: "a waiting version, after input, mid-game", state: playing },
    {
      expected: "run",
      name: "a pending version after input",
      state: { ...fresh, interacted: true },
    },
    {
      expected: "wait",
      name: "a switch before the wait runs out",
      state: { ...fresh, reloading: true },
    },
    {
      expected: "run",
      name: "a switch after the wait, on the home screen",
      state: { ...playing, onHome: true, reloading: true },
    },
  ];

  it("waits, runs, switches or prompts by the load's state", () => {
    const wrong = cases.filter(({ expected, state }) => updateAction(state) !== expected);
    expect(wrong.map(({ name }) => name)).toEqual([]);
  });
});

describe("resumeCheckDue", () => {
  const home: ResumeState = {
    lastCheck: 0,
    now: RESUME_CHECK_MS,
    onHome: true,
    online: true,
    visible: true,
  };
  it.each<{ expected: boolean; name: string; state: ResumeState }>([
    { expected: true, name: "visible on the home screen", state: home },
    { expected: true, name: "never checked", state: { ...home, lastCheck: undefined, now: 0 } },
    { expected: false, name: "hidden", state: { ...home, visible: false } },
    { expected: false, name: "mid-game or in a menu", state: { ...home, onHome: false } },
    { expected: false, name: "offline", state: { ...home, online: false } },
    { expected: false, name: "within the throttle", state: { ...home, now: RESUME_CHECK_MS - 1 } },
    { expected: true, name: "after the throttle", state: { ...home, now: RESUME_CHECK_MS * 2 } },
  ])("$name: $expected", ({ expected, state }) => {
    expect(resumeCheckDue(state)).toBe(expected);
  });
});

describe("newerVersionOf", () => {
  const worker = new FakeWorker();
  const cases = [
    {
      controller: null,
      expected: "none",
      installing: worker,
      name: "a first install",
      waiting: null,
    },
    {
      controller: RUNNING_WORKER,
      expected: "none",
      installing: null,
      name: "no new version",
      waiting: null,
    },
    {
      controller: RUNNING_WORKER,
      expected: "pending",
      installing: worker,
      name: "a version installing",
      waiting: null,
    },
    {
      controller: RUNNING_WORKER,
      expected: "waiting",
      installing: null,
      name: "a version waiting",
      waiting: worker,
    },
  ];

  it("finds a newer version only behind a running one", () => {
    for (const { controller, expected, installing, name, waiting } of cases) {
      const registration = Object.assign(new FakeRegistration(), { installing, waiting });
      const { newer } = newerVersionOf(new FakeContainer(controller), registration);
      expect(newer, name).toBe(expected);
    }
  });
});

describe("activateWaitingWorker", () => {
  it("tells the worker to skip waiting and reloads once when it takes over", () => {
    const container = new FakeContainer(RUNNING_WORKER);
    const worker = new FakeWorker();
    const reload = vi.fn();
    activateWaitingWorker(container, reload, worker);
    expect(worker.messages).toEqual([SKIP_WAITING_MESSAGE]);
    expect(reload).not.toHaveBeenCalled();
    container.takeOver();
    container.takeOver();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("createUpdateFlow", () => {
  const setup = ({ controller = RUNNING_WORKER as unknown, online = true } = {}) => {
    const container = new FakeContainer(controller);
    const reload = vi.fn();
    const shown: boolean[] = [];
    const clock = { time: 0 };
    const flow = createUpdateFlow(
      container,
      () => clock.time,
      () => online,
      reload,
      (visible) => shown.push(visible),
    );
    let booted = false;
    void flow.bootable.then(() => {
      booted = true;
    });
    return { booted: () => booted, clock, container, flow, reload, shown };
  };

  // Before watch: a controlled page waits for its check, a first visit has nothing to wait for.
  it("before watching, waits to boot only a controlled page", async () => {
    const controlled = setup({ controller: RUNNING_WORKER });
    const first = setup({ controller: null });
    await settle();
    expect([controlled.booted(), first.booted()]).toEqual([false, true]);
  });

  it("boots with no notice for no new version, offline or a first install", async () => {
    const cases = [
      { controller: RUNNING_WORKER, name: "no new version", online: true, updates: 1 },
      { controller: RUNNING_WORKER, name: "offline", online: false, updates: 0 },
      { controller: null, name: "a first install", online: true, updates: 0 },
    ];
    const flows = cases.map(({ controller, online }) => {
      const flow = setup({ controller, online });
      const registration = new FakeRegistration();
      flow.flow.watch(registration);
      return { ...flow, registration };
    });
    await settle();
    for (const [i, { booted, registration, reload, shown }] of flows.entries()) {
      const { name, updates } = cases[i] ?? { name: "", updates: -1 };
      expect(
        {
          booted: booted(),
          reloads: reload.mock.calls.length,
          shown,
          updates: registration.updates,
        },
        name,
      ).toEqual({ booted: true, reloads: 0, shown: [], updates });
    }
  });

  it("boots when the registration fails", async () => {
    const { booted, flow } = setup();
    flow.noRegistration();
    await settle();
    expect(booted()).toBe(true);
  });

  it("switches a fresh load to a version that installs during the boot wait, without booting", async () => {
    const { booted, container, flow, reload, shown } = setup();
    const registration = new FakeRegistration(true);
    flow.watch(registration);
    await settle();
    expect(booted()).toBe(false);
    const worker = registration.finishInstall();
    expect(worker.messages).toEqual([SKIP_WAITING_MESSAGE]);
    container.takeOver();
    await settle();
    expect({ booted: booted(), reloads: reload.mock.calls.length, shown }).toEqual({
      booted: false,
      reloads: 1,
      shown: [],
    });
  });

  it("follows a version that was already installing when watching began", async () => {
    const { booted, flow } = setup();
    const registration = new FakeRegistration();
    registration.installing = new FakeWorker();
    flow.watch(registration);
    await settle();
    expect(booted()).toBe(false);
    expect(registration.finishInstall().messages).toEqual([SKIP_WAITING_MESSAGE]);
  });

  it("switches at once to a version already waiting at load", () => {
    const { flow } = setup();
    const registration = new FakeRegistration();
    const worker = new FakeWorker();
    registration.waiting = worker;
    flow.watch(registration);
    expect(worker.messages).toEqual([SKIP_WAITING_MESSAGE]);
  });

  it("boots when the wait runs out, then switches if the install lands before input", async () => {
    const { booted, flow } = setup();
    const registration = new FakeRegistration(true);
    flow.watch(registration);
    flow.endBootWait();
    await settle();
    expect(booted()).toBe(true);
    expect(registration.finishInstall().messages).toEqual([SKIP_WAITING_MESSAGE]);
  });

  it("after input never switches on its own, and offers Reload on each arrival home", () => {
    const { container, flow, reload, shown } = setup();
    const registration = new FakeRegistration();
    flow.watch(registration);
    flow.endBootWait();
    flow.setOnHome(true);
    flow.noteInteraction();
    flow.setOnHome(false);
    registration.startInstall();
    const worker = registration.finishInstall();
    flow.setOnHome(true);
    flow.setOnHome(false);
    flow.setOnHome(true);
    expect(worker.messages).toEqual([]);
    expect(shown).toEqual([true, false, true]);
    flow.accept();
    flow.accept();
    expect(shown).toEqual([true, false, true, false]);
    expect(worker.messages).toEqual([SKIP_WAITING_MESSAGE]);
    container.takeOver();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  // The load's own check, then one per arrival home after input; none offline.
  it("checks on load and on each arrival home after input, only online", () => {
    for (const { online, updates } of [
      { online: true, updates: 3 },
      { online: false, updates: 0 },
    ]) {
      const { flow } = setup({ online });
      const registration = new FakeRegistration();
      flow.watch(registration);
      flow.setOnHome(true);
      flow.noteInteraction();
      flow.setOnHome(false);
      flow.setOnHome(true);
      flow.setOnHome(true);
      flow.setOnHome(false);
      flow.setOnHome(true);
      expect(registration.updates).toBe(updates);
    }
  });

  // Every check counts toward the throttle: the load's, an arrival home's and a resume's.
  it("checks on resuming on the home screen, at most once per throttle", () => {
    const { clock, flow } = setup();
    const registration = new FakeRegistration();
    flow.watch(registration);
    flow.setOnHome(true);
    flow.setVisible(false);
    clock.time = RESUME_CHECK_MS - 1;
    flow.setVisible(true);
    clock.time = RESUME_CHECK_MS;
    flow.setVisible(false);
    flow.setVisible(true);
    flow.noteInteraction();
    flow.setOnHome(false);
    clock.time = RESUME_CHECK_MS * 3;
    flow.setVisible(true);
    flow.setOnHome(true);
    flow.setVisible(true);
    expect(registration.updates).toBe(3);
  });

  // The newer version's save shows the plate with no version waiting: its button reloads, so
  // the browser fetches the newer version.
  it("reloads at once on Update now with no version waiting", () => {
    const { flow, reload, shown } = setup();
    flow.watch(new FakeRegistration());
    flow.noteInteraction();
    flow.setOnHome(true);
    flow.accept();
    expect(shown).toEqual([]);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("registerWhenDue", () => {
  // Each step is true for the home screen in front, false for it hidden.
  it.each<[string, unknown, boolean[], number]>([
    ["registers a controlled page at once", RUNNING_WORKER, [], 1],
    [
      "registers a controlled page once, whatever home does",
      RUNNING_WORKER,
      [true, false, true],
      1,
    ],
    ["holds a first visit's registration until home shows", null, [], 0],
    ["holds a first visit's registration while home is hidden", null, [false], 0],
    ["registers a first visit on its first arrival home", null, [false, true], 1],
    ["registers a first visit once", null, [true, false, true], 1],
  ])("%s", async (_case, controller, steps, registrations) => {
    const container = new FakeContainer(controller);
    const flow = createUpdateFlow(
      container,
      () => 0,
      () => true,
      vi.fn(),
      vi.fn(),
    );
    const setOnHome = vi.spyOn(flow, "setOnHome");
    const register = vi.fn(() => Promise.resolve<RegistrationLike>(new FakeRegistration()));
    const onHome = registerWhenDue(container, flow, register);
    for (const step of steps) {
      onHome(step);
    }
    await settle();
    expect(register).toHaveBeenCalledTimes(registrations);
    expect(setOnHome.mock.calls).toEqual(steps.map((step) => [step]));
  });

  it("watches the registration, or lets the game start when it fails", async () => {
    const container = new FakeContainer(RUNNING_WORKER);
    const flow = createUpdateFlow(
      container,
      () => 0,
      () => true,
      vi.fn(),
      vi.fn(),
    );
    const [watch, none] = [vi.spyOn(flow, "watch"), vi.spyOn(flow, "noRegistration")];
    const registration = new FakeRegistration();
    registerWhenDue(container, flow, () => Promise.resolve(registration));
    registerWhenDue(container, flow, () => Promise.reject(new Error("blocked")));
    await settle();
    expect([watch.mock.calls, none.mock.calls.length]).toEqual([[[registration]], 1]);
  });
});
