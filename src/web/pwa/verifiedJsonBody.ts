export interface VerifiedJsonBody {
  readonly sha256: string;
  readonly byteSize: number;
  readonly urls: readonly string[];
  readonly responseProfile?: "fetch-json-data-v1";
}

// Legacy families assert URL-independent JSON and headers. The data profile permits body-only
// aliases for guarded data requests; native response policies remain original for other contexts.
// Full body identity is additional evidence, never an inference from the short URL hashes.
export function validateVerifiedJsonBodies(
  context: {
    readonly urls: readonly string[];
    readonly byteSizes?: Readonly<Record<string, number>>;
  },
  families: readonly VerifiedJsonBody[],
): VerifiedJsonBody[] {
  if (!Array.isArray(families)) {
    throw new TypeError("Verified JSON families must be an array");
  }
  const available = new Set(context.urls);
  const used = new Set<string>();
  const hashes = new Set<string>();
  return families
    .map((family) => {
      if (
        typeof family.sha256 !== "string" ||
        family.sha256.length !== 64 ||
        !/^[a-f0-9]{64}$/.test(family.sha256) ||
        hashes.has(family.sha256) ||
        !Number.isSafeInteger(family.byteSize) ||
        family.byteSize <= 0 ||
        family.urls.length < 2 ||
        (family.responseProfile !== undefined && family.responseProfile !== "fetch-json-data-v1") ||
        (Object.hasOwn(family, "responseProfile") && family.responseProfile === undefined)
      ) {
        throw new RangeError("Invalid verified JSON body family");
      }
      hashes.add(family.sha256);
      const urls = [...family.urls].sort();
      for (const url of urls) {
        if (
          !/^\/(?!\/)[A-Za-z0-9_./-]+\.json$/.test(url) ||
          /\/\.{1,2}(\/|$)/.test(url) ||
          !available.has(url) ||
          used.has(url) ||
          context.byteSizes?.[url] !== family.byteSize
        ) {
          throw new RangeError(`Invalid verified JSON body URL: ${url}`);
        }
        used.add(url);
      }
      return {
        byteSize: family.byteSize,
        ...(family.responseProfile === undefined
          ? {}
          : { responseProfile: family.responseProfile }),
        sha256: family.sha256,
        urls,
      };
    })
    .sort((a, b) => (a.sha256 < b.sha256 ? -1 : a.sha256 > b.sha256 ? 1 : 0));
}

// Separate from every cache scanned by the legacy policy prefix. Never silently fall back.
export function verifiedJsonAliasCachePrefix(context: {
  readonly cacheNamePrefix: string;
}): string {
  const prefix = `!game-kit-json-data-v1:${encodeURIComponent(context.cacheNamePrefix)}:`;
  if (prefix.startsWith(context.cacheNamePrefix)) {
    throw new RangeError("Verified JSON alias cache collides with the legacy cache prefix");
  }
  return prefix;
}
