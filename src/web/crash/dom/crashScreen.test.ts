import { describe, expect, it, vi } from "vitest";

import { type CrashPage, type CrashScreenOptions, installCrashScreen } from "./crashScreen.ts";

class FakeElement extends EventTarget {
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  readonly style = { setProperty: vi.fn() };
  className = "";
  id = "";
  textContent = "";
  type = "";
  focus = vi.fn();
  ownerDocument: EventTarget | undefined;

  append(...children: (FakeElement | string)[]): void {
    for (const child of children) {
      if (typeof child === "string") {
        this.textContent += child;
      } else {
        this.children.push(child);
      }
    }
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  toggleAttribute(name: string, force: boolean): void {
    if (force) {
      this.attributes.set(name, "");
    } else {
      this.attributes.delete(name);
    }
  }
}

const descendants = (element: FakeElement): FakeElement[] => [
  element,
  ...element.children.flatMap(descendants),
];

const OPTIONS: CrashScreenOptions = {
  buildLabel: "v1.0.0 · 0123abcd",
  colours: {
    background: "#ffffff",
    buttonFace: "#dddddd",
    buttonLip: "#aaaaaa",
    ink: "#000000",
    text: "#222222",
  },
  dev: false,
  words: { body: "Saved progress is kept.", reload: "Reload", title: "Unable to continue" },
};

// A page with a game and a control in its body, whose window events the test dispatches.
function fakePage(navigator: object = {}) {
  const body = new FakeElement();
  const game = new FakeElement();
  const controls = new FakeElement();
  body.append(game, controls);
  const window = new EventTarget();
  const reload = vi.fn();
  const document: EventTarget = Object.assign(new EventTarget(), {
    body,
    createElement: () => Object.assign(new FakeElement(), { ownerDocument: document }),
  });
  const page = Object.assign(window, {
    document,
    getSelection: () => null,
    location: { reload },
    navigator,
  }) as unknown as CrashPage;
  const error = (thrown: Error, filename = "/game.js") =>
    window.dispatchEvent(
      Object.assign(new Event("error"), { error: thrown, filename, message: thrown.message }),
    );
  return { body, controls, document, error, game, page, reload, window };
}

// Crashes the page and presses Reload.
function pressReload(navigator: object) {
  const fake = fakePage(navigator);
  installCrashScreen(OPTIONS, fake.page);
  fake.error(privateError());
  const button = descendants(fake.body).find((element) => element.className === "crash-button");
  button?.dispatchEvent(new Event("click"));
  return fake;
}

function privateError(): Error {
  const error = new Error("private error message");
  error.stack = "Error: private error message\n    at step (/game.js:1:2)";
  return error;
}

describe("installCrashScreen", () => {
  it("opens one accessible crash dialog, hides private details and keeps reload", () => {
    const { body, controls, error, game, page, reload } = fakePage();
    const stop = vi.fn();
    installCrashScreen(OPTIONS, page).stopGameOnCrash(stop);
    const thrown = privateError();
    error(thrown);
    error(new Error("another private error"));

    expect(body.children).toHaveLength(3);
    const screen = body.children[2];
    expect(screen?.attributes.get("role")).toBe("alertdialog");
    expect(screen?.attributes.get("aria-modal")).toBe("true");
    expect(screen?.attributes.has("inert")).toBe(false);
    expect([game.attributes.has("inert"), controls.attributes.has("inert")]).toEqual([true, true]);
    expect(screen?.style.setProperty).toHaveBeenCalledWith("--crash-button-face", "#dddddd");
    expect(stop).toHaveBeenCalledTimes(1);
    const content = descendants(body);
    const labelledBy = screen?.attributes.get("aria-labelledby");
    const describedBy = screen?.attributes.get("aria-describedby");
    expect(content.find((element) => element.id === labelledBy)?.textContent).toBe(
      OPTIONS.words.title,
    );
    expect(content.find((element) => element.id === describedBy)?.textContent).toBe(
      OPTIONS.words.body,
    );
    const text = content.map((element) => element.textContent).join("\n");
    for (const hidden of [thrown.message, "another private error", OPTIONS.buildLabel]) {
      expect(text).not.toContain(hidden);
    }
    expect(content.some((element) => element.className === "crash-details")).toBe(false);
    const button = content.find((element) => element.className === "crash-button");
    expect(button?.textContent).toBe(OPTIONS.words.reload);
    expect(button?.focus).toHaveBeenCalledTimes(1);
    expect(button?.focus).toHaveBeenCalledWith({ focusVisible: false, preventScroll: true });
    expect(reload).not.toHaveBeenCalled();
    button?.dispatchEvent(new Event("click"));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("shows the focus ring on Reload after keyboard input", () => {
    const { body, document, error, page } = fakePage();
    installCrashScreen(OPTIONS, page);
    document.dispatchEvent(new Event("keydown"));
    error(privateError());
    const button = descendants(body).find((element) => element.className === "crash-button");
    expect(button?.focus).toHaveBeenCalledExactlyOnceWith();
  });

  it("reloads immediately without inspecting or activating a waiting service worker", () => {
    const worker = { postMessage: vi.fn() };
    const getRegistration = vi.fn(() => Promise.resolve({ waiting: worker }));
    const serviceWorker = { controller: {}, getRegistration };
    const { reload } = pressReload({ serviceWorker });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(getRegistration).not.toHaveBeenCalled();
    expect(worker.postMessage).not.toHaveBeenCalled();
  });

  it("shows the build label, message and stack in dev builds", () => {
    const { body, error, page } = fakePage();
    installCrashScreen({ ...OPTIONS, dev: true }, page);
    const thrown = privateError();
    error(thrown);
    const stack = descendants(body).find((element) => element.className === "crash-stack");
    expect(stack?.textContent).toBe(`${OPTIONS.buildLabel}\n${thrown.stack}`);
  });

  it.each<[string, (window: EventTarget) => void, number]>([
    [
      "an unhandled rejection",
      (window) =>
        window.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: "lost" })),
      3,
    ],
    [
      "an extension's error",
      (window) =>
        window.dispatchEvent(
          Object.assign(new Event("error"), {
            error: new Error("ext"),
            filename: "chrome-extension://abc/x.js",
            message: "ext",
          }),
        ),
      2,
    ],
  ])("opens the screen for %s only when it is a crash", (_, dispatch, children) => {
    const { body, page, window } = fakePage();
    installCrashScreen(OPTIONS, page);
    dispatch(window);
    expect(body.children).toHaveLength(children);
  });

  it("shows the screen when stopping the game throws", () => {
    const { body, error, page } = fakePage();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    installCrashScreen(OPTIONS, page).stopGameOnCrash(() => {
      throw new Error("stop failed");
    });
    error(privateError());
    expect(body.children).toHaveLength(3);
    expect(logged).toHaveBeenCalledTimes(1);
    logged.mockRestore();
  });
});

