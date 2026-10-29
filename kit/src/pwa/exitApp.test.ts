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
  readonly navigator: { maxTouchPoints: number; standalone: boolean; userAgent: string };
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
  // Installed as an app (display mode or iOS's standalone) or in a browser tab, its window
  // closing on close() or staying open: each closes once, and goes home only where it stays open.
  const pages = [
    ["a browser tab", false, false],
    ["an installed app", true, false],
    ["iOS's Home Screen app", false, true],
  ] as const;
  const rows = pages.flatMap(([name, displayInstalled, iosStandalone]) => [
    [`${name} that closes, closes`, displayInstalled, iosStandalone, true, []] as const,
    [
      `${name} that stays open, goes home`,
      displayInstalled,
      iosStandalone,
      false,
      [HOME_URL],
    ] as const,
  ]);
  it.each(rows)("%s", (_, displayInstalled, iosStandalone, closeWorks, visited) => {
    const page = new FakePage(displayInstalled, iosStandalone, closeWorks);
    exitApp(page);
    page.wait();
    expect({ closes: page.closes, visited: page.visited }).toEqual({ closes: 1, visited });
  });

  it("waits EXIT_WAIT_MS for the window to close before going home", () => {
    const page = new FakePage(false, false, false);
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
