import { describe, expect, it } from "vitest";

import {
  cachedUrlsOf,
  cacheKeyFor,
  cacheNameFor,
  type CachePolicy,
  installPlan,
  installUrls,
  precacheFetchOptions,
  staleCacheNames,
  strategyFor,
} from "./cachePolicy";
import type { PrecacheManifest } from "./precacheList";

const POLICY: CachePolicy = {
  cacheNamePrefix: "game-",
  hashedAssetPrefix: "/assets/",
  revalidatedUrls: ["/manifest.webmanifest", "/nav.js"],
};

const precached = new Set(["/play/", "/nav.js", "/art/sprite.png"]);
const fetchOf = (pathname: string) =>
  strategyFor(POLICY, precached, { isNavigation: false, pathname });
const navigationTo = (pathname: string) =>
  strategyFor(POLICY, precached, { isNavigation: true, pathname });

describe("strategyFor", () => {
  it.each([
    ["the game page", "/play/", "network-first"],
    ["the game page's other path", "/play/index.html", "network-first"],
    ["a page outside the precache, left to the browser", "/", "network-only"],
  ])("navigates to %s by its strategy", (_case, pathname, expected) => {
    expect(navigationTo(pathname)).toBe(expected);
  });

  it.each([
    ["a revalidated URL outside the precache", "/manifest.webmanifest", "network-first"],
    ["a precached revalidated URL", "/nav.js", "network-first"],
    ["hashed build output outside the precache", "/assets/play-abc.js", "cache-first"],
    ["another precached file", "/art/sprite.png", "cache-first"],
    ["a file outside the precache", "/art/notes.json", "network-only"],
    ["the service worker", "/sw.js", "network-only"],
  ])("fetches %s by its strategy", (_case, pathname, expected) => {
    expect(fetchOf(pathname)).toBe(expected);
  });
});

describe("precacheFetchOptions", () => {
  // The HTTP cache answers for hashed build output; the server revalidates the rest.
  it.each([
    ["/assets/play-abc.js", "default"],
    ["/play/", "no-cache"],
    ["/nav.js", "no-cache"],
    ["/art/sprite.png", "no-cache"],
  ])("precaches %s with cache mode %s", (pathname, cache) => {
    expect(precacheFetchOptions(POLICY, pathname)).toEqual({ cache });
  });
});

describe("cacheKeyFor", () => {
  it.each([
    ["/play/index.html", "/play/"],
    ["/play/", "/play/"],
    ["/art/sprite.png", "/art/sprite.png"],
  ])("files %s under %s", (pathname, key) => {
    expect(cacheKeyFor(pathname)).toBe(key);
  });
});

describe("the sound files", () => {
  const manifest: PrecacheManifest = {
    sounds: { m4a: ["/art/a.m4a"], ogg: ["/art/a.ogg"] },
    urls: ["/play/", "/art/sprite.png"],
    version: "v1",
  };

  // The format the page named and no other; no sounds for a missing or unknown format.
  it.each<[string | null, string[]]>([
    ["ogg", ["/art/a.ogg"]],
    ["m4a", ["/art/a.m4a"]],
    [null, []],
    ["mp3", []],
    ["toString", []],
  ])("installs the sounds for format %s", (format, sounds) => {
    expect(installUrls(manifest, format)).toEqual([...manifest.urls, ...sounds]);
  });

  it("serves either format from the cache, storing one the install left out", () => {
    const cached = cachedUrlsOf(manifest);
    const fetched = (pathname: string) =>
      strategyFor(POLICY, cached, { isNavigation: false, pathname });
    expect([fetched("/art/a.ogg"), fetched("/art/a.m4a")]).toEqual(["cache-first", "cache-first"]);
  });
});

describe("staleCacheNames", () => {
  it("names this game's other versions and nothing else", () => {
    const named = (version: string) => cacheNameFor(POLICY, version);
    const names = [named("old"), named("new"), "someone-else", named("older")];
    expect(staleCacheNames(POLICY, named("new"), names)).toEqual([named("old"), named("older")]);
    expect(named("new")).toBe("game-new");
  });
});

describe("installPlan", () => {
  const urls = ["/play/", "/nav.js", "/art/sprite.png", "/assets/play-new.js", "/assets/art-a.png"];

  it.each<[string, string[], string[]]>([
    ["fetches everything on a first install", [], []],
    ["copies hashed files an earlier cache holds", ["/assets/art-a.png"], ["/assets/art-a.png"]],
    [
      "fetches unhashed files fresh even when an earlier cache holds them",
      ["/play/", "/nav.js", "/art/sprite.png", "/assets/art-a.png"],
      ["/assets/art-a.png"],
    ],
    ["fetches a hashed file no earlier cache holds", ["/assets/play-old.js"], []],
  ])("%s", (_case, previous, copy) => {
    expect(installPlan(POLICY, new Set(previous), urls)).toEqual({
      copy,
      fetch: urls.filter((url) => !copy.includes(url)),
    });
  });
});
