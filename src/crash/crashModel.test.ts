import { describe, expect, it } from "vitest";

import {
  crashGate,
  type CrashReport,
  crashView,
  isCrash,
  reportFromErrorEvent,
  reportFromRejection,
} from "./crashModel";

const APP_URL = "https://game.test/assets/play-abc123.js";

function thrownAt(url: string, message = "boom"): Error {
  const error = new Error(message);
  error.stack = `Error: ${message}\n    at step (${url}:1:200)\n    at tick (${url}:1:900)`;
  return error;
}

const crash: CrashReport = { message: "boom", source: APP_URL, stack: thrownAt(APP_URL).stack };

describe("reportFromErrorEvent", () => {
  it("takes the message and stack from the thrown error, not the event's prefixed message", () => {
    const error = thrownAt(APP_URL);

    expect(
      reportFromErrorEvent({ error, filename: APP_URL, message: "Uncaught Error: boom" }),
    ).toEqual({ message: "boom", source: APP_URL, stack: error.stack });
  });

  it("falls back to the event's message when no error object came with it", () => {
    expect(reportFromErrorEvent({ error: null, filename: "", message: "Script error." })).toEqual({
      message: "Script error.",
      source: "",
      stack: undefined,
    });
  });

  it("names a thrown non-error value", () => {
    expect(reportFromErrorEvent({ error: "plain string", message: "" }).message).toBe(
      "plain string",
    );
  });
});

describe("reportFromRejection", () => {
  it("reads an Error reason", () => {
    const error = thrownAt(APP_URL, "save failed");

    expect(reportFromRejection(error)).toEqual({
      message: "save failed",
      source: "",
      stack: error.stack,
    });
  });

  it("names a reason that is not an Error, even one that cannot be stringified", () => {
    expect(reportFromRejection(42).message).toBe("42");
    expect(reportFromRejection(undefined).message).toBe("undefined");
    expect(reportFromRejection(Object.create(null)).message).toBe("[object Object]");
  });
});

describe("isCrash", () => {
  const from = (source: string): CrashReport => ({ message: "boom", source, stack: undefined });
  const saying = (message: string): CrashReport => ({ message, source: "", stack: undefined });
  const extension = "chrome-extension://abcdef/content.js";

  it("models each crash", () => {
    for (const [, report, expected] of [
      ["counts an error thrown by the game's own script", crash, true],
      ["ignores a Chrome extension's error", from(extension), false],
      ["ignores a Firefox extension's error", from("moz-extension://1234-5678/inject.js"), false],
      ["ignores a Safari extension's error", from("safari-web-extension://ABCD/script.js"), false],
      ["ignores a masked WebKit script's error", from("webkit-masked-url://hidden/"), false],
      [
        "ignores a rejection whose stack starts in an extension",
        { message: "boom", source: "", stack: thrownAt(extension).stack },
        false,
      ],
      ["counts a rejection whose stack starts in the game", { ...crash, source: "" }, true],
      ["ignores a cross-origin script's opaque error", saying("Script error."), false],
      ["ignores an opaque error without its full stop", saying("Script error"), false],
      ["counts 'Script error.' that has a stack", { ...crash, message: "Script error." }, true],
      [
        "ignores the ResizeObserver limit warning",
        saying("ResizeObserver loop limit exceeded"),
        false,
      ],
      [
        "ignores the ResizeObserver undelivered warning",
        saying("ResizeObserver loop completed with undelivered notifications."),
        false,
      ],
    ] satisfies readonly [string, CrashReport, boolean][]) {
      expect(isCrash(report)).toBe(expected);
    }
  });
});

describe("crashGate", () => {
  it("opens the screen for the first crash only", () => {
    const accept = crashGate();

    expect(accept(crash)).toBe(true);
    expect(accept(crash)).toBe(false);
    expect(accept({ ...crash, message: "a different error" })).toBe(false);
  });

  it("lets an ignored error pass without using up the screen", () => {
    const accept = crashGate();

    expect(
      accept({ message: "ResizeObserver loop limit exceeded", source: "", stack: undefined }),
    ).toBe(false);
    expect(accept(crash)).toBe(true);
  });
});

describe("crashView", () => {
  const text = { body: "Your progress is kept.", reload: "Reload", title: "Something went wrong" };

  it("shows the crash text, without details outside dev builds", () => {
    expect(crashView(text, false, crash)).toEqual({ ...text, details: undefined });
  });

  const bareStack = `step@${APP_URL}:1:200`;

  it("in dev builds, shows each crash in full", () => {
    for (const [, report, expected] of [
      ["adds the stack once when it already starts with the message", crash, crash.stack ?? ""],
      [
        "puts the message above a stack that leaves it out",
        { ...crash, stack: bareStack },
        `boom\n${bareStack}`,
      ],
      ["shows only the message when there is no stack", { ...crash, stack: undefined }, "boom"],
    ] satisfies readonly [string, CrashReport, string][]) {
      expect(crashView(text, true, report).details).toBe(expected);
    }
  });
});
