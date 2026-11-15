import { isBuildId } from "../build/buildVersion.ts";
import { type CachePolicy, isHashedAssetUrl } from "./cachePolicy.ts";
import { type PrecacheGroups, validatePrecacheGroups } from "./precacheGroups.ts";

// The service worker's precache: every URL the game needs to boot offline, each sound file by
// format (the worker stores the one format the page plays, named on its URL by
// serviceWorkerUrl), and a version that changes whenever any of their contents change, so a
// deploy installs a new worker. contentHashes maps each listed URL, sounds included, that is not
// hashed build output (cachePolicy's isHashedAssetUrl) to its content's web/build/vite/contentHash,
// for an install to reuse an earlier version's unchanged copy (cachePolicy's installPlan).
export interface PrecacheManifest {
  buildId?: string;
  // Exact built byte lengths for every normalized listed URL, all sound alternatives included.
  // Absent on older manifests; totals depend on the caller's selected sound format.
  byteSizes?: Record<string, number>;
  contentHashes: Record<string, string>;
  groups?: PrecacheGroups;
  sounds: Record<string, string[]>;
  urls: string[];
  version: string;
}

// The identifier a worker entry declares (declare const GAME_KIT_PRECACHE_MANIFEST:
// PrecacheManifest) and passes to dom/serviceWorker's runServiceWorker; vite/precachePlugin
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
// Legacy hashed assets need no content hash because their name changes with their content.
// Optional byte sizes must cover exactly those URLs and become part of the version fingerprint.
// Grouped builds include every hash, canonical partition and full source identity.
export function precacheFingerprint(
  policy: CachePolicy,
  contentHashes: ReadonlyMap<string, string>,
  byteSizes?: ReadonlyMap<string, number>,
  grouped?: { readonly buildId: string; readonly groups: PrecacheGroups },
): string {
  if (byteSizes !== undefined && byteSizes.size !== contentHashes.size) {
    throw new RangeError("Precache byte sizes must cover exactly the listed URLs");
  }
  const urls = [...contentHashes.keys()].sort();
  let metadata: { readonly buildId: string; readonly groups: PrecacheGroups } | undefined;
  if (grouped !== undefined) {
    if (!isBuildId(grouped.buildId)) {
      throw new RangeError("Grouped precache requires a full 40-character source build ID");
    }
    metadata = { buildId: grouped.buildId, groups: validatePrecacheGroups(urls, grouped.groups) };
    if (urls.some((url) => !contentHashes.get(url))) {
      throw new RangeError("Grouped precache requires a content hash for every URL");
    }
  }
  const files = urls
    .map((url) => {
      const hash =
        metadata === undefined && isHashedAssetUrl(policy, url)
          ? ""
          : (contentHashes.get(url) ?? "");
      const entry = `${url} ${hash}`;
      if (byteSizes === undefined) {
        return entry;
      }
      const size = byteSizes.get(url);
      if (size === undefined || !Number.isSafeInteger(size) || size < 0) {
        throw new RangeError(`Precache byte size for ${url} must be a nonnegative safe integer`);
      }
      return `${entry} ${size}`;
    })
    .join("\n");
  return metadata === undefined ? files : `${files}\n${JSON.stringify(metadata)}`;
}
