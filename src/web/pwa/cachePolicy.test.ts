import { describe, expect, it } from "vitest";

import { cacheKeyFor, type CachePolicy, isHashedAssetUrl } from "./cachePolicy.ts";

const POLICY: CachePolicy = {
  cacheNamePrefix: "game-",
  hashedAssetPrefix: "/assets/",
};

describe("isHashedAssetUrl", () => {
  it.each([
    ["/assets/play-abc.js", true],
    ["/play/", false],
    ["/art/assets/a.png", false],
  ])("classifies %s as hashed: %s", (url, hashed) => {
    expect(isHashedAssetUrl(POLICY, url)).toBe(hashed);
  });
});

describe("cacheKeyFor", () => {
  it.each([
    ["/play/index.html", "/play/"],
    ["/play/", "/play/"],
  ])("files %s under %s", (pathname, key) => {
    expect(cacheKeyFor(pathname)).toBe(key);
  });
});
