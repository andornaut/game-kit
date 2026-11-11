// Whether and how the game can be installed as an app on this device. Pure, so a game and its
// site's pages share it: dom/installFlow reads the facts from the browser.

// The browser whose own install steps the page shows when there is no install prompt to call.
// chromiumAndroid is Chrome or Edge for Android; chromiumDesktop is desktop Chrome or Edge, and
// Brave, which names itself Chrome. firefoxDesktop is Firefox off Android, which cannot install
// the page, so its steps say so. ios covers every iOS browser, all of which install from Share.
// other is any browser not listed, in-app browsers and WebViews included, whose steps send the
// player to the device's own browser.
export type InstallStepsKind =
  | "chromiumAndroid"
  | "chromiumDesktop"
  | "firefoxAndroid"
  | "firefoxDesktop"
  | "ios"
  | "other"
  | "safariMac"
  | "samsungInternet";

// installed: running as the installed app, or installed during this visit. prompt: the browser
// handed over its install prompt (Android and desktop Chromium). steps: not installed and no
// prompt held, so the page shows the browser's own install steps (InstallStepsKind).
export type InstallState = "installed" | "prompt" | "steps";

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
  return facts.hasPrompt ? "prompt" : "steps";
}

// Whether the state offers a way to install, so the game shows its install offer: every state but
// installed.
export function offersInstall(state: InstallState): boolean {
  return state !== "installed";
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

// The browser whose install steps the page shows. Chromium-based browsers name Chrome in their
// user agent: Edge adds Edg/ (EdgA/ on Android), Samsung Internet SamsungBrowser/ and Opera OPR/.
// Opera's install support is unverified and a WebView (wv) installs nothing, so both are other.
// Safari on a Mac names Version/ and Safari/; a Mac with a touch screen is an iPad (isIosDevice).
export function installStepsKind(userAgent: string, maxTouchPoints: number): InstallStepsKind {
  if (isIosDevice(userAgent, maxTouchPoints)) {
    return "ios";
  }
  if (isFirefoxAndroid(userAgent)) {
    return "firefoxAndroid";
  }
  if (/SamsungBrowser\//.test(userAgent)) {
    return "samsungInternet";
  }
  if (/OPR\/|\bwv\b/.test(userAgent)) {
    return "other";
  }
  if (/Android/.test(userAgent)) {
    return /Chrome\/|EdgA\//.test(userAgent) ? "chromiumAndroid" : "other";
  }
  if (/Firefox\//.test(userAgent)) {
    return "firefoxDesktop";
  }
  if (/Chrome\/|Edg\//.test(userAgent)) {
    return "chromiumDesktop";
  }
  return /Macintosh/.test(userAgent) && /Version\//.test(userAgent) && /Safari\//.test(userAgent)
    ? "safariMac"
    : "other";
}
