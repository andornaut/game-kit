import type { PrecacheManifest } from "./precacheList";

// How the service worker answers a same-origin GET.
// network-first: pages and the policy's revalidated URLs (unhashed files such as manifests, whose
// new copy must show on the next load); the cached copy answers offline.
// cache-first: content-hashed build output and the precached files, and the files of every sound
// format, so one the install did not store is stored on its first fetch.
// network-only: anything else, left to the browser.
export type FetchStrategy = "cache-first" | "network-first" | "network-only";

// A game's caching rules, which the service worker and the precache build share.
export interface CachePolicy {
  // The start of every cache name the worker makes; an activated worker deletes the others that
  // start with it.
  readonly cacheNamePrefix: string;
  // The path every content-hashed build file starts with, e.g. "/assets/".
  readonly hashedAssetPrefix: string;
  // Unhashed URLs the worker fetches network-first even when precached, so a deploy shows on the
  // next load.
  readonly revalidatedUrls: readonly string[];
}

// Content-hashed build output, safe to serve from cache for as long as it is referenced.
export function isHashedAssetUrl(policy: CachePolicy, url: string): boolean {
  return url.startsWith(policy.hashedAssetPrefix);
}

// How the service worker fetches a URL to precache it. Hashed build output never changes under
// its name, so the HTTP cache may answer with the copy the page just loaded. Every other URL can,
// so no-cache has the server confirm the HTTP cache's copy, or send the new one, before it is
// stored.
export function precacheFetchOptions(policy: CachePolicy, url: string): RequestInit {
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

// The URLs the service worker answers from its cache: the precache list and every sound file.
export function cachedUrlsOf({ sounds, urls }: PrecacheManifest): Set<string> {
  return new Set([...urls, ...Object.values(sounds).flat()]);
}

export function strategyFor(
  policy: CachePolicy,
  cachedUrls: ReadonlySet<string>,
  request: { isNavigation: boolean; pathname: string },
): FetchStrategy {
  const key = cacheKeyFor(request.pathname);
  if (request.isNavigation) {
    return cachedUrls.has(key) ? "network-first" : "network-only";
  }
  if (policy.revalidatedUrls.includes(key)) {
    return "network-first";
  }
  if (isHashedAssetUrl(policy, key) || cachedUrls.has(key)) {
    return "cache-first";
  }
  return "network-only";
}
