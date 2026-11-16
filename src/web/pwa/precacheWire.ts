import { isBuildId } from "./buildIdentity.ts";
import { digestContentHash } from "./cachePolicy.ts";
import { validatePrecacheGroups } from "./precacheGroups.ts";
import type { PrecacheManifest } from "./precacheManifest.ts";
import { validateVerifiedJsonBodies } from "./verifiedJsonBody.ts";

type UrlReferences = readonly number[];
type NamedReferences = readonly (readonly [string, UrlReferences])[];

// Internal transport only. Durable records and public caller data remain semantic manifests.
export type PrecacheManifestWire = readonly [
  schema: 1,
  version: string,
  buildId: string | null,
  urlTable: readonly string[],
  urls: UrlReferences,
  hashes: readonly (string | null)[],
  byteSizes: readonly number[] | null,
  sounds: NamedReferences,
  groups: null | readonly [initial: readonly string[], entries: NamedReferences],
  verifiedJsonBodies:
    null | readonly (readonly [sha256: string, byteSize: number, urls: UrlReferences])[],
];

function invalid(): never {
  throw new TypeError("Invalid precache manifest wire");
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return invalid();
  }
  return value as Record<string, unknown>;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item: unknown) => typeof item !== "string")) {
    return invalid();
  }
  return value as string[];
}

function unique(value: readonly unknown[]): void {
  if (new Set(value).size !== value.length) {
    invalid();
  }
}

