import { type CachePolicy, isHashedAssetUrl } from "./cachePolicy";

// The service worker's precache: every URL the game needs to boot offline, each sound file by
// format (the worker stores the one format the page plays, named on its URL by
// serviceWorkerUrl), and a version that changes whenever any of their contents change, so a
// deploy installs a new worker.
export interface PrecacheManifest {
  sounds: Record<string, string[]>;
  urls: string[];
  version: string;
}

// The identifier a worker entry declares (declare const GAME_KIT_PRECACHE_MANIFEST:
// PrecacheManifest) and passes to serviceWorker.ts's runServiceWorker; vite/precachePlugin
// replaces it with the manifest's JSON.
export const PRECACHE_MANIFEST_PLACEHOLDER = "GAME_KIT_PRECACHE_MANIFEST";

// The build output, reduced to what the precache walk reads. Vite records the CSS and assets a
// chunk imports under viteMetadata.
export interface BundleFile {
  dynamicImports?: readonly string[];
  imports?: readonly string[];
  type: "asset" | "chunk";
  viteMetadata?: { importedAssets: ReadonlySet<string>; importedCss: ReadonlySet<string> };
}

const ROOT_RELATIVE_ATTRIBUTE = /\s(?:href|src)="(\/[^"/][^"]*)"/g;

// Root-relative src and href values in a built HTML page, in document order without repeats.
// Protocol-relative URLs (//host/...) are another origin and are left out.
export function rootRelativeUrls(html: string): string[] {
  const urls = Array.from(html.matchAll(ROOT_RELATIVE_ATTRIBUTE), (match) => match[1] ?? "");
  return [...new Set(urls)];
}

// Every bundle file the given entry files load, directly or through imports, including the
// entries themselves. File names are relative to the output directory, as in the bundle.
export function bundleDependencies(
  bundle: Readonly<Record<string, BundleFile>>,
  entryFileNames: readonly string[],
): string[] {
  const found = new Set<string>();
  const pending = [...entryFileNames];
  while (pending.length > 0) {
    const fileName = pending.pop() ?? "";
    const file = bundle[fileName];
    if (file === undefined || found.has(fileName)) {
      continue;
    }
    found.add(fileName);
    pending.push(
      ...(file.imports ?? []),
      ...(file.dynamicImports ?? []),
      ...(file.viteMetadata?.importedCss ?? []),
      ...(file.viteMetadata?.importedAssets ?? []),
    );
  }
  return [...found].sort();
}

// The icons a web app manifest names.
export function webManifestIconUrls(manifestJson: unknown): string[] {
  const icons = (manifestJson as { icons?: unknown } | null)?.icons;
  if (!Array.isArray(icons)) {
    return [];
  }
  return icons
    .map((icon: unknown) => (icon as { src?: unknown } | null)?.src)
    .filter((src): src is string => typeof src === "string" && src.startsWith("/"));
}

// The text a version hash is computed over: each URL with its content hash, in URL order.
// Hashed assets need no content hash because their name already changes with their content.
export function precacheFingerprint(
  policy: CachePolicy,
  contentHashes: ReadonlyMap<string, string>,
): string {
  return [...contentHashes.keys()]
    .sort()
    .map((url) => `${url} ${isHashedAssetUrl(policy, url) ? "" : (contentHashes.get(url) ?? "")}`)
    .join("\n");
}
