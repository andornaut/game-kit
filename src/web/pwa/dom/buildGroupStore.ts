import {
  BUILD_ARCHIVE_HEADER_BYTES,
  parseBuildArchiveIndex,
  readBuildArchivePrefixSize,
} from "../archive/index.ts";
import {
  BUILD_HASH_HEADER,
  buildArchivePartUrl,
  type BuildArchiveReference,
  buildCacheName,
  type BuildGroupReference,
  type BuildPointer,
  type BuildPolicy,
  GROUP_ARCHIVE_IDENTITY,
  isBuildVersion,
  parseBuildPointer,
  RECORD_CONTENT_TYPE,
  recordsCacheName,
  soundFormatOf,
} from "../index.ts";
import { withBuildStateLock } from "./buildStore.ts";

// The pointer launch installs on this device (buildRecords' installedPointer), so the marker,
// completeness and the router name only the groups of the device's sound format.
type GroupedPointer = BuildPointer & { readonly groups: readonly BuildGroupReference[] };

export interface BuildGroupFile {
  readonly blob: Blob;
  readonly byteSize: number;
  readonly contentType: string;
  readonly offset: number;
}

type GroupMarker =
  | { readonly kind: "unknown" | "unavailable" }
  | { readonly kind: "known"; readonly pointer: GroupedPointer };

export type BuildGroupRead =
  | { readonly kind: "unknown" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "ready"; readonly files: ReadonlyMap<string, BuildGroupFile> };

export interface ActiveGroupFormat {
  mayDiffer(version: string, soundFormat: string | undefined): Promise<boolean>;
  differs(pointer: BuildPointer): Promise<boolean>;
  seal(
    pointer: BuildPointer,
    signal: AbortSignal,
    verify: (files: ReadonlyMap<string, BuildGroupFile>) => Promise<boolean>,
  ): Promise<void>;
}

export interface BuildGroupStore {
  reuse(pointer: BuildPointer, group: BuildArchiveReference): Promise<boolean>;
  // The downloader verifies the full SHA-256 before passing the group here.
  put(
    pointer: BuildPointer,
    group: BuildArchiveReference,
    body: Blob,
    signal?: AbortSignal,
  ): Promise<void>;
  // Writes the marker, replacing one sealed for another sound format. Throws on any other marker.
  seal(pointer: BuildPointer, signal?: AbortSignal): Promise<void>;
  complete(version: string, expected?: BuildPointer): Promise<boolean>;
  // Only an absent marker yields "unknown". Marker I/O errors propagate.
  read(version: string): Promise<BuildGroupRead>;
}

interface CodecAwareGroupStore extends BuildGroupStore {
  readonly activeFormat: ActiveGroupFormat;
  readSound(version: string, path: string): Promise<BuildGroupFile | undefined>;
}

export function activeGroupFormat(
  store: BuildGroupStore | undefined,
): ActiveGroupFormat | undefined {
  // The browser store supports active repair. Injected stores can supply only the install API.
  return (store as Partial<CodecAwareGroupStore> | undefined)?.activeFormat;
}

const GROUP_ID = { buildId: GROUP_ARCHIVE_IDENTITY, version: GROUP_ARCHIVE_IDENTITY };

// The stored form keeps each group's decoded identity and drops its transport, so a build staged
// from either transport, such as by an earlier kit from decoded archives, matches its pointer.
function groupedPointer(value: unknown): GroupedPointer {
  const { buildId, groupedFirstInstall, groups, manifest, schema, version } =
    parseBuildPointer(value);
  if (groups === undefined) {
    throw new TypeError("Missing build groups");
  }
  return {
    buildId,
    ...(groupedFirstInstall === undefined ? {} : { groupedFirstInstall }),
    groups: groups.map(({ byteSize, schema, sha256, soundFormat }) => ({
      byteSize,
      schema,
      sha256,
      ...(soundFormat === undefined ? {} : { soundFormat }),
    })),
    manifest,
    schema,
    version,
  };
}

const sameGroup = (a: BuildGroupReference, b: BuildGroupReference) =>
  a.schema === b.schema &&
  a.byteSize === b.byteSize &&
  a.sha256 === b.sha256 &&
  a.soundFormat === b.soundFormat;

const sameGroups = (a: readonly BuildGroupReference[], b: readonly BuildGroupReference[]) =>
  a.length === b.length && a.every((group, i) => sameGroup(group, b[i]!));

const sameBuild = (a: GroupedPointer, b: BuildPointer) =>
  a.schema === b.schema &&
  a.version === b.version &&
  a.buildId === b.buildId &&
  a.manifest === b.manifest &&
  a.groupedFirstInstall === b.groupedFirstInstall &&
  b.archive === undefined;

function samePointer(a: GroupedPointer, b: BuildPointer): boolean {
  return sameBuild(a, b) && b.groups !== undefined && sameGroups(a.groups, b.groups);
}

