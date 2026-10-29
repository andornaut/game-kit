// Whether and how the game can be installed as an app on this device. Pure, so a game and its
// site's pages share it: installFlow.ts reads the facts from the browser.

// A browser that installs the page only from its own menu: iOS, from Share, or Firefox for
// Android, from its menu.
export type MenuInstallBrowser = "firefoxAndroid" | "ios";

// installed: running as the installed app, or installed during this visit. prompt: the browser
// handed over its install prompt (Android and desktop Chromium). menuSteps: a browser that
// installs only from its own menu (iOS, Firefox for Android) and not installed, so the page shows
// that browser's steps. unsupported: none of these, so nothing offers to install.
export type InstallState = "installed" | "menuSteps" | "prompt" | "unsupported";

export interface InstallFacts {
  // The browser reported installing the app during this visit (appinstalled, or an accepted
  // prompt).
  readonly appInstalled: boolean;
  // A display-mode media query for fullscreen or standalone matches.
  readonly displayModeInstalled: boolean;
  // A beforeinstallprompt event is held.
  readonly hasPrompt: boolean;
  // iOS's navigator.standalone: opened from the Home Screen.
  readonly iosStandalone: boolean;
  // The browser that installs only from its own menu, or undefined for any other.
  readonly menuBrowser: MenuInstallBrowser | undefined;
}

// Whether the page runs as the installed app: in its own window, not a browser tab. An install
// during this visit leaves the page in its tab, so appInstalled does not count.
export function runsAsApp(
  facts: Pick<InstallFacts, "displayModeInstalled" | "iosStandalone">,
): boolean {
  return facts.displayModeInstalled || facts.iosStandalone;
}

export function installState(facts: InstallFacts): InstallState {
  if (facts.appInstalled || runsAsApp(facts)) {
    return "installed";
  }
  if (facts.hasPrompt) {
    return "prompt";
  }
  return facts.menuBrowser === undefined ? "unsupported" : "menuSteps";
}

// Whether the state offers a way to install, so the game shows its install offer.
export function offersInstall(state: InstallState): boolean {
  return state === "prompt" || state === "menuSteps";
}

// An iPhone, iPod or iPad. iPadOS asks for desktop sites by default, naming itself a Mac, so a
// Mac with a touch screen counts too.
export function isIosDevice(userAgent: string, maxTouchPoints: number): boolean {
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

// Firefox for Android, which never fires beforeinstallprompt. Chromium-based browsers name Chrome
// in their user agent, and Firefox on iOS names itself FxiOS, not Firefox/.
export function isFirefoxAndroid(userAgent: string): boolean {
  return /Android/.test(userAgent) && /Firefox\//.test(userAgent) && !/Chrom/.test(userAgent);
}

// The browser that installs the page only from its own menu, with no install prompt: iOS, from
// Share, or Firefox for Android, from its menu. Undefined for any other browser.
export function menuInstallBrowser(
  userAgent: string,
  maxTouchPoints: number,
): MenuInstallBrowser | undefined {
  if (isIosDevice(userAgent, maxTouchPoints)) {
    return "ios";
  }
  return isFirefoxAndroid(userAgent) ? "firefoxAndroid" : undefined;
}
