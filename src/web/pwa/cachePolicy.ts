import type { PrecacheManifest } from "./precacheList.ts";

// How the service worker answers a same-origin GET.
// cache-first: the precached page and every other precached file, content-hashed build output and
// the files of every sound format. The active version's cache answers, so a controlled page runs
// the version on disk; a file the cache lacks (one the install did not store, or storage evicted)
// is fetched and stored.
// network-only: anything else, left to the browser.
export type FetchStrategy = "cache-first" | "network-only";

// A game's caching rules, which the service worker and the precache build share.
export interface CachePolicy {
  // The start of every cache name the worker makes; an activated worker deletes the others that
  // start with it.
  readonly cacheNamePrefix: string;
  // The path every content-hashed build file starts with, e.g. "/assets/".
  readonly hashedAssetPrefix: string;
}

// Content-hashed build output, safe to serve from cache for as long as it is referenced.
export function isHashedAssetUrl(policy: CachePolicy, url: string): boolean {
  return url.startsWith(policy.hashedAssetPrefix);
}

// How the service worker fetches a URL to precache it. Hashed build output never changes under
// its name, so the HTTP cache may answer with the copy the page just loaded. Every other URL can,
// so no-cache has the server confirm the HTTP cache's copy, or send the new one, before it is
// stored.
export interface PrecacheFetchOptions {
  readonly cache: "default" | "no-cache";
}

export function precacheFetchOptions(policy: CachePolicy, url: string): PrecacheFetchOptions {
  return { cache: isHashedAssetUrl(policy, url) ? "default" : "no-cache" };
}

export function cacheNameFor(policy: CachePolicy, version: string): string {
  return `${policy.cacheNamePrefix}${version}`;
}

// Caches an earlier service worker left, to delete once this one activates.
export function staleCacheNames(
  policy: CachePolicy,
  currentCacheName: string,
  cacheNames: readonly string[],
): string[] {
  return cacheNames.filter(
    (name) => name.startsWith(policy.cacheNamePrefix) && name !== currentCacheName,
  );
}

// The cache key for a path. Cloudflare and Vite serve /dir/index.html at /dir/, so both share
// one entry.
export function cacheKeyFor(pathname: string): string {
  return pathname.replace(/\/index\.html$/, "/");
}

// The URLs the service worker stores on install: the precache list and the sound files in the
// format the page named. An unknown or missing format stores no sounds.
export function installUrls(
  { sounds, urls }: PrecacheManifest,
  soundFormat: string | null,
): string[] {
  const chosen = Object.entries(sounds).find(([format]) => format === soundFormat)?.[1] ?? [];
  return [...urls, ...chosen];
}

// How an install stores its URLs. copy: hashed URLs an earlier version's cache holds, stored as
// they are, since a hashed name never changes content. verify: every other URL an earlier cache
// holds that has a content hash in contentHashes (PrecacheManifest's), with that hash, stored from
// the earlier cache only where the earlier copy's bytes have that hash. fetch: the rest, such as a
// new or renamed file, or an unhashed URL with no recorded hash.
export interface InstallPlan {
  readonly copy: string[];
  readonly fetch: string[];
  readonly verify: [url: string, contentHash: string][];
}

export function installPlan(
  policy: CachePolicy,
  contentHashes: Readonly<Record<string, string>>,
  previouslyCached: ReadonlySet<string>,
  urls: readonly string[],
): InstallPlan {
  const plan: InstallPlan = { copy: [], fetch: [], verify: [] };
  for (const url of urls) {
    const contentHash = contentHashes[url];
    if (!previouslyCached.has(url)) {
      plan.fetch.push(url);
    } else if (isHashedAssetUrl(policy, url)) {
      plan.copy.push(url);
    } else if (contentHash === undefined) {
      plan.fetch.push(url);
    } else {
      plan.verify.push([url, contentHash]);
    }
  }
  return plan;
}

const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

// The content hash the precache records for a file, from the SHA-256 digest of its bytes: the
// digest's first 48 bits in URL-safe base64, eight characters, as web/build/vite/contentHash
// gives from the bytes. The service worker computes it with crypto.subtle, which has no base64.
export function digestContentHash(sha256: Uint8Array): string {
  let text = "";
  for (let byte = 0; byte < 6; byte += 3) {
    const bits =
      ((sha256[byte] ?? 0) << 16) | ((sha256[byte + 1] ?? 0) << 8) | (sha256[byte + 2] ?? 0);
    for (let shift = 18; shift >= 0; shift -= 6) {
      text += BASE64URL[(bits >> shift) & 63] ?? "";
    }
  }
  return text;
}

// The URLs the service worker answers from its cache: the precache list, and every sound file of
// every format.
export interface CachedUrls {
  readonly sounds: ReadonlySet<string>;
  readonly urls: ReadonlySet<string>;
}

export function cachedUrlsOf({ sounds, urls }: PrecacheManifest): CachedUrls {
  return { sounds: new Set(Object.values(sounds).flat()), urls: new Set(urls) };
}

export function strategyFor(
  policy: CachePolicy,
  cachedUrls: CachedUrls,
  request: { isNavigation: boolean; pathname: string },
): FetchStrategy {
  const key = cacheKeyFor(request.pathname);
  const cached =
    cachedUrls.urls.has(key) ||
    (!request.isNavigation && (isHashedAssetUrl(policy, key) || cachedUrls.sounds.has(key)));
  return cached ? "cache-first" : "network-only";
}
