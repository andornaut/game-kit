// Content-hashed names for a game's icons (the web app manifest's, the pages' favicons and
// apple-touch-icon), so a redrawn icon gets a new URL and reaches an installed app, whose worker
// serves its precached icons cache-first. The game keeps each source at its plain URL; the build
// (vite/hashedIconsPlugin) writes it again under its hashed name and points the pages and the
// manifest there.

// An icon's hashed URL: hash before its extension, e.g. /icons/icon-192.png with hash Ab12Cd34
// is /icons/icon-192.Ab12Cd34.png.
export function hashedIconUrl(url: string, hash: string): string {
  const dot = url.lastIndexOf(".");
  const slash = url.lastIndexOf("/");
  return dot > slash ? `${url.slice(0, dot)}.${hash}${url.slice(dot)}` : `${url}.${hash}`;
}

export interface HashedIcons {
  // Each icon's file under its hashed URL.
  readonly files: ReadonlyMap<string, Uint8Array>;
  // The icons no text names, which a game lists by mistake.
  readonly unreferenced: readonly string[];
  // Each text with every quoted icon URL replaced by its hashed URL.
  readonly texts: ReadonlyMap<string, string>;
}

// Hashes each icon (its plain URL and bytes) with hash, and rewrites every double-quoted
// occurrence of its plain URL in texts (HTML attributes and the manifest's JSON alike) to its
// hashed URL. Texts are keyed by any name, such as their file name.
export function hashIcons(
  hash: (bytes: Uint8Array) => string,
  icons: ReadonlyMap<string, Uint8Array>,
  texts: ReadonlyMap<string, string>,
): HashedIcons {
  const renamed = new Map([...icons].map(([url, bytes]) => [url, hashedIconUrl(url, hash(bytes))]));
  const rewritten = new Map(
    [...texts].map(([name, text]) => [
      name,
      [...renamed].reduce((out, [url, hashed]) => out.replaceAll(`"${url}"`, `"${hashed}"`), text),
    ]),
  );
  return {
    files: new Map([...icons].map(([url, bytes]) => [renamed.get(url) ?? url, bytes])),
    texts: rewritten,
    unreferenced: [...icons.keys()].filter(
      (url) => ![...texts.values()].some((text) => text.includes(`"${url}"`)),
    ),
  };
}
