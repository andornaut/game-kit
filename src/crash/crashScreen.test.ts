import { afterEach, expect, it, vi } from "vitest";

import { type CrashScreenOptions, installCrashScreen } from "./crashScreen.ts";

class FakeElement extends EventTarget {
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  readonly style = { setProperty: vi.fn() };
  className = "";
  id = "";
  textContent = "";
  focus = vi.fn();

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

afterEach(() => {
  vi.unstubAllGlobals();
});

it("opens one accessible native crash dialog, hides private details and retains reload", () => {
  const body = new FakeElement();
  const game = new FakeElement();
  const controls = new FakeElement();
  body.append(game, controls);
  const window = new EventTarget();
  const reload = vi.fn();
  vi.stubGlobal("document", { body, createElement: () => new FakeElement() });
  vi.stubGlobal("window", window);
  vi.stubGlobal("location", { reload });
  const options: CrashScreenOptions = {
    buildLabel: "Synthetic build",
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
  const crashScreen = installCrashScreen(options);
  const stop = vi.fn();
  crashScreen.stopGameOnCrash(stop);
  const error = new Error("private error message");
  error.stack = "private stack details";
  window.dispatchEvent(
    Object.assign(new Event("error"), {
      error,
      filename: "/synthetic-client.ts",
      message: error.message,
    }),
  );
  window.dispatchEvent(
    Object.assign(new Event("error"), { error: new Error("another private error") }),
  );

  expect(body.children).toHaveLength(3);
  const screen = body.children[2];
  expect(screen?.attributes.get("role")).toBe("alertdialog");
  expect(screen?.attributes.get("aria-modal")).toBe("true");
  expect(screen?.attributes.has("inert")).toBe(false);
  expect([game.attributes.has("inert"), controls.attributes.has("inert")]).toEqual([true, true]);
  expect(stop).toHaveBeenCalledTimes(1);
  const content = descendants(body);
  const labelledBy = screen?.attributes.get("aria-labelledby");
  const describedBy = screen?.attributes.get("aria-describedby");
  expect(labelledBy).toBeTruthy();
  expect(describedBy).toBeTruthy();
  expect(content.find((element) => element.id === labelledBy)?.textContent).toBe(
    options.words.title,
  );
  expect(content.find((element) => element.id === describedBy)?.textContent).toBe(
    options.words.body,
  );
  const text = content.map((element) => element.textContent).join("\n");
  expect(text).not.toContain(error.message);
  expect(text).not.toContain(error.stack);
  expect(text).not.toContain("another private error");
  expect(text).not.toContain(options.buildLabel);
  expect(content.some((element) => element.className === "crash-details")).toBe(false);
  const button = content.find((element) => element.className === "crash-button");
  expect(button?.textContent).toBe(options.words.reload);
  expect(button?.focus).toHaveBeenCalledTimes(1);
  expect(reload).not.toHaveBeenCalled();
  button?.dispatchEvent(new Event("click"));
  expect(reload).toHaveBeenCalledTimes(1);
});
