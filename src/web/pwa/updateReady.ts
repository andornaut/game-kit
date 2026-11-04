// When to update to a newer version of a game the service worker (dom/serviceWorker) precached.
// The game has a home screen, where it may show an update plate whose button switches versions.
// dom/updateReady acts on these decisions in the page.

// The message a page posts to a waiting service worker to make it take over now.
// dom/serviceWorker imports only its type, so the built worker holds nothing else.
export const SKIP_WAITING_MESSAGE = "skip-waiting";
export type SkipWaitingMessage = typeof SKIP_WAITING_MESSAGE;

// A newer version than the one the page runs: none found, still being checked for or installing,
// or installed and waiting behind the running one. On a page no version controls, a newer worker
// that installed counts as waiting even once it activates, since it never controls the page.
export type NewerVersion = "none" | "pending" | "waiting";

export interface UpdateFlowOptions {
  // Automatic by default. Manual activation requires accept(), including before input.
  readonly activationPolicy?: "automatic" | "manual";
}

export interface UpdateState {
  readonly activationPolicy?: UpdateFlowOptions["activationPolicy"];
  // A key, touch or click, or play started, since the page loaded.
  interacted: boolean;
  newer: NewerVersion;
  // The update offer may show: the game's home screen is in front, never mid-game or in a menu
  // over it.
  offerVisible: boolean;
  // navigator.onLine: false means there is no network to check for a newer version on.
  online: boolean;
  // The waiting version was told to take over, and the page reloads once it does.
  reloading: boolean;
  // The boot's wait for a newer version to be checked for and installed has run out.
  waitOver: boolean;
}

// wait: hold the boot, so a newer version can be checked for and installed first.
// run: run the version the page loaded, with no update plate.
// switch: have the waiting version take over and reload into it.
// prompt: show the home screen's update plate, whose button switches.
export type UpdateAction = "prompt" | "run" | "switch" | "wait";

// Under automatic activation, before input a waiting version takes over at once. On a fresh load
// the boot waits for the check and install, so that reload comes before the game draws. Once they
// have interacted the page never reloads on its own, and the update plate shows on each arrival
// home. A switch that has not reloaded by the end of the boot wait lets the game boot.
export function updateAction({
  activationPolicy = "automatic",
  interacted,
  newer,
  offerVisible,
  online,
  reloading,
  waitOver,
}: UpdateState): UpdateAction {
  if (reloading) {
    return waitOver ? "run" : "wait";
  }
  if (newer === "waiting") {
    if (!interacted && activationPolicy === "automatic") {
      return "switch";
    }
    return offerVisible ? "prompt" : "run";
  }
  return newer === "pending" && online && !interacted && !waitOver ? "wait" : "run";
}

// The shortest time between checks for a newer version when the page comes back into view, so
// switching apps on the home screen asks the server at most once a minute.
export const RESUME_CHECK_MS = 60_000;

export interface ResumeState {
  // When the last check for a newer version ran, on now()'s clock, if one has.
  lastCheck: number | undefined;
  now: number;
  // The update offer may show, as in UpdateState.
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
