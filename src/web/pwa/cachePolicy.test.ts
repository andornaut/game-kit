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
} from "./cachePolicy.ts";
import type { PrecacheManifest } from "./precacheList.ts";

const POLICY: CachePolicy = {
  cacheNamePrefix: "game-",
  hashedAssetPrefix: "/assets/",
};

const cached = cachedUrlsOf({
  sounds: { m4a: ["/art/a.m4a"], ogg: ["/art/a.ogg"] },
  urls: ["/play/", "/art/manifest.json", "/assets/play-abc.js"],
  version: "v1",
});

describe("strategyFor", () => {
  it.each([
    ["a navigation to the precached page", true, "/play/", "network-first"],
    ["a navigation to the page's other path", true, "/play/index.html", "network-first"],
    ["a navigation outside the precache, left to the browser", true, "/", "network-only"],
    ["precached hashed build output", false, "/assets/play-abc.js", "cache-first"],
    ["hashed build output outside the precache", false, "/assets/play-def.js", "cache-first"],
    ["a sound file in the format the install stored", false, "/art/a.ogg", "cache-first"],
    ["a sound file in another format", false, "/art/a.m4a", "cache-first"],
    ["a precached unhashed file", false, "/art/manifest.json", "network-first"],
    ["a file outside the precache", false, "/art/notes.json", "network-only"],
    ["the service worker", false, "/sw.js", "network-only"],
  ])("fetches %s by its strategy", (_case, isNavigation, pathname, expected) => {
    expect(strategyFor(POLICY, cached, { isNavigation, pathname })).toBe(expected);
  });
});

describe("precacheFetchOptions", () => {
  // The HTTP cache answers for hashed build output; the server revalidates the rest.
  it.each([
    ["/assets/play-abc.js", "default"],
    ["/play/", "no-cache"],
    ["/art/manifest.json", "no-cache"],
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
