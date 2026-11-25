import {
  BUILD_ARCHIVE_HEADER_BYTES,
  type BuildArchiveIndex,
  parseBuildArchiveIndex,
  readBuildArchivePrefixSize,
} from "../archive/index.ts";
import {
  BUILD_HASH_HEADER,
  type BuildArchiveReference,
  buildCacheName,
  type BuildPointer,
  type BuildPolicy,
  isBuildVersion,
  parseBuildPointer,
  RECORD_CONTENT_TYPE,
  recordsCacheName,
} from "../index.ts";
import { withBuildStateLock } from "./buildStore.ts";

// The records-cache marker uses archive-record-<version>.json alongside the legacy manifest.
// The body key is the same in each distinct per-version build cache.
const ARCHIVE_BODY_PATH = "/.game-kit/records/archive-body";

export type ArchivedBuildPointer = BuildPointer & { readonly archive: BuildArchiveReference };

export type BuildArchiveRead =
  | { readonly kind: "unknown" }
  | { readonly kind: "unavailable"; readonly pointer?: ArchivedBuildPointer }
  | {
      readonly kind: "ready";
      readonly pointer: ArchivedBuildPointer;
      readonly blob: Blob;
      readonly index: BuildArchiveIndex;
    };

interface BuildArchiveStoreContext {
  readonly caches: CacheStorage;
  readonly origin: string;
  readonly policy: BuildPolicy;
}

export interface BuildArchiveStore {
  // Use the Blob verified by the downloader for this exact pointer. Call outside the build-state
  // lock. The caller rechecks completeness in its state transaction before staging or activation.
  put(pointer: BuildPointer, blob: Blob, signal?: AbortSignal): Promise<void>;
  complete(version: string, expectedPointer?: BuildPointer): Promise<boolean>;
  // A marker read error propagates. Only an absent marker yields "unknown".
  read(version: string): Promise<BuildArchiveRead>;
}

type ArchiveMarker =
  | { readonly kind: "unknown" | "unavailable" }
  | { readonly kind: "known"; readonly pointer: ArchivedBuildPointer };

function archivedPointer(value: unknown): ArchivedBuildPointer {
  const { archive, buildId, manifest, schema, version } = parseBuildPointer(value);
  if (archive === undefined) {
    throw new TypeError("Missing build archive reference");
  }
  return {
    archive: { byteSize: archive.byteSize, schema: archive.schema, sha256: archive.sha256 },
    buildId,
    manifest,
    schema,
    version,
  };
}

function samePointer(pointer: ArchivedBuildPointer, expected: BuildPointer): boolean {
  return (
    pointer.schema === expected.schema &&
    pointer.version === expected.version &&
    pointer.buildId === expected.buildId &&
    pointer.manifest === expected.manifest &&
    pointer.archive.schema === expected.archive?.schema &&
    pointer.archive.byteSize === expected.archive.byteSize &&
    pointer.archive.sha256 === expected.archive.sha256
  );
}

async function readIndex(pointer: ArchivedBuildPointer, blob: Blob): Promise<BuildArchiveIndex> {
  const header = new Uint8Array(await blob.slice(0, BUILD_ARCHIVE_HEADER_BYTES).arrayBuffer());
  const prefixBytes = readBuildArchivePrefixSize(blob.size, header);
  const prefix = new Uint8Array(await blob.slice(0, prefixBytes).arrayBuffer());
  return parseBuildArchiveIndex(pointer, blob.size, prefix);
}

export function createBuildArchiveStore({
  caches,
  origin,
  policy,
}: BuildArchiveStoreContext): BuildArchiveStore {
  if (new URL(origin).origin !== origin) {
    throw new TypeError("Invalid build archive store origin");
  }
  const records = recordsCacheName(policy);
  const bodyKey = origin + ARCHIVE_BODY_PATH;
  const recordKey = (version: string) => {
    if (!isBuildVersion(version)) {
      throw new TypeError("Invalid build archive version");
    }
    return `${origin}/.game-kit/archive-record-${encodeURIComponent(version)}.json`;
  };

  const readMarker = async (version: string): Promise<ArchiveMarker> => {
    const entry = await caches.match(recordKey(version), { cacheName: records });
    if (entry === undefined) {
      return { kind: "unknown" };
    }
    if (entry.status !== 200) {
      return { kind: "unavailable" };
    }
    try {
      const pointer = archivedPointer(await entry.json());
      if (pointer.version === version) {
        return { kind: "known", pointer };
      }
    } catch {
      // A malformed marker must fail closed just like a missing body.
    }
    return { kind: "unavailable" };
  };

  const readBody = async (pointer: ArchivedBuildPointer): Promise<Blob | undefined> => {
    const { archive, version } = pointer;
    try {
      const entry = await caches.match(bodyKey, { cacheName: buildCacheName(policy, version) });
      if (
        entry?.status !== 200 ||
        entry.headers.get(BUILD_HASH_HEADER) !== archive.sha256 ||
        entry.headers.get("content-length") !== String(archive.byteSize)
      ) {
        return undefined;
      }
      const blob = await entry.blob();
      return blob.size === archive.byteSize ? blob : undefined;
    } catch {
      return undefined;
    }
  };

  return {
    async complete(version, expectedPointer) {
      const marker = await readMarker(version);
      return (
        marker.kind === "known" &&
        (expectedPointer === undefined || samePointer(marker.pointer, expectedPointer)) &&
        (await readBody(marker.pointer)) !== undefined
      );
    },

    async put(value, blob, signal) {
      signal?.throwIfAborted();
      const pointer = archivedPointer(value);
      const { archive, version } = pointer;
      if (blob.size !== archive.byteSize) {
        throw new RangeError("Build archive size does not match the pointer");
      }
      await readIndex(pointer, blob);
      await withBuildStateLock(policy, async () => {
        signal?.throwIfAborted();
        const marker = await readMarker(version);
        if (
          marker.kind === "unavailable" ||
          (marker.kind === "known" && !samePointer(marker.pointer, pointer))
        ) {
          throw new TypeError("Conflicting cached build archive pointer");
        }

        // Publish the body before the marker. An interrupted first write can leave an unmarked
        // body for retry or reclaim. No active, staged or pin record is written here.
        const cache = await caches.open(buildCacheName(policy, version));
        signal?.throwIfAborted();
        await cache.put(
          bodyKey,
          new Response(blob, {
            headers: {
              [BUILD_HASH_HEADER]: archive.sha256,
              "content-length": String(archive.byteSize),
              "content-type": "application/octet-stream",
            },
          }),
        );
        signal?.throwIfAborted();
        if (marker.kind === "unknown") {
          const cache = await caches.open(records);
          signal?.throwIfAborted();
          await cache.put(
            recordKey(version),
            new Response(JSON.stringify(pointer), {
              headers: { "content-type": RECORD_CONTENT_TYPE },
            }),
          );
        }
      });
    },

    async read(version) {
      const marker = await readMarker(version);
      if (marker.kind !== "known") {
        return { kind: marker.kind };
      }
      const { pointer } = marker;
      const blob = await readBody(pointer);
      if (blob !== undefined) {
        try {
          return { blob, index: await readIndex(pointer, blob), kind: "ready", pointer };
        } catch {
          // The marker remains authoritative about the archive-backed version.
        }
      }
      return { kind: "unavailable", pointer };
    },
  };
}
