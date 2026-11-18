// The cache layout and records of installed builds (docs/install-and-update.md). One cache per
// build version holds its verified files. The records cache holds active, staged, one pin per
// window client and each build's manifest, each under its own key, so no write overwrites another
// record. Callers write a record only after they have verified what it names. There is no "none"
// value: an absent active, staged or pin has no entry.
//
// Record keys are same-origin absolute URLs: active at /.game-kit/records/active, staged at
// /.game-kit/records/staged and a pin at /.game-kit/records/pin/<encodeURIComponent(clientId)>,
// each with the JSON body {"version": string}; a manifest at buildManifestUrl(version), with the
// BuildManifest JSON as its body. File entries use the same-origin absolute URL of each file.
import {
  BUILD_HASH_HEADER,
  buildCacheName,
  type BuildFile,
  type BuildManifest,
  buildManifestUrl,
  type BuildPolicy,
  type BuildState,
  recordsCacheName,
} from "../buildContract.ts";

const ACTIVE_PATH = "/.game-kit/records/active";
const STAGED_PATH = "/.game-kit/records/staged";
const PIN_PREFIX = "/.game-kit/records/pin/";
const MANIFEST_PATH = /^\/\.game-kit\/manifest-([^/]+)\.json$/;

// How many entries a metadata scan reads at once.
const SCAN_CONCURRENCY = 32;

const SHA256_HEX = /^[a-f0-9]{64}$/;

export interface BuildStore {
  readState(): Promise<BuildState>;
  setActive(version: string): Promise<void>;
  // undefined deletes the staged record.
  setStaged(version: string | undefined): Promise<void>;
  readPin(clientId: string): Promise<string | undefined>;
  writePin(clientId: string, version: string): Promise<void>;
  deletePin(clientId: string): Promise<void>;
  // Every pin, by client id.
  pinnedVersions(): Promise<ReadonlyMap<string, string>>;
  saveManifest(manifest: BuildManifest): Promise<void>;
  readManifest(version: string): Promise<BuildManifest | undefined>;
  // The manifest's files that its build cache lacks, or holds under a different digest header.
  missing(manifest: BuildManifest): Promise<BuildFile[]>;
  complete(manifest: BuildManifest): Promise<boolean>;
  // A stored entry of any build whose digest header is sha256, found through the saved
  // manifests and confirmed by its header.
  findByHash(sha256: string): Promise<Response | undefined>;
  // Stores a verified response, which must carry BUILD_HASH_HEADER, in version's build cache.
  putFile(version: string, url: string, response: Response): Promise<void>;
  // Deletes every build cache, and its manifest record, whose version is neither active, staged
  // nor in liveVersions. Returns the deleted cache names.
  reclaim(liveVersions: Iterable<string>): Promise<string[]>;
}

function assertVersion(version: string): void {
  if (typeof version !== "string" || version === "" || /[\s/]/.test(version)) {
    throw new TypeError(`Invalid build version: ${String(version)}`);
  }
}

function assertClientId(clientId: string): void {
  if (typeof clientId !== "string" || clientId === "") {
    throw new TypeError("Invalid client id");
  }
}

// The path and query of a cache key, which is how files and records are compared.
function keyPath(url: string): string {
  const parsed = new URL(url, "https://key.invalid");
  return parsed.pathname + parsed.search;
}

const versionRecord = (version: string) =>
  new Response(JSON.stringify({ version }), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });

// The version a record names, or undefined for an absent or unreadable record.
async function versionOf(response: Response | undefined): Promise<string | undefined> {
  if (response === undefined) {
    return undefined;
  }
  try {
    const { version } = (await response.json()) as { version?: unknown };
    return typeof version === "string" && version !== "" ? version : undefined;
  } catch {
    return undefined;
  }
}

