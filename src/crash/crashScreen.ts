// The crash screen: plain HTML over the whole page, since the canvas may be what broke. It
// writes nothing; a game that saves as it goes keeps what it last saved. Its styles are
// crash.css, which the game imports (a script cannot add a <style> under a CSP without
// 'unsafe-inline'), in the game's colours, which the screen sets as CSS variables.
import {
  crashGate,
  type CrashReport,
  crashView,
  type CrashWords,
  reportFromErrorEvent,
  reportFromRejection,
} from "./crashModel";

// The screen's colours, as CSS colours: the page behind the panel, the text and the panel's
// border, a button's face and the lip under it (its pressed edge), and the darkest colour, for
// the panel's shadow, the button's border and text, and the details' backdrop.
export interface CrashColours {
  readonly background: string;
  readonly buttonFace: string;
  readonly buttonLip: string;
  readonly ink: string;
  readonly text: string;
}

export interface CrashScreenOptions {
  // A line naming the build (build/buildLabel's BUILD_LABEL), above the details.
  readonly buildLabel: string;
  readonly colours: CrashColours;
  // Whether the screen shows the message and stack, with a Copy button.
  readonly dev: boolean;
  readonly words: CrashWords;
}

export interface CrashScreen {
  // Stops the game under the screen when a crash opens it; set once the game exists. Any error
  // it throws is logged and ignored.
  stopGameOnCrash(stop: () => void): void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  element.append(...children);
  return element;
}

function button(text: string, onClick: () => void): HTMLButtonElement {
  const element = el("button", "crash-button", text);
  element.type = "button";
  element.addEventListener("click", onClick);
  return element;
}

// The details are for developers, so their words are the kit's.
function detailsSection(text: string): HTMLDetailsElement {
  const pre = el("pre", "crash-stack", text);
  const status = el("p", "crash-status");
  status.setAttribute("role", "status");
  // Over http the clipboard API is missing, so the text is selected for a manual copy.
  const selectText = (note: string) => {
    getSelection()?.selectAllChildren(pre);
    status.textContent = note;
  };
  const copy = () => {
    const clipboard: Clipboard | undefined = globalThis.navigator.clipboard;
    if (clipboard === undefined) {
      selectText("No clipboard here: the text is selected.");
      return;
    }
    clipboard.writeText(text).then(
      () => {
        status.textContent = "Copied.";
      },
      () => selectText("Copy failed: the text is selected."),
    );
  };
  return el(
    "details",
    "crash-details",
    el("summary", "", "Error details"),
    pre,
    button("Copy", copy),
    status,
  );
}

function showCrashScreen(options: CrashScreenOptions, report: CrashReport): void {
  const view = crashView(options.words, options.dev, report);
  const title = el("h1", "crash-title", view.title);
  title.id = "crash-title";
  const body = el("p", "crash-body", view.body);
  body.id = "crash-body";
  const reload = button(view.reload, () => location.reload());
  const panel = el("div", "crash-panel", title, body, reload);
  if (view.details !== undefined) {
    panel.append(detailsSection(`${options.buildLabel}\n${view.details}`));
  }
  const screen = el("div", "crash", panel);
  const { colours } = options;
  for (const [name, colour] of [
    ["background", colours.background],
    ["button-face", colours.buttonFace],
    ["button-lip", colours.buttonLip],
    ["ink", colours.ink],
    ["text", colours.text],
  ] as const) {
    screen.style.setProperty(`--crash-${name}`, colour);
  }
  screen.setAttribute("role", "alertdialog");
  screen.setAttribute("aria-modal", "true");
  screen.setAttribute("aria-labelledby", title.id);
  screen.setAttribute("aria-describedby", body.id);
  // A game may listen for keys on window (Phaser does) and swallow Enter or Space.
  screen.addEventListener("keydown", (event) => event.stopPropagation());

  for (const child of document.body.children) {
    child.toggleAttribute("inert", true);
  }
  document.body.append(screen);
  reload.focus();
}

// Listens for uncaught errors and unhandled rejections and shows the screen on the first crash
// (crashGate). Call it before any other game module loads, so an error thrown while one loads
// shows the screen rather than a blank page. Phaser 4 does not catch errors in its game step:
// they reach window's error event and stop its requestAnimationFrame loop.
export function installCrashScreen(options: CrashScreenOptions): CrashScreen {
  const accept = crashGate();
  let stopGame = () => {};
  const crash = (report: CrashReport) => {
    if (!accept(report)) {
      return;
    }
    try {
      stopGame();
    } catch (error) {
      console.error("Crash screen: stopping the game failed", error);
    }
    showCrashScreen(options, report);
  };
  window.addEventListener("error", (event) => crash(reportFromErrorEvent(event)));
  window.addEventListener("unhandledrejection", (event) =>
    crash(reportFromRejection(event.reason)),
  );
  return {
    stopGameOnCrash: (stop) => {
      stopGame = stop;
    },
  };
}
