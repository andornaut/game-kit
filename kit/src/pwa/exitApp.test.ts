import { describe, expect, it } from "vitest";

import type { AppWindowHost } from "./appWindow";
import { INSTALLED_APP_DISPLAY_QUERY } from "./backNavigation";
import { exitApp, type ExitPage, HOME_URL } from "./exitApp";

const CHROME = "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0";
const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 9)";
const DESKTOP = "Mozilla/5.0 (X11; Linux x86_64)";
const SAFARI = "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0";

// Each platform's browser by user agent and touch points. iPadOS asks for desktop sites by
// default, so its Safari names itself a Mac, told from one by its touch screen.
const PLATFORMS = [
  ["Chrome for Android", `${ANDROID} ${CHROME} Mobile Safari/537.36`, 5, "androidChromium"],
  [
    "Edge for Android",
    `${ANDROID} ${CHROME} Mobile Safari/537.36 EdgA/140.0.0.0`,
    5,
    "androidEdge",
  ],
  [
    "Firefox for Android",
    "Mozilla/5.0 (Android 15; Mobile; rv:150.0) Gecko/150.0 Firefox/150.0",
    5,
    "androidFirefox",
  ],
  [
    "Samsung Internet",
    `${ANDROID} AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36`,
    5,
    "androidSamsung",
  ],
  ["desktop Chrome", `${DESKTOP} ${CHROME} Safari/537.36`, 0, "desktopChromium"],
  ["desktop Edge", `${DESKTOP} ${CHROME} Safari/537.36 Edg/140.0.0.0`, 0, "desktopChromium"],
  ["desktop Opera", `${DESKTOP} ${CHROME} Safari/537.36 OPR/120.0.0.0`, 0, "other"],
  [
    "an iPhone's Safari",
    `Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) ${SAFARI} Mobile/15E148 Safari/604.1`,
    5,
    "ios",
  ],
  [
    "an iPad's Safari, named a Mac",
    `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ${SAFARI} Safari/605.1.15`,
    5,
    "ios",
  ],
  [
    "a Mac's Safari",
    `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ${SAFARI} Safari/605.1.15`,
    0,
    "macSafari",
  ],
  [
    "desktop Firefox",
    "Mozilla/5.0 (X11; Linux x86_64; rv:150.0) Gecko/20100101 Firefox/150.0",
    0,
    "other",
  ],
] as const;

// How the page runs: an installed app's window, by display mode or by iOS's navigator.standalone,
// or a browser tab.
const INSTALL_TYPES = [
  ["an app window (display mode)", true, false],
  ["an app window (navigator.standalone)", false, true],
  ["a browser tab", false, false],
] as const;

// A page on userAgent, run as appDisplay and standalone say, recording its closes and visits.
class FakePage implements ExitPage {
  closes = 0;
  readonly location = {
    assign: (url: string) => {
      this.visited.push(url);
    },
  };
  readonly navigator: AppWindowHost["navigator"];
  readonly visited: string[] = [];

  constructor(
    userAgent: string,
    maxTouchPoints: number,
    private readonly appDisplay: boolean,
    standalone: boolean,
  ) {
    this.navigator = { maxTouchPoints, standalone, userAgent };
  }

  close(): void {
    this.closes += 1;
  }

  matchMedia(query: string) {
    return { matches: query === INSTALLED_APP_DISPLAY_QUERY && this.appDisplay };
  }
}

// An app window only closes, never going to another page; a browser tab goes straight to the
// site's home page without trying to close.
describe.each(PLATFORMS)("exitApp on %s", (_, userAgent, touchPoints) => {
  it.each(INSTALL_TYPES)("in %s", (__, appDisplay, standalone) => {
    const page = new FakePage(userAgent, touchPoints, appDisplay, standalone);
    exitApp(page);
    const app = appDisplay || standalone;
    expect({ closes: page.closes, visited: page.visited }).toEqual(
      app ? { closes: 1, visited: [] } : { closes: 0, visited: [HOME_URL] },
    );
  });
});
