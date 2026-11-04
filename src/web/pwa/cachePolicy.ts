import type { PrecacheManifest } from "./precacheList.ts";

// How the service worker answers a same-origin GET.
// cache-first: content-hashed build output, and the files of every sound format, so one the
// install did not store is stored on its first fetch.
// network-first: the precached page and every other precached file; the cached copy answers
// offline. An unhashed file can change under its name, so code that reads it must see the deploy
// the page came from.
// network-only: anything else, left to the browser.
export type FetchStrategy = "cache-first" | "network-first" | "network-only";

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

// How an install stores its URLs: hashed URLs an earlier version's cache holds are copied from
// it, since a hashed name never changes content, and the rest are fetched. Unhashed URLs, such as
// the page, are always fetched fresh.
export function installPlan(
  policy: CachePolicy,
  previouslyCached: ReadonlySet<string>,
  urls: readonly string[],
): { copy: string[]; fetch: string[] } {
  const copy: string[] = [];
  const fetch: string[] = [];
  for (const url of urls) {
    (isHashedAssetUrl(policy, url) && previouslyCached.has(url) ? copy : fetch).push(url);
  }
  return { copy, fetch };
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
  if (request.isNavigation) {
    return cachedUrls.urls.has(key) ? "network-first" : "network-only";
  }
  if (isHashedAssetUrl(policy, key) || cachedUrls.sounds.has(key)) {
    return "cache-first";
  }
  return cachedUrls.urls.has(key) ? "network-first" : "network-only";
}
