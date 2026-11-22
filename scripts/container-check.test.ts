import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { expect, it } from "vitest";

import { containerCheck, isNpmCacheMiss, NPM_CACHE_MISS } from "./container-check.ts";

const miss = [
  "npm error request to https://example.invalid/pkg failed:",
  "cache mode is 'only-if-cached' but no cached response is available.",
].join(" ");

it("classifies only an npm cache-miss code or the precise offline response diagnostic", () => {
  expect(isNpmCacheMiss("npm ERR! code ENOTCACHED\n")).toBe(true);
  expect(isNpmCacheMiss(miss)).toBe(true);
  expect(isNpmCacheMiss(`npm error code EUSAGE\n${miss}`)).toBe(false);
  expect(isNpmCacheMiss("npm error code EINTEGRITY\n")).toBe(false);
  expect(isNpmCacheMiss("npm error the lockfile mentions ENOTCACHED\n")).toBe(false);
});

it.each([
  ["npm error code ENOTCACHED", true],
  ["npm error code EUSAGE", false],
] as const)(
  "preserves the npm failure and marks only confirmed cache misses: %s",
  (diagnostic, marked) => {
    const evidence = mkdtempSync(join(tmpdir(), "release-npm-offline-"));
    writeFileSync(join(evidence, "npm"), '#!/bin/sh\nprintf "%s\\n" "$DIAGNOSTIC" >&2\nexit 7\n', {
      mode: 0o755,
    });
    const env = {
      ...process.env,
      DIAGNOSTIC: diagnostic,
      PATH: `${evidence}${delimiter}${process.env.PATH}`,
    };
    expect(() => containerCheck(env, ["install-offline", evidence])).toThrow(
      expect.objectContaining({ status: 7 }),
    );
    expect(readFileSync(join(evidence, "npm-ci-offline.log"), "utf8")).toContain(diagnostic);
    expect(existsSync(join(evidence, NPM_CACHE_MISS))).toBe(marked);
  },
);
