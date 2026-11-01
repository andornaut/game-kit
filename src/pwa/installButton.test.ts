import { describe, expect, it } from "vitest";

import { wireInstallButton } from "./installButton";
import type { InstallFlow, InstallOutcome } from "./installFlow";
import type { InstallState, MenuInstallBrowser } from "./installState";

const settle = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

class FakeElement extends EventTarget {
  hidden = false;
  id = "";
  readonly dataset: { browser?: string } = {};
}

// The steps dialog: a section per menu browser, each with its h2, and a close button.
class FakeDialog extends FakeElement {
  readonly attributes = new Map<string, string>();
  readonly closeButton = new FakeElement();
  open = false;
  readonly sections: FakeElement[];
  readonly titles: FakeElement[];

  constructor(browsers: readonly MenuInstallBrowser[]) {
    super();
    this.sections = browsers.map((browser) =>
      Object.assign(new FakeElement(), { dataset: { browser } }),
    );
    this.titles = browsers.map((browser) =>
      Object.assign(new FakeElement(), { id: `steps-${browser}` }),
    );
  }

  close(): void {
    this.open = false;
  }

  querySelector(selectors: string): FakeElement | null {
    if (selectors === "button") {
      return this.closeButton;
    }
    const index = this.sections.findIndex(
      ({ dataset }) => selectors === `[data-browser="${dataset.browser}"] h2`,
    );
    return this.titles[index] ?? null;
  }

  querySelectorAll(selectors: string): FakeElement[] {
    return selectors === "[data-browser]" ? this.sections : [];
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  showModal(): void {
    this.open = true;
  }
}

// An install flow in state, whose install() answers outcome; change() moves it to a new state.
function fakeFlow(state: InstallState, outcome: InstallOutcome, menuBrowser?: MenuInstallBrowser) {
  const listeners: ((state: InstallState) => void)[] = [];
  let current = state;
  const flow: InstallFlow = {
    install: () => Promise.resolve(outcome),
    menuBrowser,
    onChange(listener) {
      listeners.push(listener);
      return () => undefined;
    },
    state: () => current,
  };
  const change = (next: InstallState) => {
    current = next;
    listeners.forEach((listener) => listener(next));
  };
  return { change, flow };
}

const BROWSERS: readonly MenuInstallBrowser[] = ["firefoxAndroid", "ios"];

function wire(state: InstallState, outcome: InstallOutcome, menuBrowser?: MenuInstallBrowser) {
  const button = new FakeElement();
  const steps = new FakeDialog(BROWSERS);
  const { change, flow } = fakeFlow(state, outcome, menuBrowser);
  wireInstallButton(flow, button as unknown as HTMLElement, steps as unknown as HTMLDialogElement);
  return { button, change, steps };
}

describe("wireInstallButton", () => {
  it.each<[InstallState, boolean]>([
    ["prompt", false],
    ["menuSteps", false],
    ["installed", true],
    ["unsupported", true],
  ])("in state %s hides the button: %s", (state, hidden) => {
    expect(wire(state, "unavailable").button.hidden).toBe(hidden);
  });

  it("hides the button once the game is installed", () => {
    const { button, change } = wire("prompt", "accepted");
    change("installed");
    expect(button.hidden).toBe(true);
  });

  it.each(BROWSERS)("shows only %s's steps, titled by its h2", async (browser) => {
    const { button, steps } = wire("menuSteps", "menuSteps", browser);
    button.dispatchEvent(new Event("click"));
    await settle();
    expect({
      label: steps.attributes.get("aria-labelledby"),
      open: steps.open,
      shown: steps.sections.filter(({ hidden }) => !hidden).map(({ dataset }) => dataset.browser),
    }).toEqual({ label: `steps-${browser}`, open: true, shown: [browser] });
  });

  it.each<InstallOutcome>(["accepted", "dismissed", "unavailable"])(
    "shows no steps when the prompt answers %s",
    async (outcome) => {
      const { button, steps } = wire("prompt", outcome);
      button.dispatchEvent(new Event("click"));
      await settle();
      expect(steps.open).toBe(false);
    },
  );

  // A tap dispatched on the element it lands on, and one inside the dialog bubbled to it.
  it.each<[string, (steps: FakeDialog) => void, boolean]>([
    ["its close button", (steps) => steps.closeButton.dispatchEvent(new Event("click")), false],
    ["the dimmed page around it", (steps) => steps.dispatchEvent(new Event("click")), false],
    [
      "a section inside it",
      (steps) => {
        const event = new Event("click");
        Object.defineProperty(event, "target", { value: steps.sections[0] });
        steps.dispatchEvent(event);
      },
      true,
    ],
  ])("after a tap on %s, keeps the steps open: %s", (_, tap, open) => {
    const { steps } = wire("menuSteps", "menuSteps", "ios");
    steps.showModal();
    tap(steps);
    expect(steps.open).toBe(open);
  });
});