function size(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

// Legacy data retains its published permissive hash/URL shape. Wire-only canonical restrictions
// do not change installed build records or callers using older semantic manifests.
function semantic(value: unknown): PrecacheManifest {
  const input = record(value);
  if (typeof input.version !== "string" || input.version.length === 0) {
    invalid();
  }
  strings(input.urls);
  Object.values(record(input.sounds)).forEach(strings);
  if (Object.values(record(input.contentHashes)).some((hash) => typeof hash !== "string")) {
    invalid();
  }
  if (input.byteSizes !== undefined && !Object.values(record(input.byteSizes)).every(size)) {
    invalid();
  }
  return input as unknown as PrecacheManifest;
}

function canonical(manifest: PrecacheManifest): void {
  if (manifest.version.length !== 16 || !/^[a-f0-9]{16}$/.test(manifest.version)) {
    invalid();
  }
  const allowed = [
    "buildId",
    "byteSizes",
    "contentHashes",
    "groups",
    "sounds",
    "urls",
    "verifiedJsonBodies",
    "version",
  ];
  if (Object.keys(manifest).some((key) => !allowed.includes(key))) {
    invalid();
  }
  const available = [...new Set([...manifest.urls, ...Object.values(manifest.sounds).flat()])];
  const known = new Set(available);
  for (const urls of [manifest.urls, ...Object.values(manifest.sounds)]) {
    unique(urls);
  }
  for (const url of available) {
    if (
      !url.startsWith("/") ||
      url.startsWith("//") ||
      /[?#\\\s]/.test(url) ||
      /\/(?:\.{1,2})(?:\/|$)/.test(url) ||
      url.endsWith("/index.html")
    ) {
      invalid();
    }
  }
  for (const [url, hash] of Object.entries(manifest.contentHashes)) {
    if (
      !known.has(url) ||
      (hash !== "" && (hash.length !== 8 || !/^[A-Za-z0-9_-]{8}$/.test(hash)))
    ) {
      invalid();
    }
  }
  if (Object.hasOwn(manifest, "buildId") && !isBuildId(manifest.buildId)) {
    invalid();
  }
  if (Object.hasOwn(manifest, "byteSizes")) {
    if (
      manifest.byteSizes === undefined ||
      Object.keys(manifest.byteSizes).length !== available.length ||
      available.some(
        (url) => !Object.hasOwn(manifest.byteSizes!, url) || !size(manifest.byteSizes![url]),
      )
    ) {
      invalid();
    }
  }
  if (Object.hasOwn(manifest, "groups")) {
    const groups = manifest.groups;
    if (
      groups === undefined ||
      !isBuildId(manifest.buildId) ||
      manifest.byteSizes === undefined ||
      available.some(
        (url) => !Object.hasOwn(manifest.contentHashes, url) || manifest.contentHashes[url] === "",
      )
    ) {
      invalid();
    }
    validatePrecacheGroups(available, groups);
    unique(groups.initial);
    Object.values(groups.urls).forEach(unique);
  }
  if (Object.hasOwn(manifest, "verifiedJsonBodies")) {
    if (manifest.verifiedJsonBodies === undefined) {
      invalid();
    }
    validateVerifiedJsonBodies(
      {
        urls: available,
        ...(manifest.byteSizes === undefined ? {} : { byteSizes: manifest.byteSizes }),
      },
      manifest.verifiedJsonBodies,
    );
    for (const family of manifest.verifiedJsonBodies) {
      const hash = digestContentHash(
        Uint8Array.from(family.sha256.match(/../g)!, (hex) => Number.parseInt(hex, 16)),
      );
      if (
        family.urls.some(
          (url) =>
            Object.hasOwn(manifest.contentHashes, url) && manifest.contentHashes[url] !== hash,
        )
      ) {
        invalid();
      }
    }
  }
}

export function decodePrecacheManifest(input: unknown): PrecacheManifest {
  if (!Array.isArray(input)) {
    return semantic(input);
  }
  if (input.length !== 10 || input[0] !== 1) {
    return invalid();
  }
  const table = strings(input[3]);
  unique(table);
  const references = (value: unknown): string[] => {
    if (
      !Array.isArray(value) ||
      value.some(
        (index: unknown) =>
          !Number.isSafeInteger(index) || Number(index) < 0 || Number(index) >= table.length,
      )
    ) {
      return invalid();
    }
    unique(value);
    return (value as number[]).map((index) => table[index]!);
  };
  const named = (value: unknown): Record<string, string[]> => {
    if (!Array.isArray(value)) {
      return invalid();
    }
    const entries = value.map((entry: unknown) => {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string") {
        return invalid();
      }
      return [entry[0], references(entry[1])] as const;
    });
    unique(entries.map(([name]) => name));
    return Object.fromEntries(entries);
  };
  const hashes: unknown = input[5];
  const sizes: unknown = input[6];
  if (
    !Array.isArray(hashes) ||
    hashes.length !== table.length ||
    hashes.some((hash: unknown) => hash !== null && typeof hash !== "string") ||
    (sizes !== null &&
      (!Array.isArray(sizes) || sizes.length !== table.length || !sizes.every(size)))
  ) {
    return invalid();
  }
  const manifest = semantic({
    ...(input[2] === null ? {} : { buildId: input[2] }),
    ...(sizes === null
      ? {}
      : {
          byteSizes: Object.fromEntries(
            table.map((url, index) => [url, (sizes as number[])[index]!]),
          ),
        }),
    contentHashes: Object.fromEntries(
      table.flatMap((url, index) => (hashes[index] === null ? [] : [[url, hashes[index]]])),
    ),
    sounds: named(input[7]),
    urls: references(input[4]),
    version: input[1],
  });
  const claimed = new Set([...manifest.urls, ...Object.values(manifest.sounds).flat()]);
  if (table.some((url) => !claimed.has(url))) {
    return invalid();
  }
  if (input[8] !== null) {
    if (!Array.isArray(input[8]) || input[8].length !== 2) {
      return invalid();
    }
    manifest.groups = { initial: [...strings(input[8][0])], urls: named(input[8][1]) };
  }
  if (input[9] !== null) {
    if (!Array.isArray(input[9])) {
      return invalid();
    }
    manifest.verifiedJsonBodies = input[9].map((family: unknown) => {
      if (
        !Array.isArray(family) ||
        family.length !== 3 ||
        typeof family[0] !== "string" ||
        !size(family[1])
      ) {
        return invalid();
      }
      return { byteSize: family[1], sha256: family[0], urls: references(family[2]) };
    });
  }
  canonical(manifest);
  return manifest;
}

export function encodePrecacheManifest(manifest: PrecacheManifest): PrecacheManifestWire {
  semantic(manifest);
  canonical(manifest);
  const table = [...new Set([...manifest.urls, ...Object.values(manifest.sounds).flat()])].sort();
  const indices = new Map(table.map((url, index) => [url, index]));
  const references = (urls: readonly string[]): number[] => urls.map((url) => indices.get(url)!);
  const named = (value: Readonly<Record<string, readonly string[]>>): NamedReferences =>
    Object.entries(value).map(([name, urls]) => [name, references(urls)]);
  const wire: PrecacheManifestWire = [
    1,
    manifest.version,
    manifest.buildId ?? null,
    table,
    references(manifest.urls),
    table.map((url) =>
      Object.hasOwn(manifest.contentHashes, url) ? manifest.contentHashes[url]! : null,
    ),
    manifest.byteSizes === undefined ? null : table.map((url) => manifest.byteSizes![url]!),
    named(manifest.sounds),
    manifest.groups === undefined
      ? null
      : [[...manifest.groups.initial], named(manifest.groups.urls)],
    manifest.verifiedJsonBodies === undefined
      ? null
      : manifest.verifiedJsonBodies.map((family) => [
          family.sha256,
          family.byteSize,
          references(family.urls),
        ]),
  ];
  const decoded = decodePrecacheManifest(wire);
  // Compare semantic fields without depending on URL-key insertion order in records.
  if (JSON.stringify(encodeFields(decoded)) !== JSON.stringify(encodeFields(manifest))) {
    invalid();
  }
  return wire;
}

function encodeFields(manifest: PrecacheManifest): unknown {
  const sorted = (record: Readonly<Record<string, unknown>>) =>
    Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return [
    manifest.version,
    manifest.buildId ?? null,
    manifest.urls,
    sorted(manifest.sounds),
    sorted(manifest.contentHashes),
    manifest.byteSizes === undefined ? null : sorted(manifest.byteSizes),
    manifest.groups === undefined ? null : [manifest.groups.initial, sorted(manifest.groups.urls)],
    manifest.verifiedJsonBodies === undefined
      ? null
      : manifest.verifiedJsonBodies.map((family) => [family.sha256, family.byteSize, family.urls]),
  ];
}
