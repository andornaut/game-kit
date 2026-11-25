import type { Plugin, ResolvedConfig } from "vite";

import { isBuildId } from "../../build/buildVersion.ts";
import { contentHash } from "../../build/vite/contentHash.ts";
import { gitBuildMetadata } from "../../build/vite/gitHead.ts";
import type { BuildArchiveFile } from "../archive/buildArchive.ts";
import { parseUpdateGroupRecipes, type UpdateGroupRecipes } from "../archive/buildGroupRecipes.ts";
import {
  BUILD_ARCHIVE_PART_BYTES,
  BUILD_POINTER_URL,
  buildArchivePartUrl,
  type BuildGroupReference,
  buildGroupUrl,
  type BuildManifest,
  buildManifestUrl,
  type BuildPack,
  type BuildPointer,
  GROUP_ARCHIVE_IDENTITY,
  MAX_UPDATE_UNITS,
  updateGroupRecipesPath,
} from "../buildContract.ts";
import {
  createBuildManifest,
  createBuildPointer,
  UNKNOWN_BUILD_ID,
  validateBuildPointer,
} from "../buildManifest.ts";
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
import { archiveFiles, deterministicGzip, sha256Hex } from "./buildArchiveFiles.ts";
import { classicWorker } from "./classicWorker.ts";
import { encodeGroupArchive } from "./groupArchive.ts";

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
  // Emit a whole-build archive alongside the current first-install files and manifest.
  readonly wholeBuild?: true;
  // Assign each canonical offline URL to a stable update group. Sound alternatives of each format
  // form their own group under that name, tagged with the format.
  readonly updateGroup?: (url: string) => string;
  // Install from the prebuilt groups and omit selected logical URLs from the loose output.
  readonly groupedFirstInstall?: { readonly archiveOnly: (url: string) => boolean };
  // Use a versioned reconstruction recipe as the hosted update group transport.
  readonly emitUpdateGroupRecipes?: true;
  // Omit the decoded archive-<sha256>-0.bin copy of each compressed group, which only pages on
  // GameKit 0.72.0 and earlier read. Set once no live client predates the compressed transport.
  // Requires updateGroup without emitUpdateGroupRecipes.
  readonly omitDecodedGroupCopies?: true;
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

