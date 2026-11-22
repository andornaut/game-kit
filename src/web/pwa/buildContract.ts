// Shared contract between the build plugin, the page installer, the router service worker and the
// launch module (docs/install-and-update.md). Each side implements its part in its own module.
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

// Install transport only. Decoded bytes concatenate the files in order, with boundaries from files.
export interface BuildPack {
  readonly encodedByteSize: number;
  readonly encoding: "gzip";
  readonly url: string;
  readonly members: readonly string[];
}

export interface BuildManifest {
  readonly schema: 1;
  readonly version: string;
  readonly buildId: string;
  // Every file the complete build needs offline, sound alternatives included.
  readonly files: readonly BuildFile[];
  // Each sound's logical URL mapped to its format alternatives' URLs, which are also in files. An
  // alternative's format is its URL's extension, such as "ogg" for /assets/hit-1a2b3c4d.ogg.
  readonly sounds: Readonly<Record<string, readonly string[]>>;
  // Files the game reads while booting, after install, counted into the one progress total.
  readonly boot: readonly string[];
  readonly packs?: readonly BuildPack[];
  readonly verifiedJsonBodies?: readonly VerifiedJsonBody[];
}

// The manifest the page saves for a build it installs on this device (buildRecords'
// installedManifest): the deployed manifest reduced to the sound alternatives in soundFormat,
// which it records. Without soundFormat it keeps every alternative. The installer, the store's
// completeness check, launch and the router all read this saved manifest, so they agree on which
// files the build needs here.
export interface InstalledManifest extends BuildManifest {
  readonly soundFormat?: string;
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

// Record entries in recordsCacheName, keyed by same-origin URL. Each body is {"version": string};
// an absent record is a missing entry, never a null. Manifests are stored in the same cache under
// buildManifestUrl(version), with the InstalledManifest JSON as the body.
export const ACTIVE_RECORD_PATH = "/.game-kit/records/active";
export const STAGED_RECORD_PATH = "/.game-kit/records/staged";
export function pinRecordPath(clientId: string): string {
  return `/.game-kit/records/pin/${encodeURIComponent(clientId)}`;
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

// Loading failed with Retry for a failed startup read or foreground install.
export interface LaunchFailure {
  readonly reason: "network" | "verification";
  readonly retry: () => void;
}

// A first install this device cannot complete, so the game plays from the network. unsupported:
// the router service worker cannot register. quota: storage is full. The game shows its own
// notice; each later launch tries the install again, reusing stored files.
export interface NetworkPlayNotice {
  readonly reason: "quota" | "unsupported";
}

// Background updates never show Loading failed or pause play (K3).
export type UpdateState =
  | { readonly phase: "idle" }
  | { readonly phase: "staging"; readonly version: string; readonly value: number }
  | { readonly phase: "ready"; readonly version: string }
  | { readonly phase: "failed"; readonly version: string };

// Fired once per staged version during a session. The game draws its own prompt and pauses play.
// updateNow awaits the game's save, then activates the offered build if still current. It reloads
// without downloading if the build is already active or successfully activated.
// A superseded offer rejects with ObsoleteUpdateOfferError naming the offer that started the switch.
// dismiss continues play on the active build; the next launch applies the update silently.
export interface UpdateOffer {
  readonly version: string;
  readonly updateNow: (save: () => void | PromiseLike<void>) => Promise<void>;
  readonly dismiss: () => void;
}

export class ObsoleteUpdateOfferError extends Error {
  readonly version: string;

  constructor(version: string) {
    super(`Build ${version} is no longer available for this update offer`);
    this.name = "ObsoleteUpdateOfferError";
    this.version = version;
  }
}

export type LaunchResult = "play" | "reloading";
