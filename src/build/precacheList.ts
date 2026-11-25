import {
  type CachePolicy,
  isHashedAssetUrl,
  validateVerifiedJsonBodies,
  verifiedJsonAliasCachePrefix,
  type VerifiedJsonBody,
} from "../web/pwa/index.ts";

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
export function precacheFingerprint(
  policy: CachePolicy,
  contentHashes: ReadonlyMap<string, string>,
  byteSizes?: ReadonlyMap<string, number>,
  verifiedJsonBodies?: readonly VerifiedJsonBody[],
): string {
  if (byteSizes !== undefined && byteSizes.size !== contentHashes.size) {
    throw new RangeError("Precache byte sizes must cover exactly the listed URLs");
  }
  const urls = [...contentHashes.keys()].sort();
  const files = urls
    .map((url) => {
      const hash = isHashedAssetUrl(policy, url) ? "" : (contentHashes.get(url) ?? "");
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
  if (verifiedJsonBodies?.some((family) => family.responseProfile !== undefined)) {
    verifiedJsonAliasCachePrefix(policy);
  }
  return verifiedJsonBodies === undefined
    ? files
    : `${files}\n${JSON.stringify({
        verifiedJsonBodies: validateVerifiedJsonBodies(
          {
            urls,
            ...(byteSizes === undefined ? {} : { byteSizes: Object.fromEntries(byteSizes) }),
          },
          verifiedJsonBodies,
        ),
      })}`;
}
