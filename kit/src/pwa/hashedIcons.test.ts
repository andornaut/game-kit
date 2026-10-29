import { describe, expect, it } from "vitest";

import { hashedIconUrl, hashIcons } from "./hashedIcons";

// A stand-in hash: the bytes' sum, so each content gets its own name.
const sumHash = (bytes: Uint8Array) => `h${bytes.reduce((sum, byte) => sum + byte, 0)}`;

describe("hashedIconUrl", () => {
  it.each([
    ["/icons/icon-192.png", "/assets/icons/icon-192-h1.png"],
    ["/art/favicon-16.png", "/assets/art/favicon-16-h1.png"],
    ["/icons.d/icon", "/assets/icons.d/icon-h1"],
  ])("names %s %s", (url, hashed) => {
    expect(hashedIconUrl("assets", url, "h1")).toBe(hashed);
  });
});

describe("hashIcons", () => {
  const ICONS = new Map([
    ["/icons/icon-192.png", new Uint8Array([1, 2])],
    ["/art/favicon.png", new Uint8Array([7])],
    ["/icons/unused.png", new Uint8Array([9])],
  ]);
  const TEXTS = new Map([
    ["play/index.html", '<link rel="icon" href="/art/favicon.png" /><a href="/art/favicon.png.x">'],
    ["manifest.webmanifest", '{"icons":[{"src":"/icons/icon-192.png"}],"start_url":"/play/"}'],
  ]);
  const result = hashIcons(sumHash, "assets", ICONS, TEXTS);

  // Every quoted URL in a rewritten text that names an icon file.
  const iconRefs = (text: string) =>
    Array.from(text.matchAll(/"(\/[^"]+\.png)"/g), (match) => match[1] ?? "");

  it.each([...TEXTS.keys()])("%s names only icon files the result holds, by their hash", (name) => {
    const refs = iconRefs(result.texts.get(name) ?? "");
    const wrong = refs.filter((ref) => {
      const bytes = result.files.get(ref);
      return (
        bytes === undefined || !ref.startsWith("/assets/") || !ref.includes(`-${sumHash(bytes)}.`)
      );
    });
    expect({ refs: refs.length > 0, wrong }).toEqual({ refs: true, wrong: [] });
  });

  it("leaves other URLs, and a longer URL starting with an icon's, as they are", () => {
    expect(result.texts.get("play/index.html")).toContain('href="/art/favicon.png.x"');
    expect(result.texts.get("manifest.webmanifest")).toContain('"start_url":"/play/"');
  });

  it("reports an icon no text names", () => {
    expect(result.unreferenced).toEqual(["/icons/unused.png"]);
  });
});
