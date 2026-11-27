import { describe, expect, it, vi } from "vitest";

import { type InstallHost, type InstallPromptEvent, watchInstall } from "./installFlow.ts";

const DESKTOP_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

class FakeHost extends EventTarget implements InstallHost {
  readonly navigator = { maxTouchPoints: 0, userAgent: DESKTOP_CHROME };

  matchMedia() {
    return { matches: false };
  }
}

// A beforeinstallprompt event whose prompt resolves to the player's choice, or rejects.
function promptEvent(choice: "accepted" | "dismissed" | "fails"): InstallPromptEvent {
  return Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
    prompt: vi.fn(() =>
      choice === "fails" ? Promise.reject(new Error("prompt failed")) : Promise.resolve(),
    ),
    userChoice: Promise.resolve({ outcome: choice === "fails" ? "dismissed" : choice }),
  });
}

describe("watchInstall", () => {
  it("offers the browser's steps with no prompt held", async () => {
    const flow = watchInstall(new FakeHost());
    expect([flow.stepsKind, flow.state()]).toEqual(["chromiumDesktop", "steps"]);
    await expect(flow.install()).resolves.toBe("steps");
  });

  it.each<["accepted" | "dismissed" | "fails", string, string]>([
    ["accepted", "accepted", "installed"],
    ["dismissed", "dismissed", "steps"],
    ["fails", "steps", "steps"],
  ])(
    "prompts at once and reads a %s prompt as %s, then %s",
    async (choice, outcome, afterwards) => {
      const host = new FakeHost();
      const flow = watchInstall(host);
      const changes: string[] = [];
      flow.onChange((state) => changes.push(state));
      const event = promptEvent(choice);
      host.dispatchEvent(event);
      expect([event.defaultPrevented, flow.state()]).toEqual([true, "prompt"]);
      const installing = flow.install();
      expect(event.prompt).toHaveBeenCalledTimes(1);
      await expect(installing).resolves.toBe(outcome);
      expect(changes).toEqual(["prompt", afterwards]);
    },
  );
});
