// Runtime reading of the build pointer, manifests and version records (buildContract), shared by
// the page (dom/buildStore, dom/launch) and the router (dom/serviceWorker), and the choice of the
// sound alternatives a device installs. Each parser checks the fields this kit reads and ignores
// any other, so a pointer, manifest or record that a later kit version wrote stays readable.
// buildManifest's validators are the strict build-time checks.
import {
  type BuildFile,
  type BuildManifest,
  buildManifestUrl,
  type BuildPack,
  type BuildPointer,
  type InstalledManifest,
} from "./buildContract.ts";
import { validateVerifiedJsonBodies, type VerifiedJsonBody } from "./verifiedJsonBody.ts";

const SHA256_HEX = /^[a-f0-9]{64}$/;

const PACK_URL = /^\/\.game-kit\/pack-[0-9a-f]{64}\.bin$/;
const PACK_CONTENT_TYPES = new Map([
  ["avif", "image/avif"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["json", "application/json"],
  ["m4a", "audio/mp4"],
  ["mp3", "audio/mpeg"],
  ["ogg", "audio/ogg"],
  ["png", "image/png"],
  ["svg", "image/svg+xml"],
  ["wav", "audio/wav"],
  ["webp", "image/webp"],
]);

// The content type of every record and saved manifest entry.
export const RECORD_CONTENT_TYPE = "application/json; charset=utf-8";

// A version names a cache and a record key, so it is nonempty with no whitespace or slash.
export function isBuildVersion(value: unknown): value is string {
  return typeof value === "string" && value !== "" && !/[\s/]/.test(value);
}

// The body of an active, staged or pin record.
export function versionRecordText(version: string): string {
  if (!isBuildVersion(version)) {
    throw new TypeError(`Invalid build version: ${String(version)}`);
  }
  return JSON.stringify({ version });
}

// The version a parsed record body names, or undefined for a malformed one.
export function parseVersionRecord(value: unknown): string | undefined {
  const version =
    typeof value === "object" && value !== null
      ? (value as { version?: unknown }).version
      : undefined;
  return isBuildVersion(version) ? version : undefined;
}

// Checks a pointer fetched from BUILD_POINTER_URL. Throws TypeError.
export function parseBuildPointer(value: unknown): BuildPointer {
  const pointer = value as Partial<BuildPointer> | null;
  if (
    typeof pointer !== "object" ||
    pointer === null ||
    pointer.schema !== 1 ||
    !isBuildVersion(pointer.version) ||
    typeof pointer.buildId !== "string" ||
    pointer.manifest !== buildManifestUrl(pointer.version)
  ) {
    throw new TypeError("Invalid build pointer");
  }
  return pointer as BuildPointer;
}

// Packs supply bodies without individual HTTP headers. Limit them to known media types.
export function packContentType(url: string): string | undefined {
  return PACK_CONTENT_TYPES.get(soundFormatOf(url) ?? "");
}

export function validateBuildPacks(
  files: readonly BuildFile[],
  families: readonly VerifiedJsonBody[] | undefined,
  value: unknown,
): readonly BuildPack[] {
  if (!Array.isArray(value)) {
    throw new TypeError("Build packs must be an array");
  }
  const sizes = new Map(files.map(({ byteSize, url }) => [url, byteSize]));
  const used = new Set(families?.flatMap((family) => family.urls) ?? []);
  const urls = new Set<string>();
  return Object.freeze(
    value.map((entry: Partial<BuildPack> | null) => {
      if (
        entry === null ||
        typeof entry !== "object" ||
        Object.keys(entry).length !== 4 ||
        entry.encoding !== "gzip" ||
        typeof entry.url !== "string" ||
        !PACK_URL.test(entry.url) ||
        urls.has(entry.url) ||
        !Array.isArray(entry.members) ||
        entry.members.length < 2
      ) {
        throw new TypeError("Invalid build pack");
      }
      urls.add(entry.url);
      let bytes = 0;
      const members = entry.members.map((member: unknown) => {
        if (
          typeof member !== "string" ||
          used.has(member) ||
          !sizes.has(member) ||
          sizes.get(member) === 0 ||
          packContentType(member) === undefined
        ) {
          throw new TypeError(`Invalid build pack member: ${String(member)}`);
        }
        used.add(member);
        bytes += sizes.get(member)!;
        return member;
      });
      if (!Number.isSafeInteger(bytes)) {
        throw new RangeError("Invalid build pack byte size");
      }
      const file = { members: Object.freeze(members), url: entry.url };
      const { encodedByteSize } = entry;
      if (
        encodedByteSize === undefined ||
        !Number.isSafeInteger(encodedByteSize) ||
        encodedByteSize < 1 ||
        encodedByteSize >= bytes
      ) {
        throw new RangeError("Invalid gzip pack byte size");
      }
      return Object.freeze({ ...file, encodedByteSize, encoding: "gzip" });
    }),
  );
}

export function readBuildPacks(manifest: BuildManifest): readonly BuildPack[] | undefined {
  if (manifest.packs === undefined) {
    return undefined;
  }
  try {
    return validateBuildPacks(manifest.files, manifest.verifiedJsonBodies, manifest.packs);
  } catch {
    return undefined;
  }
}

// Checks a manifest read from a record or the network: its schema, version, each file's
// root-relative URL, full SHA-256 and byte size, unique URLs, and boot files that are build
// files. Throws TypeError.
export function parseBuildManifest(value: unknown): BuildManifest {
  const manifest = value as BuildManifest;
  if (
    typeof value !== "object" ||
    value === null ||
    manifest.schema !== 1 ||
    !isBuildVersion(manifest.version) ||
    typeof manifest.buildId !== "string" ||
    !Array.isArray(manifest.files) ||
    typeof manifest.sounds !== "object" ||
    manifest.sounds === null ||
    !Array.isArray(manifest.boot) ||
    (manifest.verifiedJsonBodies !== undefined && !Array.isArray(manifest.verifiedJsonBodies))
  ) {
    throw new TypeError("Invalid build manifest");
  }
  const urls = new Set<string>();
  for (const file of manifest.files) {
    if (
      typeof file !== "object" ||
      file === null ||
      typeof file.url !== "string" ||
      !file.url.startsWith("/") ||
      file.url.startsWith("//") ||
      urls.has(file.url) ||
      typeof file.sha256 !== "string" ||
      !SHA256_HEX.test(file.sha256) ||
      !Number.isSafeInteger(file.byteSize) ||
      file.byteSize < 0
    ) {
      throw new TypeError(`Invalid build manifest file: ${String(file?.url)}`);
    }
    urls.add(file.url);
  }
  if (!manifest.boot.every((url) => typeof url === "string" && urls.has(url))) {
    throw new TypeError("Invalid build manifest boot files");
  }
  if (manifest.packs !== undefined && readBuildPacks(manifest) === undefined) {
    // Individual files remain usable when the optional transport index is unavailable.
    const withoutPacks = { ...manifest };
    delete withoutPacks.packs;
    return withoutPacks;
  }
  return manifest;
}

// Each verified JSON URL's family, after checking that the families describe the manifest's own
// files and digests. Throws RangeError.
export function verifiedJsonFamilies(manifest: BuildManifest): Map<string, VerifiedJsonBody> {
  const byUrl = new Map<string, VerifiedJsonBody>();
  if (manifest.verifiedJsonBodies === undefined) {
    return byUrl;
  }
  const files = new Map(manifest.files.map((file) => [file.url, file]));
  const families = validateVerifiedJsonBodies(
    {
      byteSizes: Object.fromEntries(manifest.files.map((file) => [file.url, file.byteSize])),
      urls: [...files.keys()],
    },
    manifest.verifiedJsonBodies,
  );
  for (const family of families) {
    for (const url of family.urls) {
      if (files.get(url)?.sha256 !== family.sha256) {
        throw new RangeError(`Verified JSON digest differs from the manifest for ${url}`);
      }
      byUrl.set(url, family);
    }
  }
  return byUrl;
}

// A sound alternative's format: the extension of its URL's last segment, such as "ogg" for
// /assets/hit-1a2b3c4d.ogg, or undefined where the segment has none.
export function soundFormatOf(url: string): string | undefined {
  const segment = url.slice(url.lastIndexOf("/") + 1);
  const dot = segment.lastIndexOf(".");
  return dot === -1 ? undefined : segment.slice(dot + 1);
}

// The manifest the page installs and saves for a build on this device, given the sound format the
// page plays. With soundFormat, each sound keeps only its alternatives in that format, and a sound
// with none keeps no alternative; files and verified JSON families leave the other alternatives
// out, and a boot file that is a left-out alternative becomes its sound's kept one. Without
// soundFormat, every alternative stays. The router serves only the saved manifest's files, so a
// left-out alternative requested later goes to the network.
export function installedManifest(
  soundFormat: string | undefined,
  manifest: BuildManifest,
): InstalledManifest {
  // Each left-out alternative, mapped to its sound's kept alternative, if any.
  const leftOut = new Map<string, string | undefined>();
  const sounds: Record<string, readonly string[]> = {};
  for (const [logical, alternatives] of Object.entries(manifest.sounds)) {
    const kept =
      soundFormat === undefined
        ? alternatives
        : alternatives.filter((url) => soundFormatOf(url) === soundFormat);
    for (const url of alternatives) {
      if (!kept.includes(url)) {
        leftOut.set(url, kept[0]);
      }
    }
    if (kept.length > 0) {
      sounds[logical] = kept;
    }
  }
  const boot = manifest.boot.flatMap((url) => {
    if (!leftOut.has(url)) {
      return [url];
    }
    const kept = leftOut.get(url);
    return kept === undefined ? [] : [kept];
  });
  const families = manifest.verifiedJsonBodies
    ?.map((family) => ({ ...family, urls: family.urls.filter((url) => !leftOut.has(url)) }))
    .filter((family) => family.urls.length > 1);
  const packs = manifest.packs?.filter((pack) => pack.members.every((url) => !leftOut.has(url)));
  return {
    boot: [...new Set(boot)],
    buildId: manifest.buildId,
    files: manifest.files.filter((file) => !leftOut.has(file.url)),
    schema: manifest.schema,
    sounds,
    version: manifest.version,
    ...(packs === undefined ? {} : { packs }),
    ...(families === undefined ? {} : { verifiedJsonBodies: families }),
    ...(soundFormat === undefined ? {} : { soundFormat }),
  };
}
