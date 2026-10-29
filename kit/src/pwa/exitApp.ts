import { type AppWindowHost, runsInAppWindow } from "./appWindow";

// The site's home page, where leaving from a browser tab goes.
export const HOME_URL = "/";

// The parts of window exitApp uses, so tests can pass a fake.
export interface ExitPage extends AppWindowHost {
  close(): void;
  readonly location: { assign(url: string): void };
}

// The browser's window.
export function browserExitPage(): ExitPage {
  return window;
}

// Leaves the game, for a start screen's Exit or a Quit question's Quit. An installed app's window
// (runsInAppWindow) closes, and never goes to another page; a game offers this only where the
// app can close (appCannotClose false). A browser tab goes to the site's home page.
export function exitApp(page: ExitPage): void {
  if (runsInAppWindow(page)) {
    page.close();
  } else {
    page.location.assign(HOME_URL);
  }
}
