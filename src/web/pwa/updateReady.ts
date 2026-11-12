// When to offer a newer version of a game the service worker (dom/serviceWorker) precached. A
// controlled page runs the version on disk at once; a newer version installs in the background,
// checked file by file, and is offered only once it waits, fully stored. The game has a home
// screen, where it may show an update offer whose button switches versions. A save a newer
// version wrote requires the update instead, which switches without an offer. dom/updateReady
// acts on these decisions in the page.

// The message a page posts to a waiting service worker to make it take over now.
// dom/serviceWorker imports only its type, so the built worker holds nothing else.
export const SKIP_WAITING_MESSAGE = "skip-waiting";
export type SkipWaitingMessage = typeof SKIP_WAITING_MESSAGE;

export interface OfferState {
  // The player dismissed the offer for this visit (UpdateFlow's dismissOffer).
  dismissed: boolean;
  // The update offer may show: the game's home screen is in front, never mid-game or in a menu
  // over it.
  offerVisible: boolean;
  // The waiting version was told to take over, and the page reloads once it does.
  reloading: boolean;
  // A save a newer version wrote requires the update (UpdateFlow's requireNewer): the kit updates
  // by itself and never offers it.
  required: boolean;
  // A newer version is installed and waiting behind the one that controls the page. A page no
  // version controls never has one: it loaded from the network, and the next launch runs the
  // newest installed version.
  waiting: boolean;
}

// Whether the game shows the update offer: a version waits, the home screen is in front, the
// player has not dismissed it this visit, no switch is under way and no update is required.
// Neither input nor time changes this: only a required update switches without the offer.
export function offerShown({
  dismissed,
  offerVisible,
  reloading,
  required,
  waiting,
}: OfferState): boolean {
  return waiting && offerVisible && !dismissed && !reloading && !required;
}

// A required update's state, for a save a newer version wrote. "updating": a newer version is
// registering, being checked for, installing or activating, or the page is reloading into it; the
// game shows its travelling loading bar. "unavailable": none of that is under way, because the
// device is offline, the server has no version newer than the running one, an install failed or
// the page cannot become controlled; the game shows its one "connect to update" message, and the
// kit retries when the device reconnects and when the page comes back into view.
export type RequiredUpdateState = "unavailable" | "updating";

// The shortest time between checks for a newer version when the page comes back into view, so
// switching apps on the home screen asks the server at most once a minute.
export const RESUME_CHECK_MS = 60_000;

export interface ResumeState {
  // When the last check for a newer version ran, on now()'s clock, if one has.
  lastCheck: number | undefined;
  now: number;
  // The update offer may show, as in OfferState.
  offerVisible: boolean;
  online: boolean;
  // The page is in view: the app or tab came back to the front.
  visible: boolean;
}

// Whether the page coming back into view checks for a newer version. An installed app usually
// resumes without relaunching, so the launch's check can be long past, and a player resuming on
// the home screen never arrives there to check. Mid-game or in a menu, the next arrival home
// checks instead.
export function resumeCheckDue({
  lastCheck,
  now,
  offerVisible,
  online,
  visible,
}: ResumeState): boolean {
  return (
    visible &&
    offerVisible &&
    online &&
    (lastCheck === undefined || now - lastCheck >= RESUME_CHECK_MS)
  );
}