const untagged = (pointer: GroupedPointer) =>
  pointer.groups.filter(({ soundFormat }) => soundFormat === undefined);
const formats = (pointer: GroupedPointer) =>
  [...new Set(pointer.groups.flatMap(({ soundFormat }) => soundFormat ?? []))].sort().join(" ");

// A marker sealed for another sound format: the same build and the same groups without a format,
// with groups of other formats. The device's format changed since, so the build is installed again
// for the new one and its marker replaced.
function otherFormat(marker: GroupedPointer, pointer: GroupedPointer): boolean {
  return (
    sameBuild(marker, pointer) &&
    sameGroups(untagged(marker), untagged(pointer)) &&
    formats(marker) !== formats(pointer)
  );
}

function addsSoundFormat(marker: GroupedPointer, pointer: GroupedPointer): boolean {
  return (
    otherFormat(marker, pointer) &&
    pointer.groups.some(
      ({ soundFormat }) =>
        soundFormat !== undefined &&
        !marker.groups.some((group) => group.soundFormat === soundFormat),
    )
  );
}

function member(pointer: GroupedPointer, input: BuildArchiveReference): BuildArchiveReference {
  // A digest names at most one group of a pointer.
  const group = pointer.groups.find(
    ({ byteSize, schema, sha256 }) =>
      schema === input.schema && byteSize === input.byteSize && sha256 === input.sha256,
  );
  if (group === undefined) {
    throw new TypeError("Group does not belong to the build pointer");
  }
  return group;
}

async function groupIndex(blob: Blob) {
  const header = new Uint8Array(await blob.slice(0, BUILD_ARCHIVE_HEADER_BYTES).arrayBuffer());
  const size = readBuildArchivePrefixSize(blob.size, header);
  const prefix = new Uint8Array(await blob.slice(0, size).arrayBuffer());
  return parseBuildArchiveIndex(GROUP_ID, blob.size, prefix);
}

