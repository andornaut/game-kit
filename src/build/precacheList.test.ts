import { describe, expect, it } from "vitest";

import type { CachePolicy } from "../web/pwa/cachePolicy.ts";
import {
  bundleDependencies,
  type BundleFile,
  precacheFingerprint,
  rootRelativeUrls,
  webManifestIconUrls,
} from "./precacheList.ts";

describe("rootRelativeUrls", () => {
  it.each<[string, string, string[]]>([
    [
      "src and href in order",
      '<script src="/a.js"></script><link href="/b.css">',
      ["/a.js", "/b.css"],
    ],
    ["each URL once", '<img src="/a.png"><img src="/a.png">', ["/a.png"]],
    [
      "no relative or absolute URLs",
      '<a href="page.html"></a><img src="https://x.test/a.png">',
      [],
    ],
    ["no protocol-relative URLs", '<script src="//cdn.test/a.js"></script>', []],
    ["no other attributes", '<div data-src="/a.png"></div>', []],
    ["the site root", '<a href="/">', []],
  ])("finds %s", (_, html, urls) => {
    expect(rootRelativeUrls(html)).toEqual(urls);
  });
});

describe("bundleDependencies", () => {
  const bundle: Record<string, BundleFile> = {
    "assets/art.png": { type: "asset" },
    "assets/lazy.js": { imports: ["assets/shared.js"], type: "chunk" },
    "assets/main.css": { type: "asset" },
    "assets/main.js": {
      dynamicImports: ["assets/lazy.js"],
      imports: ["assets/shared.js"],
      type: "chunk",
      viteMetadata: {
        importedAssets: new Set(["assets/art.png"]),
        importedCss: new Set(["assets/main.css"]),
      },
    },
    "assets/other.js": { type: "chunk" },
    "assets/shared.js": { imports: ["assets/main.js"], type: "chunk" },
  };

  it.each<[string, string[], string[]]>([
    [
      "follows imports, dynamic imports, CSS and assets through a cycle",
      ["assets/main.js"],
      ["assets/art.png", "assets/lazy.js", "assets/main.css", "assets/main.js", "assets/shared.js"],
    ],
    ["includes a lone entry", ["assets/other.js"], ["assets/other.js"]],
    ["skips names outside the bundle", ["missing.js"], []],
  ])("%s", (_, entries, files) => {
    expect(bundleDependencies(bundle, entries)).toEqual(files);
  });
});

describe("webManifestIconUrls", () => {
  it.each<[string, unknown, string[]]>([
    [
      "root-relative icon sources",
      { icons: [{ src: "/a.png" }, { src: "/b.png" }] },
      ["/a.png", "/b.png"],
    ],
    ["no relative or malformed sources", { icons: [{ src: "a.png" }, { src: 1 }, null, {}] }, []],
    ["no icons", {}, []],
    ["icons that are no list", { icons: "/a.png" }, []],
    ["no manifest", null, []],
  ])("reads %s", (_, manifest, urls) => {
    expect(webManifestIconUrls(manifest)).toEqual(urls);
  });
});

describe("precacheFingerprint", () => {
  const policy: CachePolicy = {
    cacheNamePrefix: "game-",
    hashedAssetPrefix: "/assets/",
  };

  it.each<[string, [string, string][], string]>([
    [
      "sorts by URL",
      [
        ["/b", "2"],
        ["/a", "1"],
      ],
      "/a 1\n/b 2",
    ],
    [
      "leaves hashed assets' content out",
      [
        ["/assets/x-1.js", "9"],
        ["/play/", "3"],
      ],
      "/assets/x-1.js \n/play/ 3",
    ],
    ["is empty for no files", [], ""],
  ])("%s", (_, hashes, text) => {
    expect(precacheFingerprint(policy, new Map(hashes))).toBe(text);
  });

  it("includes exact byte sizes deterministically, including zero and hashed assets", () => {
    const hashes = new Map([
      ["/play/", "page"],
      ["/assets/a.js", "ignored"],
    ]);
    const sizes = new Map([
      ["/play/", 23],
      ["/assets/a.js", 0],
    ]);
    const fingerprint = precacheFingerprint(policy, hashes, sizes);
    expect(fingerprint).toBe("/assets/a.js  0\n/play/ page 23");
    expect(
      precacheFingerprint(policy, new Map([...hashes].reverse()), new Map([...sizes].reverse())),
    ).toBe(fingerprint);
    expect(precacheFingerprint(policy, hashes, new Map(sizes).set("/assets/a.js", 1))).not.toBe(
      fingerprint,
    );
    expect(precacheFingerprint(policy, hashes, new Map(sizes).set("/play/", 24))).not.toBe(
      fingerprint,
    );
  });

  it("rejects missing, extra or invalid byte sizes instead of fingerprinting unknown work", () => {
    const hashes = new Map([["/a", "hash"]]);
    for (const sizes of [
      new Map<string, number>(),
      new Map([
        ["/a", 1],
        ["/extra", 2],
      ]),
      new Map([["/other", 1]]),
    ]) {
      expect(() => precacheFingerprint(policy, hashes, sizes)).toThrow(RangeError);
    }
    for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => precacheFingerprint(policy, hashes, new Map([["/a", value]]))).toThrow(
        RangeError,
      );
    }
    expect(precacheFingerprint(policy, hashes, new Map([["/a", Number.MAX_SAFE_INTEGER]]))).toBe(
      `/a hash ${Number.MAX_SAFE_INTEGER}`,
    );
  });
});

it("fingerprints canonical full-body reuse metadata without changing the absent legacy form", () => {
  const policy = { cacheNamePrefix: "game-", hashedAssetPrefix: "/assets/" };
  const hashes = new Map([
    ["/a.json", "short"],
    ["/b.json", "short"],
  ]);
  const sizes = new Map([
    ["/a.json", 12],
    ["/b.json", 12],
  ]);
  const family = { byteSize: 12, sha256: "a".repeat(64), urls: ["/b.json", "/a.json"] };
  const old = precacheFingerprint(policy, hashes, sizes);
  expect(precacheFingerprint(policy, hashes, sizes, undefined)).toBe(old);
  const enabled = precacheFingerprint(policy, hashes, sizes, [family]);
  expect(enabled).not.toBe(old);
  expect(
    precacheFingerprint(policy, hashes, sizes, [{ ...family, urls: [...family.urls].reverse() }]),
  ).toBe(enabled);
  expect(
    precacheFingerprint(policy, hashes, sizes, [{ ...family, sha256: "b".repeat(64) }]),
  ).not.toBe(enabled);
});

it("fingerprints the explicit response profile while leaving legacy metadata unchanged", () => {
  const policy = { cacheNamePrefix: "fixture-", hashedAssetPrefix: "/assets/" };
  const urls = ["/a.json", "/b.json"];
  const hashes = new Map(urls.map((url) => [url, "AAAAAAAA"]));
  const sizes = new Map(urls.map((url) => [url, 2]));
  const family = { byteSize: 2, sha256: "0".repeat(64), urls };
  const legacy = precacheFingerprint(policy, hashes, sizes, [family]);
  const profile = { ...family, responseProfile: "fetch-json-data-v1" as const };
  expect(precacheFingerprint(policy, hashes, sizes, [profile])).not.toBe(legacy);
  expect(precacheFingerprint(policy, hashes, sizes, [family])).toBe(legacy);
  expect(() =>
    precacheFingerprint({ ...policy, cacheNamePrefix: "" }, hashes, sizes, [profile]),
  ).toThrow("collides");
});
