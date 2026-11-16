import { createHash } from "node:crypto";

import type { Plugin, ResolvedConfig } from "vite";

import { isBuildId } from "../../build/buildVersion.ts";
import { contentHash } from "../../build/vite/contentHash.ts";
import { gitBuildMetadata } from "../../build/vite/gitHead.ts";
import { cacheKeyFor, type CachePolicy, isHashedAssetUrl } from "../cachePolicy.ts";
import { type PrecacheGroups, validatePrecacheGroups } from "../precacheGroups.ts";
import {
  bundleDependencies,
  type BundleFile,
  PRECACHE_MANIFEST_PLACEHOLDER,
  precacheFingerprint,
  type PrecacheManifest,
  rootRelativeUrls,
  webManifestIconUrls,
} from "../precacheList.ts";
import { encodePrecacheManifest } from "../precacheWire.ts";
import { validateVerifiedJsonBodies } from "../verifiedJsonBody.ts";
import { assertClassicWorker, classicWorker } from "./classicWorker.ts";

// Hashed files the page loads at runtime rather than links, such as a game's art: the URLs to
// precache, and sound files by format, for the worker to store the format the page plays.
export interface HashedFiles {
  readonly sounds: Readonly<Record<string, readonly string[]>>;
  readonly urls: readonly string[];
}

export interface PrecachePluginOptions {
  readonly buildId?: string | undefined;
  // Explicit public, URL-independent JSON families selected from final emitted discovery.
  readonly verifiedJsonBodies?: (files: HashedFiles) => readonly (readonly string[])[];
  // Called on the complete final normalized discovery, including public links and all sounds.
  readonly groups?: (files: HashedFiles) => PrecacheGroups;
  // The hashed files beyond what the page links, read once the bundle is written: bundleFile
  // gives a build output file's bytes by its URL. Throws to fail the build.
  hashedFiles?: (bundleFile: (url: string) => Uint8Array | undefined) => HashedFiles;
  // The game page's file name in the build output, which is its path under Vite's root, e.g.
  // "play/index.html".
  pageHtmlFile: string;
  readonly policy: CachePolicy;
  // The worker entry's source module, as an absolute path. It calls dom/serviceWorker's
  // runServiceWorker with the policy and the GAME_KIT_PRECACHE_MANIFEST it declares.
  serviceWorkerSource: string;
  // The worker's file name in the build output; "sw.js" when unset.
  serviceWorkerFileName?: string;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// Builds the service worker with the game page's precache list written into it: the page, the
// build output it loads, the public files it links, the web app manifest's icons and the hashed
// files hashedFiles names. Sounds are listed apart, by format, for the worker to precache the one
// format the page plays.
export function precachePlugin({
  buildId,
  groups,
  hashedFiles = () => ({ sounds: {}, urls: [] }),
  pageHtmlFile,
  policy,
  serviceWorkerFileName = "sw.js",
  serviceWorkerSource,
  verifiedJsonBodies,
}: PrecachePluginOptions): Plugin {
  let root: string;
  let config: ResolvedConfig;
  const checkIdentity = () => {
    if (!isBuildId(buildId) || gitBuildMetadata(root, process.env).buildId !== buildId) {
      throw new Error("precache: grouped builds require a matching clean source and full buildId");
    }
  };
  return {
    apply:
      groups === undefined
        ? "build"
        : (_config, env) => {
            if (env.command !== "build") {
              throw new Error("precache: grouped precache is unavailable in development");
            }
            return true;
          },
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
      if (groups !== undefined) {
        checkIdentity();
        if (config.define?.__BUILD_ID__ !== JSON.stringify(buildId)) {
          throw new Error("precache: app __BUILD_ID__ must match the grouped worker buildId");
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

        // Each listed file outside the hashed build output, sounds included, by its content: the
        // version changes with any of them, and an install reuses an earlier version's copy of
        // one only where its content is unchanged. A hashed file's name stands for its content.
        const listed = new Map([
          ...contents,
          ...soundUrls.map((url) => [cacheKeyFor(url), requiredBundleBytes(url)] as const),
        ]);
        const sounds = Object.fromEntries(
          Object.entries(hashed.sounds).map(([format, urls]) => [
            format,
            [...new Set(urls.map(cacheKeyFor))],
          ]),
        );
        let grouped: { buildId: string; groups: PrecacheGroups } | undefined;
        const discovery: HashedFiles = Object.freeze({
          sounds: Object.freeze(
            Object.fromEntries(
              Object.entries(sounds).map(([format, urls]) => [format, Object.freeze([...urls])]),
            ),
          ),
          urls: Object.freeze([...contents.keys()].sort()),
        });
        if (groups !== undefined) {
          checkIdentity();
          grouped = {
            buildId: buildId!,
            groups: validatePrecacheGroups([...listed.keys()], groups(discovery)),
          };
        }
        const byteSizes = new Map([...listed].map(([url, bytes]) => [url, bytes.byteLength]));
        const verified =
          verifiedJsonBodies === undefined
            ? undefined
            : validateVerifiedJsonBodies(
                { byteSizes: Object.fromEntries(byteSizes), urls: [...listed.keys()] },
                verifiedJsonBodies(discovery).map((urls) => {
                  const body = listed.get(urls[0] ?? "");
                  if (body === undefined) {
                    throw new Error("precache: missing verified JSON family body");
                  }
                  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
                  for (const url of urls) {
                    const other = listed.get(url);
                    if (
                      other === undefined ||
                      other.byteLength !== body.byteLength ||
                      other.some((byte, i) => byte !== body[i])
                    ) {
                      throw new Error("precache: verified JSON family bodies differ");
                    }
                  }
                  return { byteSize: body.byteLength, sha256: sha256Hex(body), urls };
                }),
              );
        const contentHashes = new Map(
          [...listed]
            .filter(([url]) => grouped !== undefined || !isHashedAssetUrl(policy, url))
            .map(([url, bytes]) => [url, contentHash(bytes)] as const),
        );
        const fingerprint = sha256Hex(
          encoder.encode(
            precacheFingerprint(
              policy,
              new Map([...listed.keys()].map((url) => [url, contentHashes.get(url) ?? ""])),
              byteSizes,
              grouped,
              verified,
            ),
          ),
        );
        const manifest: PrecacheManifest = {
          ...(grouped === undefined ? {} : grouped),
          byteSizes: Object.fromEntries(
            [...byteSizes.keys()].sort().map((url) => [url, byteSizes.get(url)!]),
          ),
          contentHashes: Object.fromEntries(
            [...contentHashes.keys()].sort().map((url) => [url, contentHashes.get(url) ?? ""]),
          ),
          sounds,
          ...(verified === undefined ? {} : { verifiedJsonBodies: verified }),
          urls: [...contents.keys()].sort(),
          version: fingerprint.slice(0, 16),
        };

        const serviceWorker = bundle[serviceWorkerFileName];
        if (
          serviceWorker?.type !== "asset" ||
          typeof serviceWorker.source !== "string" ||
          !serviceWorker.source.includes(PRECACHE_MANIFEST_PLACEHOLDER)
        ) {
          this.error(
            `precache: ${serviceWorkerFileName} has no ${PRECACHE_MANIFEST_PLACEHOLDER} to replace`,
          );
        }
        serviceWorker.source = serviceWorker.source.replaceAll(
          PRECACHE_MANIFEST_PLACEHOLDER,
          JSON.stringify(encodePrecacheManifest(manifest)),
        );
        assertClassicWorker(serviceWorkerFileName, serviceWorker.source);
      },
      order: "post",
    },
    name: "game-kit-precache",
  };
}
