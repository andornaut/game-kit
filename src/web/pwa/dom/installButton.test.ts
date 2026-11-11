import { describe, expect, it } from "vitest";

import type { InstallState, InstallStepsKind } from "../installState.ts";
import { wireInstallButton } from "./installButton.ts";
import type { InstallFlow } from "./installFlow.ts";

class FakeSection {
  readonly dataset: { readonly steps: string };
  hidden = false;
  readonly title: { readonly id: string };

  constructor(kind: string) {
    this.dataset = { steps: kind };
    this.title = { id: `${kind}-title` };
  }
}

// A steps dialog with a section per kind, read through the selectors wireInstallButton uses.
class FakeDialog extends EventTarget {
  labelledBy: string | undefined;
  open = false;

  constructor(readonly sections: readonly FakeSection[]) {
    super();
  }

  close(): void {
    this.open = false;
  }

  querySelector(selector: string): FakeSection | FakeSection["title"] | null {
    const [, kind, title] = /^\[data-steps="(\w+)"\]( h2)?$/.exec(selector) ?? [];
    const section = this.sections.find((candidate) => candidate.dataset.steps === kind);
    if (section === undefined) {
      return null;
    }
    return title === undefined ? section : section.title;
  }

  querySelectorAll(): readonly FakeSection[] {
    return this.sections;
  }

  setAttribute(name: string, value: string): void {
    if (name === "aria-labelledby") {
      this.labelledBy = value;
    }
  }

  showModal(): void {
    this.open = true;
  }
}

class FakeButton extends EventTarget {
  hidden = false;
}

function fakeFlow(state: InstallState, stepsKind: InstallStepsKind): InstallFlow {
  return {
    install: () => Promise.resolve("steps"),
    onChange: () => () => true,
    state: () => state,
    stepsKind,
  };
}

const settle = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

describe("wireInstallButton", () => {
  it.each<[InstallState, boolean]>([
    ["installed", true],
    ["prompt", false],
    ["steps", false],
  ])("hides the button in state %s: %s", (state, hidden) => {
    const button = new FakeButton();
    wireInstallButton(
      fakeFlow(state, "ios"),
      button as unknown as HTMLElement,
      new FakeDialog([]) as unknown as HTMLDialogElement,
    );
    expect(button.hidden).toBe(hidden);
  });

  it.each<[InstallStepsKind, string]>([
    ["ios", "ios"],
    ["firefoxDesktop", "other"],
  ])("shows the %s steps in the %s section", async (kind, shown) => {
    const button = new FakeButton();
    const dialog = new FakeDialog(["ios", "other"].map((section) => new FakeSection(section)));
    wireInstallButton(
      fakeFlow("steps", kind),
      button as unknown as HTMLElement,
      dialog as unknown as HTMLDialogElement,
    );
    button.dispatchEvent(new Event("click"));
    await settle();
    expect({
      hidden: dialog.sections.map((section) => section.hidden),
      labelledBy: dialog.labelledBy,
      open: dialog.open,
    }).toEqual({
      hidden: dialog.sections.map((section) => section.dataset.steps !== shown),
      labelledBy: `${shown}-title`,
      open: true,
    });
  });
});
