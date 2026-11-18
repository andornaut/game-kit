// Runtime reading of the build pointer, manifests and version records (buildContract), shared by
// the page (dom/buildStore, dom/launch) and the router (dom/serviceWorker). Each parser checks
// the fields this kit reads and ignores any other, so a pointer, manifest or record that a later
// kit version wrote stays readable. buildManifest's validators are the strict build-time checks.
import { type BuildManifest, buildManifestUrl, type BuildPointer } from "./buildContract.ts";
import { validateVerifiedJsonBodies, type VerifiedJsonBody } from "./verifiedJsonBody.ts";

const SHA256_HEX = /^[a-f0-9]{64}$/;

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