async function mapBounded<T, R>(
  limit: number,
  task: (item: T) => Promise<R>,
  items: readonly T[],
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      // Each lane takes the next item once its last one is done.
      // eslint-disable-next-line no-await-in-loop
      results[index] = await task(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}

// Checks the shape of a manifest read from a record or the network. Throws TypeError.
export function parseBuildManifest(value: unknown): BuildManifest {
  const manifest = value as BuildManifest;
  if (
    typeof value !== "object" ||
    value === null ||
    manifest.schema !== 1 ||
    typeof manifest.version !== "string" ||
    manifest.version === "" ||
    typeof manifest.buildId !== "string" ||
    !Array.isArray(manifest.files) ||
    typeof manifest.sounds !== "object" ||
    manifest.sounds === null ||
    !Array.isArray(manifest.boot) ||
    (manifest.verifiedJsonBodies !== undefined && !Array.isArray(manifest.verifiedJsonBodies))
  ) {
    throw new TypeError("Invalid build manifest");
  }
  assertVersion(manifest.version);
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
  return manifest;
}

export function createBuildStore(
  context: {
    readonly caches: CacheStorage;
    // The page or worker origin that every key is built from.
    readonly origin: string;
  },
  policy: BuildPolicy,
): BuildStore {
  const { caches, origin } = context;
  if (new URL(origin).origin !== origin) {
    throw new TypeError(`Invalid origin: ${origin}`);
  }
  const keyOf = (path: string) => new URL(path, origin).href;
  const pinKey = (clientId: string) => keyOf(PIN_PREFIX + encodeURIComponent(clientId));
  const recordsName = recordsCacheName(policy);
  const buildPrefix = buildCacheName(policy, "");
  const records = () => caches.open(recordsName);

  const readVersion = async (key: string): Promise<string | undefined> =>
    versionOf(await (await records()).match(key));
  const writeVersion = async (key: string, version: string): Promise<void> => {
    await (await records()).put(key, versionRecord(version));
  };
  const deleteKey = async (key: string): Promise<void> => {
    await (await records()).delete(key);
  };

  const buildVersions = async (): Promise<string[]> =>
    (await caches.keys())
      .filter((name) => name.startsWith(buildPrefix) && name !== recordsName)
      .map((name) => name.slice(buildPrefix.length));

  const readManifest = async (version: string): Promise<BuildManifest | undefined> => {
    assertVersion(version);
    const response = await (await records()).match(keyOf(buildManifestUrl(version)));
    if (response === undefined) {
      return undefined;
    }
    try {
      const manifest = parseBuildManifest(await response.json());
      return manifest.version === version ? manifest : undefined;
    } catch {
      return undefined;
    }
  };

  // sha256 to the build caches and URLs that hold it, built from the saved manifests on first use
  // and rebuilt after a manifest is saved or a build is reclaimed. A stale candidate fails its
  // header check and is skipped.
  let hashIndex: Promise<Map<string, { cacheName: string; url: string }[]>> | undefined;
  const indexByHash = () => {
    hashIndex ??= (async () => {
      const index = new Map<string, { cacheName: string; url: string }[]>();
      const versions = await buildVersions();
      const manifests = await Promise.all(versions.map(readManifest));
      manifests.forEach((manifest, position) => {
        const cacheName = buildPrefix + (versions[position] as string);
        for (const file of manifest?.files ?? []) {
          const candidates = index.get(file.sha256) ?? [];
          candidates.push({ cacheName, url: file.url });
          index.set(file.sha256, candidates);
        }
      });
      return index;
    })();
    hashIndex.catch(() => {
      hashIndex = undefined;
    });
    return hashIndex;
  };

  const missing = async (manifest: BuildManifest): Promise<BuildFile[]> => {
    assertVersion(manifest.version);
    const name = buildCacheName(policy, manifest.version);
    if (!(await caches.has(name))) {
      return [...manifest.files];
    }
    const cache = await caches.open(name);
    const present = new Set((await cache.keys()).map((request) => keyPath(request.url)));
    const absent = await mapBounded(
      SCAN_CONCURRENCY,
      async (file) => {
        if (!present.has(keyPath(file.url))) {
          return true;
        }
        const response = await cache.match(keyOf(file.url));
        return response?.headers.get(BUILD_HASH_HEADER) !== file.sha256;
      },
      manifest.files,
    );
    return manifest.files.filter((_file, index) => absent[index]);
  };

  return {
    complete: async (manifest) => (await missing(manifest)).length === 0,

    deletePin: async (clientId) => {
      assertClientId(clientId);
      await deleteKey(pinKey(clientId));
    },

    findByHash: async (sha256) => {
      if (!SHA256_HEX.test(sha256)) {
        return undefined;
      }
      for (const { cacheName, url } of (await indexByHash()).get(sha256) ?? []) {
        // Candidates are tried in turn, stopping at the first whose header confirms the digest.
        // eslint-disable-next-line no-await-in-loop
        if (await caches.has(cacheName)) {
          // eslint-disable-next-line no-await-in-loop
          const response = await (await caches.open(cacheName)).match(keyOf(url));
          if (response?.headers.get(BUILD_HASH_HEADER) === sha256) {
            return response;
          }
        }
      }
      return undefined;
    },

    missing,

    pinnedVersions: async () => {
      const cache = await records();
      const pins = (await cache.keys())
        .map((request) => keyPath(request.url))
        .filter((path) => path.startsWith(PIN_PREFIX));
      const versions = await Promise.all(
        pins.map(async (path) => versionOf(await cache.match(keyOf(path)))),
      );
      const result = new Map<string, string>();
      pins.forEach((path, index) => {
        const version = versions[index];
        if (version !== undefined) {
          result.set(decodeURIComponent(path.slice(PIN_PREFIX.length)), version);
        }
      });
      return result;
    },

    putFile: async (version, url, response) => {
      assertVersion(version);
      if (!SHA256_HEX.test(response.headers.get(BUILD_HASH_HEADER) ?? "")) {
        throw new TypeError(`A stored build file needs its ${BUILD_HASH_HEADER} header: ${url}`);
      }
      await (await caches.open(buildCacheName(policy, version))).put(keyOf(url), response);
    },

    readManifest,

    readPin: (clientId) => {
      assertClientId(clientId);
      return readVersion(pinKey(clientId));
    },

    readState: async () => {
      const [active, staged] = await Promise.all([
        readVersion(keyOf(ACTIVE_PATH)),
        readVersion(keyOf(STAGED_PATH)),
      ]);
      return {
        ...(active === undefined ? {} : { active }),
        ...(staged === undefined ? {} : { staged }),
      };
    },

    reclaim: async (liveVersions) => {
      const [active, staged] = await Promise.all([
        readVersion(keyOf(ACTIVE_PATH)),
        readVersion(keyOf(STAGED_PATH)),
      ]);
      const kept = new Set<string>(liveVersions);
      for (const version of [active, staged]) {
        if (version !== undefined) {
          kept.add(version);
        }
      }
      const deleted: string[] = [];
      for (const version of await buildVersions()) {
        if (!kept.has(version)) {
          const name = buildPrefix + version;
          // Deletions run in turn so a failure leaves the rest in place.
          // eslint-disable-next-line no-await-in-loop
          await caches.delete(name);
          deleted.push(name);
        }
      }
      const cache = await records();
      const stale = (await cache.keys())
        .map((request) => keyPath(request.url))
        .filter((path) => {
          const version = MANIFEST_PATH.exec(path)?.[1];
          return version !== undefined && !kept.has(decodeURIComponent(version));
        });
      await Promise.all(stale.map((path) => cache.delete(keyOf(path))));
      hashIndex = undefined;
      return deleted;
    },

    saveManifest: async (manifest) => {
      parseBuildManifest(manifest);
      await (
        await records()
      ).put(
        keyOf(buildManifestUrl(manifest.version)),
        new Response(JSON.stringify(manifest), {
          headers: { "content-type": "application/json; charset=utf-8" },
        }),
      );
      hashIndex = undefined;
    },

    setActive: async (version) => {
      assertVersion(version);
      await writeVersion(keyOf(ACTIVE_PATH), version);
    },

    setStaged: async (version) => {
      if (version === undefined) {
        await deleteKey(keyOf(STAGED_PATH));
        return;
      }
      assertVersion(version);
      await writeVersion(keyOf(STAGED_PATH), version);
    },

    writePin: async (clientId, version) => {
      assertClientId(clientId);
      assertVersion(version);
      await writeVersion(pinKey(clientId), version);
    },
  };
}
