import { describe, expect, it } from "vitest";

import { EXIT_WAIT_MS, exitApp, type ExitPage, HOME_URL } from "./exitApp";
import { INSTALLED_DISPLAY_QUERY } from "./installFlow";

// A page in a browser tab or an installed app, whose window closes on close() unless the browser
// refuses, and which runs what exiting waits for when told to.
class FakePage implements ExitPage {
  closed = false;
  closes = 0;
  readonly location = {
    assign: (url: string) => {
      this.visited.push(url);
    },
  };
  readonly navigator: ExitPage["navigator"];
  readonly visited: string[] = [];
  readonly waits: number[] = [];
  private readonly waiting: (() => void)[] = [];

  constructor(
    private readonly displayInstalled: boolean,
    iosStandalone: boolean,
    private readonly closeWorks: boolean,
  ) {
    this.navigator = { maxTouchPoints: 0, standalone: iosStandalone, userAgent: "" };
  }

  close(): void {
    this.closes += 1;
    this.closed = this.closeWorks;
  }

  matchMedia(query: string) {
    return { matches: query === INSTALLED_DISPLAY_QUERY && this.displayInstalled };
  }

  setTimeout(handler: () => void, ms: number): void {
    this.waits.push(ms);
    this.waiting.push(handler);
  }

  wait(): void {
    this.waiting.splice(0).forEach((handler) => handler());
  }
}

describe("exitApp", () => {
  it.each<[string, boolean, boolean, boolean, { closes: number; visited: string[] }]>([
    [
      "a browser tab goes home without closing",
      false,
      false,
      true,
      { closes: 0, visited: [HOME_URL] },
    ],
    ["an installed app closes", true, false, true, { closes: 1, visited: [] }],
    ["iOS's Home Screen app closes", false, true, true, { closes: 1, visited: [] }],
    [
      "an installed app whose window stays open goes home",
      true,
      false,
      false,
      { closes: 1, visited: [HOME_URL] },
    ],
  ])("%s", (_, displayInstalled, iosStandalone, closeWorks, expected) => {
    const page = new FakePage(displayInstalled, iosStandalone, closeWorks);
    exitApp(page);
    page.wait();
    expect({ closes: page.closes, visited: page.visited }).toEqual(expected);
  });

  it("waits EXIT_WAIT_MS for the window to close before going home", () => {
    const page = new FakePage(true, false, false);
    exitApp(page);
    const beforeWait = [...page.visited];
    page.wait();
    expect({ beforeWait, visited: page.visited, waits: page.waits }).toEqual({
      beforeWait: [],
      visited: [HOME_URL],
      waits: [EXIT_WAIT_MS],
    });
  });
});
