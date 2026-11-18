// Shared contract between the build plugin, the page installer, the router service worker and the
// launch module (docs/install-and-update.md). Types and constants only; each side implements its
// part in its own module.
import type { CachePolicy } from "./cachePolicy.ts";
import type { VerifiedJsonBody } from "./verifiedJsonBody.ts";

// The no-store pointer the page fetches at launch and resume to discover the deployed build.
export const BUILD_POINTER_URL = "/.game-kit/build.json";

// The immutable manifest of one build, named by its version.
export function buildManifestUrl(version: string): string {
  return `/.game-kit/manifest-${encodeURIComponent(version)}.json`;
}

export interface BuildPointer {
  readonly schema: 1;
  readonly version: string;
  readonly buildId: string;
  // buildManifestUrl(version).
  readonly manifest: string;
}

// One file of a build, under the logical URL pages request. sha256 is the full lowercase hex
// digest and byteSize the exact length of the body as built.
export interface BuildFile {
  readonly url: string;
  readonly sha256: string;
  readonly byteSize: number;
}

export interface BuildManifest {
  readonly schema: 1;
  readonly version: string;
  readonly buildId: string;
  // Every file the complete build needs offline, sound alternatives included.
  readonly files: readonly BuildFile[];
  // Each sound's logical URL mapped to its format alternatives' URLs, which are also in files.
  readonly sounds: Readonly<Record<string, readonly string[]>>;
  // Files the game reads while booting, after install, counted into the one progress total.
  readonly boot: readonly string[];
  readonly verifiedJsonBodies?: readonly VerifiedJsonBody[];
}

// The caching rules shared by the router and the page. cacheNamePrefix scopes every cache and
// record this kit writes for the game.
export type BuildPolicy = CachePolicy;

// Each stored entry carries its verified digest, so presence plus this header proves the entry
// passed size and SHA-256 when stored, and a later build reuses it by hash without re-hashing.
export const BUILD_HASH_HEADER = "x-game-kit-sha256";

// Cache names: one cache per build version, and one records cache.
export function buildCacheName(policy: BuildPolicy, version: string): string {
  return `${policy.cacheNamePrefix}build-${version}`;
}
export function recordsCacheName(policy: BuildPolicy): string {
  return `${policy.cacheNamePrefix}records`;
}

// The page writes active and staged; the router writes a pin per window client. Each is its own
// record entry, so a page write and a router pin write never overwrite each other.
export interface BuildState {
  // The version the router serves to a new navigation. Absent until a first install completes.
  readonly active?: string;
  // A complete, verified version waiting to become active at the next launch or Update now.
  readonly staged?: string;
}

// First-install progress, one determinate value in [0, 1] over download plus boot reads.
export interface LaunchProgress {
  readonly phase: "installing" | "booting" | "ready";
  readonly value: number;
  readonly receivedBytes: number;
  readonly totalBytes: number;
}

// Shown only for the first install: Loading failed with Retry.
export interface LaunchFailure {
  readonly reason: "network" | "quota" | "verification" | "unsupported";
  readonly retry: () => void;
}

// Background updates never show Loading failed or pause play (K3).
export type UpdateState =
  | { readonly phase: "idle" }
  | { readonly phase: "staging"; readonly version: string; readonly value: number }
  | { readonly phase: "ready"; readonly version: string }
  | { readonly phase: "failed"; readonly version: string };

// Fired once per staged version during a session. The game draws its own prompt and pauses play.
// updateNow awaits the game's save, then activates the staged build and reloads with no download.
// dismiss continues play on the active build; the next launch applies the update silently.
export interface UpdateOffer {
  readonly version: string;
  readonly updateNow: (save: () => void | PromiseLike<void>) => Promise<void>;
  readonly dismiss: () => void;
}

export type LaunchResult = "play" | "reloading";
