import type { PrecacheGroups } from "./precacheGroups.ts";
import type { VerifiedJsonBody } from "./verifiedJsonBody.ts";

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
  verifiedJsonBodies?: readonly VerifiedJsonBody[];
  version: string;
}
