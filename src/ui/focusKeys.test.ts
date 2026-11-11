import { describe, expect, it } from "vitest";

import { focusKeyAction, stepFocus } from "./focusKeys.ts";

describe("focusKeyAction", () => {
  it.each([
    { action: "next", key: "Tab", repeat: false, shift: false },
    { action: "previous", key: "Tab", repeat: false, shift: true },
    { action: "next", key: "ArrowDown", repeat: true, shift: false },
    { action: "next", key: "ArrowRight", repeat: false, shift: false },
    { action: "previous", key: "ArrowUp", repeat: true, shift: false },
    { action: "previous", key: "ArrowLeft", repeat: false, shift: false },
    { action: "press", key: "Enter", repeat: false, shift: false },
    { action: "press", key: " ", repeat: false, shift: false },
    { action: undefined, key: "Enter", repeat: true, shift: false },
    { action: "close", key: "Escape", repeat: false, shift: false },
    { action: "close", key: "p", repeat: false, shift: false },
    { action: "close", key: "P", repeat: false, shift: true },
    { action: undefined, key: "Escape", repeat: true, shift: false },
    { action: undefined, key: "a", repeat: false, shift: false },
  ])("$key, shift $shift, repeat $repeat: $action", ({ action, key, repeat, shift }) => {
    expect(focusKeyAction(key, shift, repeat)).toBe(action);
  });
});

describe("stepFocus", () => {
  const targets = ["a", "b", "c"];
  it.each([
    { focus: undefined, step: "next", to: "a" },
    { focus: undefined, step: "previous", to: "c" },
    { focus: "a", step: "next", to: "b" },
    { focus: "c", step: "next", to: "a" },
    { focus: "a", step: "previous", to: "c" },
    { focus: "gone", step: "next", to: "a" },
  ] as const)("from $focus, $step: $to", ({ focus, step, to }) => {
    expect(stepFocus<string>(targets, focus, step)).toBe(to);
  });

  it("finds nothing among no targets", () => {
    expect(stepFocus<string>([], undefined, "next")).toBeUndefined();
  });
});
