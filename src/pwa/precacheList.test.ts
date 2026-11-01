import { describe, expect, it } from "vitest";

import type { CachePolicy } from "./cachePolicy";
import {
  bundleDependencies,
  type BundleFile,
  precacheFingerprint,
  rootRelativeUrls,
  webManifestIconUrls,
} from "./precacheList";

describe("rootRelativeUrls", () => {
  it("reads each case", () => {
    for (const { expected, html } of [
      {
        expected: [
          "/art/favicon.png",
          "/manifest.webmanifest",
          "/nav.js",
          "/assets/play-abc.js",
          "/assets/play-abc.css",
        ],
        html: `
      <link rel="icon" href="/art/favicon.png" />
      <link rel="manifest" href="/manifest.webmanifest" />
      <script src="/nav.js" defer></script>
      <script type="module" crossorigin src="/assets/play-abc.js"></script>
      <link rel="stylesheet" crossorigin href="/assets/play-abc.css">
      <script src="/nav.js"></script>`,
        name: "lists src and href values that start at the site root, once each",
      },
      {
        expected: [],
        html: `<a href="/"></a><link href="https://fonts.example/a.css">
      <script src="//cdn.example/x.js"></script><img src="local.png">`,
        name: "leaves out other origins, relative paths and the bare root",
      },
    ]) {
      expect(rootRelativeUrls(html)).toEqual(expected);
    }
  });
});

describe("bundleDependencies", () => {
  const css = (...names: string[]) => ({
    importedAssets: new Set<string>(),
    importedCss: new Set(names),
  });
  const bundle: Record<string, BundleFile> = {
    "assets/data.js": { imports: ["assets/shared.js"], type: "chunk" },
    "assets/lazy.js": { type: "chunk" },
    "assets/play.css": { type: "asset" },
    "assets/play.js": {
      dynamicImports: ["assets/lazy.js"],
      imports: ["assets/shared.js"],
      type: "chunk",
      viteMetadata: css("assets/play.css"),
    },
    "assets/shared.js": { imports: ["assets/play.js"], type: "chunk" },
  };

  it("reads each case", () => {
    for (const { entry, expected } of [
      {
        entry: "assets/play.js",
        expected: ["assets/lazy.js", "assets/play.css", "assets/play.js", "assets/shared.js"],
        name: "follows imports, dynamic imports and CSS through cycles, not another entry's files",
      },
      { entry: "assets/missing.js", expected: [], name: "skips names that are not in the bundle" },
    ]) {
      expect(bundleDependencies(bundle, [entry])).toEqual(expected);
    }
  });
});

describe("webManifestIconUrls", () => {
  it("lists each case's URLs", () => {
    for (const { expected, manifest } of [
      {
        expected: ["/icons/a.png"],
        manifest: { icons: [{ src: "/icons/a.png" }, { src: "https://x.example/b.png" }, {}] },
        name: "root-relative icon sources",
      },
      { expected: [], manifest: {}, name: "nothing without an icons list" },
      { expected: [], manifest: null, name: "nothing for a null manifest" },
    ] satisfies readonly { expected: string[]; manifest: unknown; name: string }[]) {
      expect(webManifestIconUrls(manifest)).toEqual(expected);
    }
  });
});

describe("precacheFingerprint", () => {
  const policy: CachePolicy = {
    cacheNamePrefix: "game-",
    hashedAssetPrefix: "/assets/",
    revalidatedUrls: [],
  };
  const fingerprint = (contentHashes: ReadonlyMap<string, string>) =>
    precacheFingerprint(policy, contentHashes);

  it("is independent of insertion order", () => {
    const first = new Map([
      ["/play/", "aa"],
      ["/nav.js", "bb"],
    ]);
    const second = new Map([
      ["/nav.js", "bb"],
      ["/play/", "aa"],
    ]);
    expect(fingerprint(first)).toBe(fingerprint(second));
  });

  it("changes when an unhashed file's content changes", () => {
    const before = fingerprint(new Map([["/art/sprite.png", "aa"]]));
    expect(fingerprint(new Map([["/art/sprite.png", "bb"]]))).not.toBe(before);
  });

  it("follows a hashed asset by its name alone", () => {
    const before = fingerprint(new Map([["/assets/play-abc.js", "aa"]]));
    expect(fingerprint(new Map([["/assets/play-abc.js", "bb"]]))).toBe(before);
    expect(fingerprint(new Map([["/assets/play-def.js", "aa"]]))).not.toBe(before);
  });
});
