// The site's home page, where exiting goes when the window stays open.
export const HOME_URL = "/";

// How long exiting waits for the window to close before it goes home instead.
export const EXIT_WAIT_MS = 500;

// The parts of window exitApp uses, so tests can pass a fake.
export interface ExitPage {
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

// Leaves the game, for a start screen's Exit or a Quit question's Quit. The window closes, as an
// installed app or a browser tab does where its history holds only the game; where the window is
// still open EXIT_WAIT_MS later (a browser that refuses the close, or a tab with pages before the
// game), the page goes to the site's home page.
export function exitApp(page: ExitPage): void {
  page.close();
  page.setTimeout(() => {
    if (!page.closed) {
      page.location.assign(HOME_URL);
    }
  }, EXIT_WAIT_MS);
}
