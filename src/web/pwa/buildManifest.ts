// Construction and validation of the build pointer and manifest that vite/precachePlugin emits
// and the page installer and router read (buildContract). Validation returns a frozen copy built
// only from the checked fields, and throws TypeError for a wrong shape or type and RangeError for
// a wrong value.
import { UNKNOWN_COMMIT } from "../build/buildVersion.ts";
import {
  type BuildFile,
  type BuildManifest,
  buildManifestUrl,
  type BuildPointer,
} from "./buildContract.ts";
import { isBuildId } from "./buildIdentity.ts";
import { validateVerifiedJsonBodies, type VerifiedJsonBody } from "./verifiedJsonBody.ts";

// The buildId of a build without a clean, known source commit, such as a development build.
export const UNKNOWN_BUILD_ID = UNKNOWN_COMMIT;

const VERSION = /^[0-9a-f]{16}$/;
const SHA256 = /^[0-9a-f]{64}$/;
// /.game-kit/ holds the pointer and manifests, which are never build files.
const RESERVED_PREFIX = "/.game-kit/";

const POINTER_KEYS = ["buildId", "manifest", "schema", "version"];
const MANIFEST_KEYS = ["boot", "buildId", "files", "schema", "sounds", "version"];
const OPTIONAL_MANIFEST_KEYS = ["verifiedJsonBodies"];
const FILE_KEYS = ["byteSize", "sha256", "url"];
const FAMILY_KEYS = ["byteSize", "sha256", "urls"];

function record(value: unknown, what: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${what} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  what: string,
): void {
  const keys = Object.keys(value);
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    keys.some((key) => !required.includes(key) && !optional.includes(key))
  ) {
    throw new TypeError(`${what} must have exactly the keys ${required.join(", ")}`);
  }
}

function array(value: unknown, what: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${what} must be an array`);
  }
  return value;
}

function string(value: unknown, what: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${what} must be a string`);
  }
  return value;
}

