import { describe, expect, it } from "vitest";

import { hashedIconUrl, hashIcons } from "./hashedIcons.ts";

describe("hashedIconUrl", () => {
  it.each([
    ["/icons/icon-192.png", "/assets/icons/icon-192-Ab12Cd34.png"],
    ["/favicon.ico", "/assets/favicon-Ab12Cd34.ico"],
    ["/icons.v2/apple", "/assets/icons.v2/apple-Ab12Cd34"],
    ["/icons/icon.min.svg", "/assets/icons/icon.min-Ab12Cd34.svg"],
  ])("names %s %s", (url, hashed) => {
    expect(hashedIconUrl("assets", url, "Ab12Cd34")).toBe(hashed);
  });
});

describe("hashIcons", () => {
  // A hash naming the bytes' first value, so each icon's name shows which bytes it hashed.
  const hash = (bytes: Uint8Array) => `h${bytes[0] ?? ""}`;
  const icons = new Map([
    ["/icons/a.png", new Uint8Array([1])],
    ["/icons/b.png", new Uint8Array([2])],
  ]);

  it.each<[string, Record<string, string>, Record<string, string>, string[]]>([
    [
      "rewrites quoted URLs in pages and the manifest",
      { "index.html": '<link href="/icons/a.png">', manifest: '{"src":"/icons/b.png"}' },
      { "index.html": '<link href="/a/icons/a-h1.png">', manifest: '{"src":"/a/icons/b-h2.png"}' },
      [],
    ],
    [
      "leaves unquoted and longer URLs alone",
      { "index.html": '/icons/a.png "/icons/a.png.bak" "/icons/b.png"' },
      { "index.html": '/icons/a.png "/icons/a.png.bak" "/a/icons/b-h2.png"' },
      ["/icons/a.png"],
    ],
    [
      "reports icons no text names",
      { "index.html": "" },
      { "index.html": "" },
      ["/icons/a.png", "/icons/b.png"],
    ],
  ])("%s", (_, texts, rewritten, unreferenced) => {
    const hashed = hashIcons(hash, "a", icons, new Map(Object.entries(texts)));
    expect({
      files: [...hashed.files].map(([url, bytes]) => [url, [...bytes]]),
      texts: Object.fromEntries(hashed.texts),
      unreferenced: hashed.unreferenced,
    }).toEqual({
      files: [
        ["/a/icons/a-h1.png", [1]],
        ["/a/icons/b-h2.png", [2]],
      ],
      texts: rewritten,
      unreferenced,
    });
  });
});
