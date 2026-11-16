import { expect, it } from "vitest";

import { validateVerifiedJsonBodies } from "./verifiedJsonBody.ts";

const family = { byteSize: 12, sha256: "a".repeat(64), urls: ["/b.json", "/a.json"] };
const context = { byteSizes: { "/a.json": 12, "/b.json": 12 }, urls: family.urls };

it("canonicalizes explicit full-hash families without mutating caller selection", () => {
  expect(validateVerifiedJsonBodies(context, [family])[0]?.urls).toEqual(["/a.json", "/b.json"]);
  expect(family.urls).toEqual(["/b.json", "/a.json"]);
});

it("rejects short/newline hashes, overlaps, unknown URLs and conflicting sizes", () => {
  for (const sha256 of ["a".repeat(8), `${"a".repeat(64)}\n`]) {
    expect(() => validateVerifiedJsonBodies(context, [{ ...family, sha256 }])).toThrow();
  }
  expect(() =>
    validateVerifiedJsonBodies(context, [family, { ...family, sha256: "b".repeat(64) }]),
  ).toThrow();
  expect(() =>
    validateVerifiedJsonBodies(context, [{ ...family, urls: ["/a.json", "/unknown.json"] }]),
  ).toThrow();
  expect(() => validateVerifiedJsonBodies(context, [{ ...family, byteSize: 13 }])).toThrow();
  expect(() =>
    validateVerifiedJsonBodies(context, [{ ...family, urls: ["/a.json", "/a.json"] }]),
  ).toThrow();
});

it("limits eligibility to normalized root-relative JSON paths", () => {
  for (const url of [
    "https://other.test/b.json",
    "//other.test/b.json",
    "/a/../b.json",
    "/b.json?x",
    "/b.js",
  ]) {
    expect(() =>
      validateVerifiedJsonBodies(
        { byteSizes: { "/a.json": 12, [url]: 12 }, urls: ["/a.json", url] },
        [{ ...family, urls: ["/a.json", url] }],
      ),
    ).toThrow();
  }
});
