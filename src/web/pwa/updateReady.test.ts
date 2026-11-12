import { describe, expect, it } from "vitest";

import {
  offerShown,
  type OfferState,
  RESUME_CHECK_MS,
  resumeCheckDue,
  type ResumeState,
} from "./updateReady.ts";

describe("offerShown", () => {
  const SHOWN: OfferState = {
    dismissed: false,
    offerVisible: true,
    reloading: false,
    required: false,
    waiting: true,
  };

  it.each<[string, Partial<OfferState>, boolean]>([
    ["shows a waiting version on the home screen", {}, true],
    ["hides with no version waiting", { waiting: false }, false],
    ["hides away from home", { offerVisible: false }, false],
    ["hides once dismissed", { dismissed: true }, false],
    ["hides while a switch reloads", { reloading: true }, false],
    ["hides while an update is required", { required: true }, false],
  ])("%s", (_, change, shown) => {
    expect(offerShown({ ...SHOWN, ...change })).toBe(shown);
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
