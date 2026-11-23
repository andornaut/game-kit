import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

import type { Plugin, ResolvedConfig } from "vite";

import { isBuildId } from "../../build/buildVersion.ts";
import { contentHash } from "../../build/vite/contentHash.ts";
import { gitBuildMetadata } from "../../build/vite/gitHead.ts";
import { encodeBuildArchiveIndex } from "../buildArchive.ts";
import {
  BUILD_ARCHIVE_PART_BYTES,
  BUILD_POINTER_URL,
  buildArchivePartUrl,
  type BuildArchiveReference,
  type BuildManifest,
  buildManifestUrl,
  type BuildPack,
} from "../buildContract.ts";
import { createBuildManifest, createBuildPointer, UNKNOWN_BUILD_ID } from "../buildManifest.ts";
import { packContentType, soundFormatOf } from "../buildRecords.ts";
import { cacheKeyFor, type CachePolicy, isHashedAssetUrl } from "../cachePolicy.ts";
import {
  bundleDependencies,
  type BundleFile,
  precacheFingerprint,
  rootRelativeUrls,
  webManifestIconUrls,
} from "../precacheList.ts";
import { validateVerifiedJsonBodies } from "../verifiedJsonBody.ts";
import { classicWorker } from "./classicWorker.ts";

// Hashed files the page loads at runtime rather than links, such as a game's art: the URLs to
// precache, and each sound's logical URL mapped to its format alternatives' URLs. Each
// alternative's URL extension names its format, and the page installs only the alternatives in
// the format it plays (dom/launch's soundFormat).
export interface HashedFiles {
  readonly sounds: Readonly<Record<string, readonly string[]>>;
  readonly urls: readonly string[];
}

export type VerifiedJsonFamilySelection =
  | readonly string[]
  | {
      readonly urls: readonly string[];
      readonly responseProfile: "fetch-json-data-v1";
    };

