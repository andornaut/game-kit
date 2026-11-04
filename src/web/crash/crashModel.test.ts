import { describe, expect, it } from "vitest";

import {
  crashGate,
  type CrashReport,
  crashView,
  isCrash,
  reportFromErrorEvent,
  reportFromRejection,
} from "./crashModel.ts";

const APP_URL = "https://game.test/assets/play-abc123.js";
const EXTENSION = "chrome-extension://abcdef/content.js";

function thrownAt(url: string, message = "boom"): Error {
  const error = new Error(message);
  error.stack = `Error: ${message}\n    at step (${url}:1:200)\n    at tick (${url}:1:900)`;
  return error;
}

const crash: CrashReport = { message: "boom", source: APP_URL, stack: thrownAt(APP_URL).stack };
const from = (source: string): CrashReport => ({ message: "boom", source, stack: undefined });
const saying = (message: string): CrashReport => ({ message, source: "", stack: undefined });
const appError = thrownAt(APP_URL);
const nameOnly = Object.assign(new Error(""), { name: "TypeError", stack: "" });

describe("reportFromErrorEvent", () => {
  it.each<[string, Parameters<typeof reportFromErrorEvent>[0], CrashReport]>([
    [
      "the thrown error's message and stack, not the event's prefixed message",
      { error: appError, filename: APP_URL, message: "Uncaught Error: boom" },
      { message: "boom", source: APP_URL, stack: appError.stack },
    ],
    [
      "the event's message when no error object came with it",
      { error: null, filename: "", message: "Script error." },
      { message: "Script error.", source: "", stack: undefined },
    ],
    [
      "a thrown non-error value's text",
      { error: "plain string", message: "" },
      { message: "plain string", source: "", stack: undefined },
    ],
    [
      "an error's name when it has no message, and no empty stack",
      { error: nameOnly, filename: APP_URL },
      { message: "TypeError", source: APP_URL, stack: undefined },
    ],
  ])("takes %s", (_, event, report) => {
    expect(reportFromErrorEvent(event)).toEqual(report);
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

  it.each<[string, unknown, string]>([
    ["a number", 42, "42"],
    ["undefined", undefined, "undefined"],
    ["an object without a prototype", Object.create(null), "[object Object]"],
  ])("names a reason that is %s", (_, reason, message) => {
    expect(reportFromRejection(reason).message).toBe(message);
  });
});

describe("isCrash", () => {
  it.each<[string, CrashReport, boolean]>([
    ["an error thrown by the game's own script", crash, true],
    ["a Chrome extension's error", from(EXTENSION), false],
    ["a Firefox extension's error", from("moz-extension://1234-5678/inject.js"), false],
    ["a Safari extension's error", from("safari-web-extension://ABCD/script.js"), false],
    ["a masked WebKit script's error", from("webkit-masked-url://hidden/"), false],
    [
      "a rejection whose stack starts in an extension",
      { message: "boom", source: "", stack: thrownAt(EXTENSION).stack },
      false,
    ],
    ["a rejection whose stack starts in the game", { ...crash, source: "" }, true],
    ["a cross-origin script's opaque error", saying("Script error."), false],
    ["an opaque error without its full stop", saying("Script error"), false],
    ["'Script error.' that has a stack", { ...crash, message: "Script error." }, true],
    ["the ResizeObserver limit warning", saying("ResizeObserver loop limit exceeded"), false],
    [
      "the ResizeObserver undelivered warning",
      saying("ResizeObserver loop completed with undelivered notifications."),
      false,
    ],
  ])("classifies %s", (_, report, expected) => {
    expect(isCrash(report)).toBe(expected);
  });
});

describe("crashGate", () => {
  it.each<[string, CrashReport[], boolean[]]>([
    ["the first crash only", [crash, crash, { ...crash, message: "other" }], [true, false, false]],
    [
      "a crash after an ignored error",
      [saying("ResizeObserver loop limit exceeded"), crash],
      [false, true],
    ],
  ])("opens the screen for %s", (_, reports, opened) => {
    const accept = crashGate();
    expect(reports.map((report) => accept(report))).toEqual(opened);
  });
});

describe("crashView", () => {
  const words = { body: "Your progress is kept.", reload: "Reload", title: "Something went wrong" };
  const bareStack = `step@${APP_URL}:1:200`;

  it.each<[string, boolean, CrashReport, string | undefined]>([
    ["no details outside dev builds", false, crash, undefined],
    ["the stack once when it starts with the message", true, crash, crash.stack],
    [
      "the message above a stack that leaves it out",
      true,
      { ...crash, stack: bareStack },
      `boom\n${bareStack}`,
    ],
    ["only the message without a stack", true, { ...crash, stack: undefined }, "boom"],
  ])("shows the words and %s", (_, dev, report, details) => {
    expect(crashView(words, dev, report)).toEqual({ ...words, details });
  });
});
