// Which uncaught errors open the crash screen, and what it says. No DOM, so it runs in unit
// tests; crashScreen.ts draws it.

export interface CrashReport {
  readonly message: string;
  // The script URL the browser blamed, or "" when it gave none (every rejection).
  readonly source: string;
  readonly stack: string | undefined;
}

// The fields of an ErrorEvent this reads.
interface ErrorEventLike {
  readonly error?: unknown;
  readonly filename?: string;
  readonly message?: string;
}

// The crash screen's words, as the game words them.
export interface CrashWords {
  readonly body: string;
  readonly reload: string;
  readonly title: string;
}

// The crash screen's words, and the message and stack in dev builds only.
export type CrashView = CrashWords & { readonly details: string | undefined };

const EXTENSION_URL =
  /\b(?:chrome-extension|moz-extension|safari-extension|safari-web-extension|webkit-masked-url):\/\//;
// What the browser reports for an error in a cross-origin script, with no stack.
const CROSS_ORIGIN_MESSAGE = /^Script error\.?$/;
// Benign: the browser skipped some resize notifications. Chrome words it two ways.
const RESIZE_OBSERVER_MESSAGE = /ResizeObserver loop/;
const URL_IN_STACK = /\b[a-z][a-z0-9+.-]*:\/\/[^\s)]+/;

function textOf(value: unknown): string {
  try {
    return String(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

function reportFromThrown(source: string, thrown: unknown, fallbackMessage: string): CrashReport {
  if (thrown instanceof Error) {
    return {
      message: thrown.message || thrown.name,
      source,
      stack: typeof thrown.stack === "string" && thrown.stack !== "" ? thrown.stack : undefined,
    };
  }
  return { message: fallbackMessage, source, stack: undefined };
}

export function reportFromErrorEvent(event: ErrorEventLike): CrashReport {
  const message = event.message ?? "";
  return reportFromThrown(
    event.filename ?? "",
    event.error,
    message === "" && event.error != null ? textOf(event.error) : message,
  );
}

export function reportFromRejection(reason: unknown): CrashReport {
  return reportFromThrown("", reason, textOf(reason));
}

// The script that threw: the URL the browser blamed, else the stack's first URL.
function originOf(report: CrashReport): string {
  if (report.source !== "") {
    return report.source;
  }
  return URL_IN_STACK.exec(report.stack ?? "")?.[0] ?? "";
}

export function isCrash(report: CrashReport): boolean {
  if (EXTENSION_URL.test(originOf(report))) {
    return false;
  }
  if (CROSS_ORIGIN_MESSAGE.test(report.message.trim()) && report.stack === undefined) {
    return false;
  }
  return !RESIZE_OBSERVER_MESSAGE.test(report.message);
}

// Returns a function that says whether a report opens the crash screen: only the first crash
// does, so later errors never stack a second screen.
export function crashGate(): (report: CrashReport) => boolean {
  let shown = false;
  return (report) => {
    if (shown || !isCrash(report)) {
      return false;
    }
    shown = true;
    return true;
  };
}

// Chrome's stack starts with the message; Firefox's and Safari's don't.
function detailsOf(report: CrashReport): string {
  const { message, stack } = report;
  if (stack === undefined) {
    return message;
  }
  return stack.includes(message) ? stack : `${message}\n${stack}`;
}

export function crashView(words: CrashWords, dev: boolean, report: CrashReport): CrashView {
  return { ...words, details: dev ? detailsOf(report) : undefined };
}
