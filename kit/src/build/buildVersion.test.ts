import { describe, expect, it } from "vitest";

import { CI_COMMIT_VARIABLE, shortCommit, UNKNOWN_COMMIT } from "./buildVersion";

const CI_SHA = "16d17c38a1b2c3d4e5f60718293a4b5c6d7e8f90";
const HEAD_SHA = "0123456789abcdef0123456789abcdef01234567";

const head = () => `${HEAD_SHA}\n`;
const noGit = () => {
  throw new Error("not a git repository");
};

describe("shortCommit", () => {
  it.each([
    { ci: CI_SHA, expected: CI_SHA.slice(0, 8), name: "CI's variable", readHead: head },
    { ci: undefined, expected: HEAD_SHA.slice(0, 8), name: "git's HEAD", readHead: head },
    {
      ci: "",
      expected: HEAD_SHA.slice(0, 8),
      name: "git's HEAD for an empty variable",
      readHead: head,
    },
    {
      ci: "not-a-sha",
      expected: HEAD_SHA.slice(0, 8),
      name: "git's HEAD for a bad variable",
      readHead: head,
    },
    { ci: undefined, expected: UNKNOWN_COMMIT, name: "the fallback without git", readHead: noGit },
    {
      ci: undefined,
      expected: UNKNOWN_COMMIT,
      name: "the fallback for bad git output",
      readHead: () => "",
    },
  ])("takes $name", ({ ci, expected, readHead }) => {
    expect(shortCommit(readHead, { [CI_COMMIT_VARIABLE]: ci })).toBe(expected);
  });
});
