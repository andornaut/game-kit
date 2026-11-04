import { describe, expect, it } from "vitest";

import type { CachePolicy } from "./cachePolicy.ts";
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
});