it("exposes only Reload and dev Copy native closures once per crash", async () => {
  const writeText = vi.fn(async () => undefined);
  const fake = fakePage({ clipboard: { writeText } });
  const actions: Parameters<import("../../input/dom/holdActions.ts").HoldActionBinding>[0][] = [];
  const bind = vi.fn((action: (typeof actions)[number]) => {
    actions.push(action);
    return vi.fn();
  });
  installCrashScreen({ ...OPTIONS, bindHoldAction: bind, dev: true }, fake.page);
  fake.error(privateError());
  fake.error(privateError());
  expect(bind).toHaveBeenCalledTimes(2);
  const reload = actions.find((action) => action.element.textContent === OPTIONS.words.reload)!;
  const copy = actions.find((action) => action.element.textContent === "Copy")!;
  const copyRow = descendants(fake.body).find((element) => element.className === "crash-actions");
  expect(copyRow?.children).toEqual([copy.element]);
  const panel = descendants(fake.body).find((element) => element.className === "crash-panel");
  expect(panel?.children.map((element) => element.className)).toEqual([
    "crash-title",
    "crash-body",
    "crash-details",
    "crash-button",
  ]);
  expect(panel?.children.at(-1)).toBe(reload.element);
  expect(reload.available()).toBe(true);
  reload.activate();
  reload.element.dispatchEvent(new Event("click"));
  expect(fake.reload).toHaveBeenCalledTimes(2);
  copy.activate();
  copy.element.dispatchEvent(new Event("click"));
  await Promise.resolve();
  expect(writeText).toHaveBeenCalledTimes(2);
  expect(actions.every((action) => action.element.className === "crash-button")).toBe(true);
});

it("cleans completed bindings after a later binding throws and retains native crash actions", () => {
  const fake = fakePage();
  const stop = vi.fn();
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const bind = vi
    .fn()
    .mockReturnValueOnce(stop)
    .mockImplementationOnce(() => {
      throw new Error("binding failed");
    });
  try {
    installCrashScreen({ ...OPTIONS, bindHoldAction: bind, dev: true }, fake.page);
    fake.error(privateError());
    fake.error(privateError());
    expect(bind).toHaveBeenCalledTimes(2);
    expect(stop).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith("Crash screen: action binding failed", expect.any(Error));
    const reload = descendants(fake.body).find(
      (element) => element.textContent === OPTIONS.words.reload,
    )!;
    reload.dispatchEvent(new Event("click"));
    expect(fake.reload).toHaveBeenCalledOnce();
  } finally {
    log.mockRestore();
  }
});
