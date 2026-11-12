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

// A service worker container whose registration holds waiting, and whose page a worker controls
// when controlled is set.
function fakeServiceWorker(
  waiting: { postMessage: () => void } | null,
  controlled = true,
): EventTarget & { controller: object | null; getRegistration: () => Promise<object> } {
  return Object.assign(new EventTarget(), {
    controller: controlled ? {} : null,
    getRegistration: () => Promise.resolve({ waiting }),
  });
}

// Crashes the page and presses Reload.
function pressReload(navigator: object) {
  const fake = fakePage(navigator);
  installCrashScreen(fake.page, OPTIONS);
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
    installCrashScreen(page, OPTIONS).stopGameOnCrash(stop);
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
    installCrashScreen(page, OPTIONS);
    document.dispatchEvent(new Event("keydown"));
    error(privateError());
    const button = descendants(body).find((element) => element.className === "crash-button");
    expect(button?.focus).toHaveBeenCalledExactlyOnceWith();
  });

  it("activates a waiting service worker and reloads once it controls the page", async () => {
    const worker = { postMessage: vi.fn() };
    const serviceWorker = fakeServiceWorker(worker);
    const { reload } = pressReload({ serviceWorker });
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledWith("skip-waiting"));
    expect(reload).not.toHaveBeenCalled();
    serviceWorker.dispatchEvent(new Event("controllerchange"));
    serviceWorker.dispatchEvent(new Event("controllerchange"));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it.each<[string, () => object]>([
    ["no service worker", () => ({})],
    ["no waiting worker", () => ({ serviceWorker: fakeServiceWorker(null) })],
    [
      "a waiting worker but no controller",
      () => ({ serviceWorker: fakeServiceWorker({ postMessage: vi.fn() }, false) }),
    ],
    [
      "no registration",
      () => ({ serviceWorker: { controller: {}, getRegistration: () => Promise.resolve() } }),
    ],
    [
      "a registration that cannot be read",
      () => ({
        serviceWorker: { controller: {}, getRegistration: () => Promise.reject(new Error("no")) },
      }),
    ],
  ])("reloads at once with %s", async (_case, navigator) => {
    const { reload } = pressReload(navigator());
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it("shows the build label, message and stack in dev builds", () => {
    const { body, error, page } = fakePage();
    installCrashScreen(page, { ...OPTIONS, dev: true });
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
    installCrashScreen(page, OPTIONS);
    dispatch(window);
    expect(body.children).toHaveLength(children);
  });

  it("shows the screen when stopping the game throws", () => {
    const { body, error, page } = fakePage();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    installCrashScreen(page, OPTIONS).stopGameOnCrash(() => {
      throw new Error("stop failed");
    });
    error(privateError());
    expect(body.children).toHaveLength(3);
    expect(logged).toHaveBeenCalledTimes(1);
    logged.mockRestore();
  });
});