export function createBuildGroupStore({
  caches,
  origin,
  policy,
}: {
  readonly caches: CacheStorage;
  readonly origin: string;
  readonly policy: BuildPolicy;
}): CodecAwareGroupStore {
  if (new URL(origin).origin !== origin) {
    throw new TypeError("Invalid build group store origin");
  }
  const records = recordsCacheName(policy);
  const buildPrefix = buildCacheName(policy, "");
  const groupKey = (group: BuildArchiveReference) => origin + buildArchivePartUrl(group, 0);
  const recordKey = (version: string) => {
    if (!isBuildVersion(version)) {
      throw new TypeError("Invalid build group version");
    }
    return `${origin}/.game-kit/group-record-${encodeURIComponent(version)}.json`;
  };

  const readMarker = async (version: string): Promise<GroupMarker> => {
    const entry = await caches.match(recordKey(version), { cacheName: records });
    if (entry === undefined) {
      return { kind: "unknown" };
    }
    if (entry.status === 200) {
      try {
        const pointer = groupedPointer(await entry.json());
        if (pointer.version === version) {
          return { kind: "known", pointer };
        }
      } catch {
        // A malformed marker is still authoritative about the stored representation.
      }
    }
    return { kind: "unavailable" };
  };

  const readGroup = async (cacheName: string, group: BuildArchiveReference) => {
    try {
      const entry = await caches.match(groupKey(group), { cacheName });
      if (
        entry?.status === 200 &&
        entry.headers.get(BUILD_HASH_HEADER) === group.sha256 &&
        entry.headers.get("content-length") === String(group.byteSize)
      ) {
        const blob = await entry.blob();
        if (blob.size === group.byteSize) {
          return { blob, index: await groupIndex(blob) };
        }
      }
    } catch {
      // Unreadable bodies cannot be used for reuse, sealing, or routing.
    }
    return undefined;
  };

  const writeGroup = async (
    cacheName: string,
    group: BuildArchiveReference,
    body: Blob,
    signal?: AbortSignal,
  ) => {
    const cache = await caches.open(cacheName);
    signal?.throwIfAborted();
    await cache.put(
      groupKey(group),
      new Response(body, {
        headers: {
          [BUILD_HASH_HEADER]: group.sha256,
          "content-length": String(group.byteSize),
          "content-type": "application/octet-stream",
        },
      }),
    );
    signal?.throwIfAborted();
  };

  const readFiles = async (pointer: GroupedPointer) => {
    const cacheName = buildCacheName(policy, pointer.version);
    const files = new Map<string, BuildGroupFile>();
    for (const group of pointer.groups) {
      // Materialize and validate one group at a time.
      // eslint-disable-next-line no-await-in-loop
      const stored = await readGroup(cacheName, group);
      if (stored === undefined) {
        return undefined;
      }
      for (const { byteSize, contentType, offset, url } of stored.index.files) {
        if (files.has(url)) {
          return undefined;
        }
        files.set(url, { blob: stored.blob, byteSize, contentType, offset });
      }
    }
    return files;
  };

  // The version's marker, unless it conflicts with pointer. "replaced": it was sealed for another
  // sound format, so groups are stored beside its own and sealing pointer replaces it.
  const matchingMarker = async (
    pointer: GroupedPointer,
  ): Promise<GroupMarker | { readonly kind: "replaced" }> => {
    const marker = await readMarker(pointer.version);
    if (
      marker.kind === "unknown" ||
      (marker.kind === "known" && samePointer(marker.pointer, pointer))
    ) {
      return marker;
    }
    if (marker.kind === "known" && otherFormat(marker.pointer, pointer)) {
      return { kind: "replaced" };
    }
    throw new TypeError("Conflicting cached build group pointer");
  };

  const writeMarker = async (pointer: GroupedPointer, signal?: AbortSignal) => {
    const cache = await caches.open(records);
    signal?.throwIfAborted();
    // Readers see either complete format. Retain the old groups for existing router snapshots.
    await cache.put(
      recordKey(pointer.version),
      new Response(JSON.stringify(pointer), { headers: { "content-type": RECORD_CONTENT_TYPE } }),
    );
  };

  return {
    activeFormat: {
      async differs(value) {
        const pointer = groupedPointer(value);
        const marker = await readMarker(pointer.version);
        return marker.kind === "known" && addsSoundFormat(marker.pointer, pointer);
      },
      async mayDiffer(version, soundFormat) {
        const marker = await readMarker(version);
        return (
          marker.kind === "known" &&
          (soundFormat === undefined ||
            !marker.pointer.groups.some((group) => group.soundFormat === soundFormat))
        );
      },
      async seal(value, signal, verify) {
        const pointer = groupedPointer(value);
        await withBuildStateLock(policy, async () => {
          signal.throwIfAborted();
          const marker = await readMarker(pointer.version);
          if (marker.kind !== "known" || !addsSoundFormat(marker.pointer, pointer)) {
            return;
          }
          const files = await readFiles(pointer);
          if (files !== undefined && (await verify(files))) {
            await writeMarker(pointer, signal);
          }
        });
      },
    },
    async complete(version, expected) {
      const marker = await readMarker(version);
      return (
        marker.kind === "known" &&
        (expected === undefined || samePointer(marker.pointer, expected)) &&
        (await readFiles(marker.pointer)) !== undefined
      );
    },

    async put(value, reference, body, signal) {
      signal?.throwIfAborted();
      const pointer = groupedPointer(value);
      const group = member(pointer, reference);
      if (body.size !== group.byteSize) {
        throw new RangeError("Build group size does not match the pointer");
      }
      await groupIndex(body);
      await withBuildStateLock(policy, async () => {
        signal?.throwIfAborted();
        await matchingMarker(pointer);
        await writeGroup(buildCacheName(policy, pointer.version), group, body, signal);
      });
    },

    async read(version) {
      const marker = await readMarker(version);
      if (marker.kind === "unknown") {
        return { kind: "unknown" };
      }
      const files = marker.kind === "known" ? await readFiles(marker.pointer) : undefined;
      return files === undefined ? { kind: "unavailable" } : { files, kind: "ready" };
    },
    async readSound(version, path) {
      const format = soundFormatOf(path);
      if (format === undefined) {
        return undefined;
      }
      const marker = await readMarker(version);
      if (marker.kind !== "known") {
        return undefined;
      }
      const groups = marker.pointer.groups.filter(({ soundFormat }) => soundFormat === format);
      if (groups.length === 0) {
        return undefined;
      }
      const files = await readFiles({ ...marker.pointer, groups });
      return files?.get(path);
    },

    async reuse(value, reference) {
      const pointer = groupedPointer(value);
      const group = member(pointer, reference);
      return withBuildStateLock(policy, async () => {
        await matchingMarker(pointer);
        const target = buildCacheName(policy, pointer.version);
        if ((await readGroup(target, group)) !== undefined) {
          return true;
        }
        for (const source of await caches.keys()) {
          if (!source.startsWith(buildPrefix) || source === target) {
            continue;
          }
          // Stop at the first usable group in this game's build caches.
          // eslint-disable-next-line no-await-in-loop
          const stored = await readGroup(source, group);
          if (stored !== undefined) {
            // eslint-disable-next-line no-await-in-loop
            await writeGroup(target, group, stored.blob);
            return true;
          }
        }
        return false;
      });
    },

    async seal(value, signal) {
      signal?.throwIfAborted();
      const pointer = groupedPointer(value);
      await withBuildStateLock(policy, async () => {
        signal?.throwIfAborted();
        const marker = await matchingMarker(pointer);
        if ((await readFiles(pointer)) === undefined) {
          throw new TypeError("Build groups are unavailable or contain duplicate URLs");
        }
        signal?.throwIfAborted();
        if (marker.kind === "known") {
          return;
        }
        await writeMarker(pointer, signal);
      });
    },
  };
}
