import { describe, expect, it } from "vitest";

import {
  RESUME_CHECK_MS,
  resumeCheckDue,
  type ResumeState,
  type UpdateAction,
  updateAction,
  type UpdateState,
} from "./updateReady.ts";

const FRESH: UpdateState = {
  interacted: false,
  newer: "none",
  offerVisible: false,
  online: true,
  reloading: false,
  waitOver: false,
};

describe("updateAction", () => {
  it.each<[string, Partial<UpdateState>, UpdateAction]>([
    ["runs with no newer version", {}, "run"],
    ["waits for a pending version", { newer: "pending" }, "wait"],
    ["runs offline with a pending version", { newer: "pending", online: false }, "run"],
    ["runs after input with a pending version", { interacted: true, newer: "pending" }, "run"],
    ["runs after the wait with a pending version", { newer: "pending", waitOver: true }, "run"],
    ["switches to a waiting version before input", { newer: "waiting" }, "switch"],
    ["runs away from home after input", { interacted: true, newer: "waiting" }, "run"],
    [
      "prompts on home after input",
      { interacted: true, newer: "waiting", offerVisible: true },
      "prompt",
    ],
    [
      "prompts on home under manual activation",
      { activationPolicy: "manual", newer: "waiting", offerVisible: true },
      "prompt",
    ],
    ["runs away from home when manual", { activationPolicy: "manual", newer: "waiting" }, "run"],
    ["waits while reloading", { newer: "waiting", reloading: true }, "wait"],
    ["runs a reload that outlasted the wait", { reloading: true, waitOver: true }, "run"],
  ])("%s", (_, change, action) => {
    expect(updateAction({ ...FRESH, ...change })).toBe(action);
  });
});

describe("resumeCheckDue", () => {
  const DUE: ResumeState = {
    lastCheck: 0,
    now: RESUME_CHECK_MS,
    offerVisible: true,
    online: true,
    visible: true,
  };

  it.each<[string, Partial<ResumeState>, boolean]>([
    ["a minute after the last check", {}, true],
    ["with no check yet", { lastCheck: undefined, now: 0 }, true],
    ["within a minute of the last check", { now: RESUME_CHECK_MS - 1 }, false],
    ["hidden", { visible: false }, false],
    ["away from home", { offerVisible: false }, false],
    ["offline", { online: false }, false],
  ])("checks %s: %s", (_, change, due) => {
    expect(resumeCheckDue({ ...DUE, ...change })).toBe(due);
  });
});
