import { type InstallHost, pageRunsAsApp } from "./installFlow";

// The site's home page, where exiting goes when the window stays open.
export const HOME_URL = "/";

// How long exiting waits for the window to close before it goes home instead.
export const EXIT_WAIT_MS = 500;

// The parts of window exitApp uses, so tests can pass a fake.
export interface ExitPage extends Pick<InstallHost, "matchMedia" | "navigator"> {
  close(): void;
  // Whether the window has closed.
  readonly closed: boolean;
  readonly location: { assign(url: string): void };
  setTimeout(handler: () => void, ms: number): unknown;
}

// The browser's window.
export function browserExitPage(): ExitPage {
  return window;
}

// Leaves the game, for a start screen's Exit button. The installed app (display-mode fullscreen
// or standalone, or iOS's navigator.standalone) closes its window, which the browser allows while
// its history holds only the game; where the window is still open EXIT_WAIT_MS later, or in a
// browser tab, the page goes to the site's home page.
export function exitApp(page: ExitPage): void {
  const home = () => page.location.assign(HOME_URL);
  if (!pageRunsAsApp(page)) {
    home();
    return;
  }
  page.close();
  page.setTimeout(() => {
    if (!page.closed) {
      home();
    }
  }, EXIT_WAIT_MS);
}
