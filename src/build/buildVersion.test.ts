import { describe, expect, it } from "vitest";

import { buildMetadata, CI_COMMIT_VARIABLE, shortCommit, UNKNOWN_COMMIT } from "./buildVersion.ts";

const CI_SHA = "16d17c38a1b2c3d4e5f60718293a4b5c6d7e8f90";
const HEAD_SHA = "0123456789abcdef0123456789abcdef01234567";

const head = () => `${HEAD_SHA}\n`;
const noGit = () => {
  throw new Error("not a git repository");
};

describe("shortCommit", () => {
  it.each([
    { ci: CI_SHA, expected: CI_SHA.slice(0, 8), name: "CI's variable", readHead: head },
    {
      ci: ` ${CI_SHA.toUpperCase()}\n`,
      expected: CI_SHA.slice(0, 8),
      name: "CI's variable, trimmed and lower-cased",
      readHead: noGit,
    },
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

describe("buildMetadata", () => {
  it("shares one immutable full clean identity while retaining the short label", () => {
    let reads = 0;
    const metadata = buildMetadata(() => {
      reads++;
      return { dirty: false, head: `${HEAD_SHA}\n` };
    }, {});
    expect(metadata).toEqual({ buildId: HEAD_SHA, commit: HEAD_SHA.slice(0, 8) });
    expect(reads).toBe(1);
    expect(Object.isFrozen(metadata)).toBe(true);
    expect(
      buildMetadata(() => ({ dirty: false, head: CI_SHA }), {
        [CI_COMMIT_VARIABLE]: ` ${CI_SHA.toUpperCase()}\n`,
      }),
    ).toEqual({ buildId: CI_SHA, commit: CI_SHA.slice(0, 8) });
  });

  it("keeps legacy labels but withholds grouped identity for dirty, mismatched or absent source", () => {
    expect(buildMetadata(() => ({ dirty: true, head: HEAD_SHA }), {})).toEqual({
      buildId: undefined,
      commit: HEAD_SHA.slice(0, 8),
    });
    expect(
      buildMetadata(() => ({ dirty: false, head: HEAD_SHA }), { [CI_COMMIT_VARIABLE]: CI_SHA }),
    ).toEqual({ buildId: undefined, commit: CI_SHA.slice(0, 8) });
    expect(
      buildMetadata(
        () => {
          throw new Error("no Git");
        },
        { [CI_COMMIT_VARIABLE]: CI_SHA },
      ),
    ).toEqual({ buildId: undefined, commit: CI_SHA.slice(0, 8) });
    expect(buildMetadata(() => ({ dirty: false, head: "dev" }), {})).toEqual({
      buildId: undefined,
      commit: UNKNOWN_COMMIT,
    });
  });
});