// A same-origin root-relative path in its cache-key form: no query, fragment, backslash,
// whitespace, dot segment or trailing index.html, and outside /.game-kit/.
function path(value: unknown, what: string): string {
  const url = string(value, what);
  if (
    !url.startsWith("/") ||
    url.startsWith("//") ||
    url.startsWith(RESERVED_PREFIX) ||
    /[?#\\\s]/.test(url) ||
    /\/\.{1,2}(?:\/|$)/.test(url) ||
    url.endsWith("/index.html")
  ) {
    throw new RangeError(`${what} must be a root-relative build path: ${url}`);
  }
  return url;
}

function version(value: unknown): string {
  if (!VERSION.test(string(value, "Build version"))) {
    throw new RangeError("Build version must be 16 lowercase hex characters");
  }
  return value as string;
}

function buildId(value: unknown): string {
  const id = string(value, "Build ID");
  if (!isBuildId(id) && id !== UNKNOWN_BUILD_ID) {
    throw new RangeError(`Build ID must be a full commit hash or ${UNKNOWN_BUILD_ID}`);
  }
  return id;
}

function schema(value: Record<string, unknown>, what: string): 1 {
  if (value.schema !== 1) {
    throw new RangeError(`${what} schema must be 1`);
  }
  return 1;
}

function file(value: unknown): BuildFile {
  const input = record(value, "Build file");
  exactKeys(input, FILE_KEYS, [], "Build file");
  const url = path(input.url, "Build file URL");
  const sha256 = string(input.sha256, `SHA-256 of ${url}`);
  if (!SHA256.test(sha256)) {
    throw new RangeError(`SHA-256 of ${url} must be 64 lowercase hex characters`);
  }
  const { byteSize } = input;
  if (typeof byteSize !== "number") {
    throw new TypeError(`Byte size of ${url} must be a number`);
  }
  if (!Number.isSafeInteger(byteSize) || byteSize < 0) {
    throw new RangeError(`Byte size of ${url} must be a nonnegative safe integer`);
  }
  return Object.freeze({ byteSize, sha256, url });
}

export function validateBuildPointer(value: unknown): BuildPointer {
  const input = record(value, "Build pointer");
  exactKeys(input, POINTER_KEYS, [], "Build pointer");
  const pointer = Object.freeze({
    buildId: buildId(input.buildId),
    manifest: string(input.manifest, "Build pointer manifest"),
    schema: schema(input, "Build pointer"),
    version: version(input.version),
  });
  if (pointer.manifest !== buildManifestUrl(pointer.version)) {
    throw new RangeError("Build pointer manifest must be the manifest URL of its version");
  }
  return pointer;
}

export function validateBuildManifest(value: unknown): BuildManifest {
  const input = record(value, "Build manifest");
  exactKeys(input, MANIFEST_KEYS, OPTIONAL_MANIFEST_KEYS, "Build manifest");
  const files = array(input.files, "Build files").map(file);
  const byUrl = new Map(files.map((entry) => [entry.url, entry]));
  if (byUrl.size !== files.length) {
    throw new RangeError("Build file URLs must be unique");
  }

  const soundInput = record(input.sounds, "Build sounds");
  const alternativesSeen = new Set<string>();
  const sounds = Object.fromEntries(
    Object.keys(soundInput).map((logical) => {
      path(logical, "Sound URL");
      const alternatives = array(soundInput[logical], `Alternatives of ${logical}`).map((url) =>
        path(url, `Alternative of ${logical}`),
      );
      if (alternatives.length === 0) {
        throw new RangeError(`Sound ${logical} needs at least one alternative`);
      }
      for (const url of alternatives) {
        if (!byUrl.has(url)) {
          throw new RangeError(`Sound alternative ${url} is not a build file`);
        }
        if (alternativesSeen.has(url)) {
          throw new RangeError(`Sound alternative ${url} is listed more than once`);
        }
        alternativesSeen.add(url);
      }
      return [logical, Object.freeze(alternatives)];
    }),
  );

  const boot = array(input.boot, "Boot files").map((url) => path(url, "Boot file"));
  if (new Set(boot).size !== boot.length) {
    throw new RangeError("Boot files must be unique");
  }
  const unlisted = boot.find((url) => !byUrl.has(url));
  if (unlisted !== undefined) {
    throw new RangeError(`Boot file ${unlisted} is not a build file`);
  }

  let verifiedJsonBodies: readonly VerifiedJsonBody[] | undefined;
  if (Object.hasOwn(input, "verifiedJsonBodies")) {
    const families = validateVerifiedJsonBodies(
      {
        byteSizes: Object.fromEntries(files.map((entry) => [entry.url, entry.byteSize])),
        urls: [...byUrl.keys()],
      },
      array(input.verifiedJsonBodies, "Verified JSON families").map((value) => {
        const family = record(value, "Verified JSON family");
        exactKeys(family, FAMILY_KEYS, ["responseProfile"], "Verified JSON family");
        array(family.urls, "Verified JSON family URLs");
        return family as unknown as VerifiedJsonBody;
      }),
    );
    for (const family of families) {
      if (family.urls.some((url) => byUrl.get(url)!.sha256 !== family.sha256)) {
        throw new RangeError("Verified JSON family SHA-256 must match each of its files");
      }
    }
    verifiedJsonBodies = Object.freeze(
      families.map((family) => Object.freeze({ ...family, urls: Object.freeze(family.urls) })),
    );
  }

  return Object.freeze({
    boot: Object.freeze(boot),
    buildId: buildId(input.buildId),
    files: Object.freeze(files),
    schema: schema(input, "Build manifest"),
    sounds: Object.freeze(sounds),
    version: version(input.version),
    ...(verifiedJsonBodies === undefined ? {} : { verifiedJsonBodies }),
  });
}

// The canonical manifest for a build: files sorted by URL and sounds by logical URL, with each
// sound's alternatives and the boot files in the given order. Throws as validateBuildManifest.
export function createBuildManifest(input: Omit<BuildManifest, "schema">): BuildManifest {
  const byUrl = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  return validateBuildManifest({
    boot: input.boot,
    buildId: input.buildId,
    files: [...input.files]
      .sort((a, b) => byUrl(a.url, b.url))
      .map(({ byteSize, sha256, url }) => ({ byteSize, sha256, url })),
    schema: 1,
    sounds: Object.fromEntries(
      Object.keys(input.sounds)
        .sort(byUrl)
        .map((logical) => [logical, input.sounds[logical]]),
    ),
    version: input.version,
    ...(input.verifiedJsonBodies === undefined
      ? {}
      : { verifiedJsonBodies: input.verifiedJsonBodies }),
  });
}

export function createBuildPointer(manifest: BuildManifest): BuildPointer {
  return validateBuildPointer({
    buildId: manifest.buildId,
    manifest: buildManifestUrl(manifest.version),
    schema: 1,
    version: manifest.version,
  });
}