export interface PrecachePluginOptions {
  // The full source commit the build is made from (web/build/buildVersion's BuildMetadata). When
  // set, the build fails unless it matches clean Git source and the app's __BUILD_ID__ define.
  // The manifest records UNKNOWN_BUILD_ID when unset.
  readonly buildId?: string | undefined;
  // The files the game reads while booting after install, selected from the final discovery
  // like verifiedJsonBodies. None when unset.
  readonly boot?: (files: HashedFiles) => readonly string[];
  // Opt in to transport packs with an explicit raw byte ceiling per pack.
  readonly packs?: { readonly maxBytes: number };
  // Emit a whole-build archive alongside the files and manifest used by earlier installers.
  readonly wholeBuild?: true;
  // Explicit public, URL-independent JSON families selected from final emitted discovery.
  readonly verifiedJsonBodies?: (files: HashedFiles) => readonly VerifiedJsonFamilySelection[];
  // The hashed files beyond what the page links, read once the bundle is written: bundleFile
  // gives a build output file's bytes by its URL. Throws to fail the build.
  hashedFiles?: (bundleFile: (url: string) => Uint8Array | undefined) => HashedFiles;
  // The game page's file name in the build output, which is its path under Vite's root, e.g.
  // "play/index.html".
  pageHtmlFile: string;
  readonly policy: CachePolicy;
  // The worker entry's source module, as an absolute path. It calls dom/serviceWorker's
  // runServiceWorker with the policy.
  serviceWorkerSource: string;
  // The worker's file name in the build output; "sw.js" when unset.
  serviceWorkerFileName?: string;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const ARCHIVE_CONTENT_TYPES = new Map([
  ["bin", "application/octet-stream"],
  ["css", "text/css; charset=utf-8"],
  ["gif", "image/gif"],
  ["htm", "text/html; charset=utf-8"],
  ["html", "text/html; charset=utf-8"],
  ["ico", "image/vnd.microsoft.icon"],
  ["js", "text/javascript; charset=utf-8"],
  ["mjs", "text/javascript; charset=utf-8"],
  ["otf", "font/otf"],
  ["ttf", "font/ttf"],
  ["wasm", "application/wasm"],
  ["webmanifest", "application/manifest+json"],
  ["woff", "font/woff"],
  ["woff2", "font/woff2"],
]);

function archiveContentType(url: string): string {
  // Cache keys ending in / are the canonical URLs for index.html files.
  const path = url.toLowerCase();
  const extension = path.endsWith("/") ? "html" : soundFormatOf(path);
  const contentType = ARCHIVE_CONTENT_TYPES.get(extension ?? "") ?? packContentType(path);
  if (contentType === undefined) {
    throw new TypeError(`Unknown build archive content type for ${url}`);
  }
  return contentType;
}

function archiveFiles(
  manifest: BuildManifest,
  listed: ReadonlyMap<string, Uint8Array>,
): { archive: BuildArchiveReference; parts: Uint8Array[] } {
  const prefix = encodeBuildArchiveIndex({
    buildId: manifest.buildId,
    files: manifest.files.map(({ byteSize, url }) => [url, byteSize, archiveContentType(url)]),
    version: manifest.version,
  });
  const byteSize = manifest.files.reduce((size, file) => size + file.byteSize, prefix.byteLength);
  const hash = createHash("sha256");
  const parts: Uint8Array[] = [];
  let offset = 0;
  for (const bytes of [prefix, ...manifest.files.map(({ url }) => listed.get(url)!)]) {
    hash.update(bytes);
    for (let start = 0; start < bytes.byteLength;) {
      const index = Math.floor(offset / BUILD_ARCHIVE_PART_BYTES);
      const partOffset = offset % BUILD_ARCHIVE_PART_BYTES;
      let part = parts[index];
      if (part === undefined) {
        part = new Uint8Array(Math.min(BUILD_ARCHIVE_PART_BYTES, byteSize - offset));
        parts.push(part);
      }
      const length = Math.min(bytes.byteLength - start, part.byteLength - partOffset);
      part.set(bytes.subarray(start, start + length), partOffset);
      start += length;
      offset += length;
    }
  }
  return { archive: { byteSize, schema: 1, sha256: hash.digest("hex") }, parts };
}

function packFiles(
  maxBytes: number,
  sounds: HashedFiles["sounds"],
  excluded: ReadonlySet<string>,
  contents: ReadonlyMap<string, Uint8Array>,
  digests: ReadonlyMap<string, string>,
): { pack: BuildPack; source: Uint8Array }[] {
  const alternatives = new Set(Object.values(sounds).flat());
  const groups = new Map<string, string[]>();
  for (const url of [...contents.keys()].sort()) {
    const size = contents.get(url)!.byteLength;
    if (size === 0 || size > maxBytes || excluded.has(url) || packContentType(url) === undefined) {
      continue;
    }
    // Keep sound alternatives in packs that can be dropped together for another format.
    const key = alternatives.has(url) ? `sound:${soundFormatOf(url)}` : "files";
    const group = groups.get(key) ?? [];
    group.push(url);
    groups.set(key, group);
  }
  const packs: { pack: BuildPack; source: Uint8Array }[] = [];
  const add = (members: string[]) => {
    if (members.length > 1) {
      const decoded = Buffer.concat(members.map((url) => contents.get(url)!));
      const source = gzipSync(decoded, { level: 9 });
      if (source.byteLength >= decoded.byteLength) {
        return;
      }
      // The gzip header does not need the producer's operating-system identifier.
      source[9] = 255;
      const identity = JSON.stringify([
        sha256Hex(source),
        members.map((url) => [url, digests.get(url)]),
      ]);
      const digest = sha256Hex(new TextEncoder().encode(identity));
      packs.push({
        pack: {
          encodedByteSize: source.byteLength,
          encoding: "gzip",
          members,
          url: `/.game-kit/pack-${digest}.bin`,
        },
        source,
      });
    }
  };
  for (const group of groups.values()) {
    let members: string[] = [];
    let bytes = 0;
    for (const url of group) {
      const size = contents.get(url)!.byteLength;
      if (size > maxBytes - bytes) {
        add(members);
        members = [];
        bytes = 0;
      }
      members.push(url);
      bytes += size;
    }
    add(members);
  }
  return packs;
}

// Builds the service worker as one self-contained classic script, and writes the build's
// manifest and pointer into the build output. The manifest, at buildManifestUrl(version), lists
// every file the complete build needs offline with its full SHA-256 and byte size: the page, the
// build output it loads, the public files it links, the web app manifest's icons and the hashed
// files hashedFiles names, every sound alternative included; the page installs the alternatives
// of one format. The pointer, at BUILD_POINTER_URL, names the current version, its buildId and
// its manifest URL. The version changes with any listed file's content and with the buildId,
// sounds or boot files.
//
// Games must serve BUILD_POINTER_URL (/.game-kit/build.json) with Cache-Control: no-store, so
// every launch and resume reads the deployed build, and every /.game-kit/manifest-<version>.json
// as immutable (Cache-Control: public, max-age=31536000, immutable), since a version names one
// manifest's content.
export function precachePlugin({
  boot,
  buildId,
  hashedFiles = () => ({ sounds: {}, urls: [] }),
  packs,
  pageHtmlFile,
  policy,
  serviceWorkerFileName = "sw.js",
  serviceWorkerSource,
  verifiedJsonBodies,
  wholeBuild,
}: PrecachePluginOptions): Plugin {
  if (wholeBuild === true && packs !== undefined) {
    throw new TypeError("precache: wholeBuild and packs cannot be used together");
  }
  if (packs !== undefined && (!Number.isSafeInteger(packs.maxBytes) || packs.maxBytes < 1)) {
    throw new RangeError("precache: packs.maxBytes must be a positive safe integer");
  }
  let root: string;
  let config: ResolvedConfig;
  const checkIdentity = () => {
    if (!isBuildId(buildId) || gitBuildMetadata(root, process.env).buildId !== buildId) {
      throw new Error("precache: buildId requires a matching clean source and full buildId");
    }
  };
  return {
    apply: "build",
    async buildStart() {
      const worker = await classicWorker(config, serviceWorkerFileName, serviceWorkerSource);
      for (const file of worker.watchFiles) {
        this.addWatchFile(file);
      }
      this.emitFile({ fileName: serviceWorkerFileName, source: worker.code, type: "asset" });
    },
    configResolved(resolved) {
      config = resolved;
      root = config.root;
      if (buildId !== undefined) {
        checkIdentity();
        if (config.define?.__BUILD_ID__ !== JSON.stringify(buildId)) {
          throw new Error("precache: app __BUILD_ID__ must match the precache buildId");
        }
      }
    },
    enforce: "post",
    generateBundle: {
      async handler(_options, bundle) {
        const { publicDir } = this.environment.config;
        const encoder = new TextEncoder();
        const decoder = new TextDecoder();
        const bundleBytes = (url: string): Uint8Array | undefined => {
          const file = bundle[url.slice(1)];
          if (file === undefined) {
            return undefined;
          }
          const content = file.type === "chunk" ? file.code : file.source;
          return typeof content === "string" ? encoder.encode(content) : content;
        };
        const requiredBundleBytes = (url: string): Uint8Array => {
          const bytes = bundleBytes(url);
          if (bytes === undefined) {
            return this.error(`precache: ${url} is not in the build output`);
          }
          return bytes;
        };
        // A linked public file or manifest icon the build cannot read would leave the offline page
        // incomplete, so it fails the build: a missing file as absent from the public directory,
        // any other read error with its own code and message.
        const readPublicFile = async (url: string): Promise<Uint8Array> => {
          try {
            return await this.fs.readFile(`${publicDir}${url}`);
          } catch (error) {
            const { code, message } = error as NodeJS.ErrnoException;
            if (code === "ENOENT") {
              return this.error(`precache: ${url} is not in ${publicDir}`);
            }
            const detail =
              code === undefined || message.startsWith(`${code}:`)
                ? message
                : `${code}: ${message}`;
            return this.error(`precache: cannot read ${url} in ${publicDir}: ${detail}`);
          }
        };

        const pageHtml = bundleBytes(`/${pageHtmlFile}`);
        if (pageHtml === undefined) {
          this.error(`precache: ${pageHtmlFile} is not in the build output`);
        }
        const pageUrls = rootRelativeUrls(decoder.decode(pageHtml));
        const bundleUrls = bundleDependencies(
          bundle as Readonly<Record<string, BundleFile>>,
          pageUrls.map((url) => url.slice(1)),
        ).map((fileName) => `/${fileName}`);
        const contents = new Map<string, Uint8Array>([[cacheKeyFor(`/${pageHtmlFile}`), pageHtml]]);
        for (const url of bundleUrls) {
          contents.set(cacheKeyFor(url), requiredBundleBytes(url));
        }

        let hashed: HashedFiles = { sounds: {}, urls: [] };
        try {
          hashed = hashedFiles(bundleBytes);
        } catch (error) {
          this.error(`precache: ${(error as Error).message}`);
        }
        const soundUrls = Object.values(hashed.sounds).flat();
        const missing = [...hashed.urls, ...soundUrls].filter((url) => !(url.slice(1) in bundle));
        if (missing.length > 0) {
          this.error(`precache: ${missing.join(", ")} are named but not in the build output`);
        }
        for (const url of hashed.urls) {
          contents.set(cacheKeyFor(url), requiredBundleBytes(url));
        }

        // The public files the page links, and the icons each web app manifest names, read from
        // the build output where a plugin wrote them there (hashedIconsPlugin's manifest and
        // hashed icons) and otherwise from the public directory. The loop also visits the URLs
        // pushed onto linkedUrls while it runs.
        const linkedUrls = pageUrls.filter(
          (url) => !(url.slice(1) in bundle) || url.endsWith(".webmanifest"),
        );
        for (const url of linkedUrls) {
          if (contents.has(cacheKeyFor(url)) && !url.endsWith(".webmanifest")) {
            continue;
          }
          // Each file's references are only known once it is read, so reads run one at a time.
          // eslint-disable-next-line no-await-in-loop
          const bytes = bundleBytes(url) ?? (await readPublicFile(url));
          contents.set(cacheKeyFor(url), bytes);
          if (url.endsWith(".webmanifest")) {
            const icons = webManifestIconUrls(JSON.parse(decoder.decode(bytes)));
            linkedUrls.push(...icons.filter((icon) => !linkedUrls.includes(icon)));
          }
        }

        // Every listed file, sound alternatives included, by its content.
        const listed = new Map([
          ...contents,
          ...soundUrls.map((url) => [cacheKeyFor(url), requiredBundleBytes(url)] as const),
        ]);
        const sounds = Object.fromEntries(
          Object.entries(hashed.sounds)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([logical, urls]) => [logical, [...new Set(urls.map(cacheKeyFor))]]),
        );
        const discovery: HashedFiles = Object.freeze({
          sounds: Object.freeze(
            Object.fromEntries(
              Object.entries(sounds).map(([logical, urls]) => [logical, Object.freeze([...urls])]),
            ),
          ),
          urls: Object.freeze([...contents.keys()].sort()),
        });
        if (buildId !== undefined) {
          checkIdentity();
        }
        const byteSizes = new Map([...listed].map(([url, bytes]) => [url, bytes.byteLength]));
        const sha256s = new Map([...listed].map(([url, bytes]) => [url, sha256Hex(bytes)]));
        const bootUrls = [...(boot?.(discovery) ?? [])];
        const verified =
          verifiedJsonBodies === undefined
            ? undefined
            : validateVerifiedJsonBodies(
                { byteSizes: Object.fromEntries(byteSizes), urls: [...listed.keys()] },
                verifiedJsonBodies(discovery).map((selection) => {
                  const descriptor = Array.isArray(selection)
                    ? undefined
                    : (selection as Exclude<VerifiedJsonFamilySelection, readonly string[]>);
                  const urls = descriptor?.urls ?? (selection as readonly string[]);
                  const body = listed.get(urls[0] ?? "");
                  if (body === undefined) {
                    throw new Error("precache: missing verified JSON family body");
                  }
                  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
                  for (const url of urls) {
                    if (sha256s.get(url) !== sha256s.get(urls[0]!)) {
                      throw new Error("precache: verified JSON family bodies differ");
                    }
                  }
                  return {
                    byteSize: body.byteLength,
                    ...(descriptor === undefined
                      ? {}
                      : { responseProfile: descriptor.responseProfile }),
                    sha256: sha256s.get(urls[0]!)!,
                    urls,
                  };
                }),
              );
        const packAssets =
          packs === undefined
            ? []
            : packFiles(
                packs.maxBytes,
                sounds,
                new Set(verified?.flatMap((family) => family.urls)),
                listed,
                sha256s,
              );
        const packIndex = packAssets.map(({ pack }) => pack);
        const recordedBuildId = buildId ?? UNKNOWN_BUILD_ID;
        // Hashed build output contributes its name and size, as its name changes with its content.
        const contentHashes = new Map(
          [...listed].map(([url, bytes]) => [
            url,
            isHashedAssetUrl(policy, url) ? "" : contentHash(bytes),
          ]),
        );
        const identity = JSON.stringify({
          boot: bootUrls,
          buildId: recordedBuildId,
          ...(packIndex.length === 0 ? {} : { packs: packIndex }),
          sounds,
          ...(wholeBuild === true ? { wholeBuild } : {}),
        });
        const fingerprint = `${precacheFingerprint(policy, contentHashes, byteSizes, verified)}\n${identity}`;

        const createManifest = (): BuildManifest => {
          try {
            return createBuildManifest({
              boot: bootUrls,
              buildId: recordedBuildId,
              files: [...listed.keys()].map((url) => ({
                byteSize: byteSizes.get(url)!,
                sha256: sha256s.get(url)!,
                url,
              })),
              ...(packIndex.length === 0 ? {} : { packs: packIndex }),
              sounds,
              version: sha256Hex(encoder.encode(fingerprint)).slice(0, 16),
              ...(verified === undefined ? {} : { verifiedJsonBodies: verified }),
            });
          } catch (error) {
            return this.error(`precache: ${(error as Error).message}`);
          }
        };
        const manifest = createManifest();
        let archive: ReturnType<typeof archiveFiles> | undefined;
        if (wholeBuild === true) {
          try {
            archive = archiveFiles(manifest, listed);
          } catch (error) {
            this.error(`precache: ${(error as Error).message}`);
          }
        }
        const archiveAssets =
          archive?.parts.map((source, index) => ({
            fileName: buildArchivePartUrl(archive.archive, index).slice(1),
            source,
            type: "asset" as const,
          })) ?? [];
        const manifestFileName = buildManifestUrl(manifest.version).slice(1);
        const pointerFileName = BUILD_POINTER_URL.slice(1);
        for (const fileName of [
          manifestFileName,
          pointerFileName,
          ...packIndex.map(({ url }) => url.slice(1)),
          ...archiveAssets.map(({ fileName }) => fileName),
        ]) {
          if (fileName in bundle) {
            this.error(`precache: ${fileName} is reserved for the build manifest`);
          }
        }
        for (const { pack, source } of packAssets) {
          this.emitFile({
            fileName: pack.url.slice(1),
            source,
            type: "asset",
          });
        }
        for (const asset of archiveAssets) {
          this.emitFile(asset);
        }
        this.emitFile({
          fileName: manifestFileName,
          source: JSON.stringify(manifest),
          type: "asset",
        });
        this.emitFile({
          fileName: pointerFileName,
          source: JSON.stringify({
            ...createBuildPointer(manifest),
            ...(archive === undefined ? {} : { archive: archive.archive }),
          }),
          type: "asset",
        });
      },
      order: "post",
    },
    name: "game-kit-precache",
  };
}
