// A game's caching rules, which the build plugin, the page installer and the router share
// (buildContract's BuildPolicy).
export interface CachePolicy {
  // The start of every cache and record name the kit makes for the game.
  readonly cacheNamePrefix: string;
  // The path every content-hashed build file starts with, e.g. "/assets/".
  readonly hashedAssetPrefix: string;
}

// Content-hashed build output, whose name changes with its content.
export function isHashedAssetUrl(policy: CachePolicy, url: string): boolean {
  return url.startsWith(policy.hashedAssetPrefix);
}

// The cache key for a path. Cloudflare and Vite serve /dir/index.html at /dir/, so both share
// one entry.
export function cacheKeyFor(pathname: string): string {
  return pathname.replace(/\/index\.html$/, "/");
}