// Sound alternatives split from their named group by format, so a device downloads only its own
// format's sound bytes (buildRecords' installedPointer). Static groups carry a gzip transport;
// recipe groups keep the decoded archive as their transport, which the origin assembles.
function groupedArchives(
  updateGroup: NonNullable<PrecachePluginOptions["updateGroup"]>,
  alternatives: ReadonlySet<string>,
  listed: ReadonlyMap<string, Uint8Array>,
  compressed: boolean,
): {
  archive: BuildGroupReference;
  decoded: Uint8Array;
  encoded?: Uint8Array;
  files: readonly BuildArchiveFile[];
}[] {
  // Keyed by the name, then a space and the sound format. Names contain no space.
  const groups = new Map<string, { soundFormat?: string; urls: string[] }>();
  for (const url of [...listed.keys()].sort()) {
    const id = updateGroup(url);
    if (typeof id !== "string" || !id || /[^A-Za-z0-9._:-]/.test(id)) {
      throw new TypeError(
        `updateGroup(${JSON.stringify(url)}) must return a nonempty group identifier ` +
          "using letters, digits, '.', '_', ':', or '-'",
      );
    }
    const soundFormat = alternatives.has(url) ? soundFormatOf(url) : undefined;
    const key = soundFormat === undefined ? id : `${id} ${soundFormat}`;
    const group = groups.get(key) ?? {
      ...(soundFormat === undefined ? {} : { soundFormat }),
      urls: [],
    };
    group.urls.push(url);
    groups.set(key, group);
  }
  if (groups.size > MAX_UPDATE_UNITS) {
    throw new RangeError(
      `updateGroup selected ${groups.size} groups, counting each sound format separately. ` +
        `Combine groups to stay at or below ${MAX_UPDATE_UNITS}`,
    );
  }
  const identity = { buildId: GROUP_ARCHIVE_IDENTITY, version: GROUP_ARCHIVE_IDENTITY };
  return [...groups.keys()].sort().map((key) => {
    const { soundFormat, urls } = groups.get(key)!;
    try {
      if (compressed) {
        const { archive, encoded, files, group } = encodeGroupArchive(
          soundFormat === undefined ? {} : { soundFormat },
          urls.map((url) => ({ bytes: listed.get(url)!, url })),
        );
        return { archive: group, decoded: archive, encoded, files };
      }
      const { archive, files, parts } = archiveFiles(
        identity,
        listed,
        urls,
        BUILD_ARCHIVE_PART_BYTES,
      );
      return {
        archive: { ...archive, ...(soundFormat === undefined ? {} : { soundFormat }) },
        decoded: parts[0]!,
        files,
      };
    } catch (error) {
      throw new TypeError(`update group ${JSON.stringify(key)}: ${(error as Error).message}`, {
        cause: error,
      });
    }
  });
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
      const source = deterministicGzip(decoded);
      if (source.byteLength >= decoded.byteLength) {
        return;
      }
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
  emitUpdateGroupRecipes,
  groupedFirstInstall,
  hashedFiles = () => ({ sounds: {}, urls: [] }),
  omitDecodedGroupCopies,
  packs,
  pageHtmlFile,
  policy,
  serviceWorkerFileName = "sw.js",
  serviceWorkerSource,
  updateGroup,
  verifiedJsonBodies,
  wholeBuild,
}: PrecachePluginOptions): Plugin {
  if (packs !== undefined && (!Number.isSafeInteger(packs.maxBytes) || packs.maxBytes < 1)) {
    throw new RangeError("precache: packs.maxBytes must be a positive safe integer");
  }
  if (groupedFirstInstall !== undefined) {
    if (updateGroup === undefined) {
      throw new TypeError("precache: groupedFirstInstall requires updateGroup");
    }
    if (packs !== undefined || emitUpdateGroupRecipes === true || wholeBuild === true) {
      throw new TypeError(
        "precache: groupedFirstInstall cannot be combined with packs, emitUpdateGroupRecipes or wholeBuild",
      );
    }
  }
  if (updateGroup !== undefined && wholeBuild === true) {
    throw new TypeError("precache: choose updateGroup or wholeBuild");
  }
  if (emitUpdateGroupRecipes === true && updateGroup === undefined) {
    throw new TypeError("precache: emitUpdateGroupRecipes requires updateGroup");
  }
  if (
    omitDecodedGroupCopies === true &&
    (updateGroup === undefined || emitUpdateGroupRecipes === true)
  ) {
    throw new TypeError(
      "precache: omitDecodedGroupCopies requires updateGroup without emitUpdateGroupRecipes",
    );
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
        if (updateGroup === undefined && wholeBuild !== true && listed.size > MAX_UPDATE_UNITS) {
          this.error(
            `precache: specific-file updates list ${listed.size} files. Reduce the list to ` +
              `${MAX_UPDATE_UNITS} files or provide updateGroup`,
          );
        }
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
        let grouped: ReturnType<typeof groupedArchives> | undefined;
        if (updateGroup !== undefined) {
          try {
            grouped = groupedArchives(
              updateGroup,
              new Set(Object.values(sounds).flat()),
              listed,
              emitUpdateGroupRecipes !== true,
            );
          } catch (error) {
            this.error(`precache: ${(error as Error).message}`);
          }
        }
        const groups = grouped?.map(({ archive }) => archive);
        // A group's decoded archive names it, so the version stays independent of its transport.
        const groupIdentities = groups?.map(({ byteSize, schema, sha256, soundFormat }) => ({
          byteSize,
          schema,
          sha256,
          ...(soundFormat === undefined ? {} : { soundFormat }),
        }));
        const archiveOnlyUrls: string[] = [];
        if (groupedFirstInstall !== undefined) {
          const directUrls = new Set(
            [...pageUrls, ...linkedUrls, `/${pageHtmlFile}`, `/${serviceWorkerFileName}`].map(
              cacheKeyFor,
            ),
          );
          // Find the direct closure of all emitted entry pages, excluding lazy imports.
          const staticBundle: Record<string, BundleFile> = Object.create(null);
          const entryFiles: string[] = [];
          for (const [fileName, file] of Object.entries(bundle)) {
            if (file.type === "chunk") {
              staticBundle[fileName] = {
                imports: file.imports,
                type: file.type,
                ...(file.viteMetadata === undefined ? {} : { viteMetadata: file.viteMetadata }),
              };
              if (file.isEntry) {
                entryFiles.push(fileName);
              }
            } else {
              staticBundle[fileName] = { type: file.type };
              if (fileName.endsWith(".html")) {
                directUrls.add(cacheKeyFor(`/${fileName}`));
                const html =
                  typeof file.source === "string" ? file.source : decoder.decode(file.source);
                for (const url of rootRelativeUrls(html)) {
                  directUrls.add(cacheKeyFor(url));
                }
              }
            }
          }
          const staticFiles = bundleDependencies(staticBundle, [
            ...entryFiles,
            ...[...directUrls].map((url) => url.slice(1)),
          ]);
          for (const fileName of staticFiles) {
            directUrls.add(cacheKeyFor(`/${fileName}`));
          }

          for (const url of [...listed.keys()].sort()) {
            if (!groupedFirstInstall.archiveOnly(url)) {
              continue;
            }
            if (directUrls.has(url)) {
              this.error(`precache: groupedFirstInstall must serve bootstrap URL ${url} directly`);
            }
            const fileName = url.slice(1);
            if (!Object.hasOwn(bundle, fileName)) {
              this.error(
                `precache: groupedFirstInstall cannot prune ${url} outside the Rollup output`,
              );
            }
            archiveOnlyUrls.push(url);
          }
          if (publicDir && config.build.copyPublicDir) {
            await Promise.all(
              archiveOnlyUrls.map(async (url) => {
                try {
                  await this.fs.lstat(`${publicDir}${url}`);
                } catch (error) {
                  if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                    return;
                  }
                  throw error;
                }
                this.error(
                  `precache: groupedFirstInstall cannot prune ${url} also copied from publicDir`,
                );
              }),
            );
          }
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
          ...(groupedFirstInstall === undefined ? {} : { archiveOnly: archiveOnlyUrls }),
          boot: bootUrls,
          buildId: recordedBuildId,
          ...(groupedFirstInstall === undefined ? {} : { groupedFirstInstall: true }),
          ...(groupIdentities === undefined ? {} : { groups: groupIdentities }),
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
            archive = archiveFiles(
              manifest,
              listed,
              manifest.files.map(({ url }) => url),
            );
          } catch (error) {
            this.error(`precache: ${(error as Error).message}`);
          }
        }
        const updateAssets = [
          ...(archive?.parts.map((source, index) => ({
            fileName: buildArchivePartUrl(archive.archive, index).slice(1),
            source,
            type: "asset" as const,
          })) ?? []),
        ];
        if (emitUpdateGroupRecipes === true && grouped !== undefined) {
          const recipes: UpdateGroupRecipes = {
            groups: grouped.map(({ archive, files }) => ({
              archive,
              files: files.map(([url, byteSize, contentType]) => [
                url,
                byteSize,
                contentType,
                sha256s.get(url)!,
              ]),
            })),
            schema: 1,
          };
          updateAssets.push({
            fileName: updateGroupRecipesPath(manifest.version).slice(1),
            source: encoder.encode(JSON.stringify(parseUpdateGroupRecipes(recipes))),
            type: "asset",
          });
        } else if (grouped !== undefined) {
          for (const { archive, decoded, encoded } of grouped) {
            updateAssets.push({
              fileName: buildGroupUrl(archive).slice(1),
              source: encoded!,
              type: "asset",
            });
            // CLEANUP (added 2026-11-25): pages on GameKit 0.72.0 and earlier stage groups only
            // from the decoded archive at this path. A game sets omitDecodedGroupCopies once its
            // installed devices have staged a build from GameKit 0.73.0 or later. Remove this copy
            // and the option, in a minor release, once every grouped game sets it.
            if (omitDecodedGroupCopies !== true) {
              updateAssets.push({
                fileName: buildArchivePartUrl(archive, 0).slice(1),
                source: decoded,
                type: "asset",
              });
            }
          }
        }
        const manifestFileName = buildManifestUrl(manifest.version).slice(1);
        const pointerFileName = BUILD_POINTER_URL.slice(1);
        for (const fileName of [
          manifestFileName,
          pointerFileName,
          ...packIndex.map(({ url }) => url.slice(1)),
          ...updateAssets.map(({ fileName }) => fileName),
        ]) {
          if (fileName in bundle) {
            this.error(`precache: ${fileName} is reserved for the build manifest`);
          }
        }
        for (const url of archiveOnlyUrls) {
          delete bundle[url.slice(1)];
        }
        for (const { pack, source } of packAssets) {
          this.emitFile({
            fileName: pack.url.slice(1),
            source,
            type: "asset",
          });
        }
        for (const asset of updateAssets) {
          this.emitFile(asset);
        }
        this.emitFile({
          fileName: manifestFileName,
          source: JSON.stringify(manifest),
          type: "asset",
        });
        let pointer: BuildPointer | undefined;
        try {
          pointer = validateBuildPointer({
            ...createBuildPointer(manifest),
            ...(archive === undefined ? {} : { archive: archive.archive }),
            ...(groupedFirstInstall === undefined ? {} : { groupedFirstInstall: true }),
            ...(groups === undefined ? {} : { groups }),
          });
        } catch (error) {
          this.error(`precache: ${(error as Error).message}`);
        }
        this.emitFile({
          fileName: pointerFileName,
          source: JSON.stringify(pointer),
          type: "asset",
        });
      },
      order: "post",
    },
    name: "game-kit-precache",
  };
}
