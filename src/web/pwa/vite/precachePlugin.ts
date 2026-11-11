import { createHash } from "node:crypto";

import type { Plugin } from "vite";

import { contentHash } from "../../build/vite/contentHash.ts";
import { cacheKeyFor, type CachePolicy, isHashedAssetUrl } from "../cachePolicy.ts";
import {
  bundleDependencies,
  type BundleFile,
  PRECACHE_MANIFEST_PLACEHOLDER,
  precacheFingerprint,
  type PrecacheManifest,
  rootRelativeUrls,
  webManifestIconUrls,
} from "../precacheList.ts";

// Hashed files the page loads at runtime rather than links, such as a game's art: the URLs to
// precache, and sound files by format, for the worker to store the format the page plays.
export interface HashedFiles {
  readonly sounds: Readonly<Record<string, readonly string[]>>;
  readonly urls: readonly string[];
}

export interface PrecachePluginOptions {
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
  hashedFiles = () => ({ sounds: {}, urls: [] }),
  pageHtmlFile,
  policy,
  serviceWorkerFileName = "sw.js",
  serviceWorkerSource,
}: PrecachePluginOptions): Plugin {
  return {
    apply: "build",
    buildStart() {
      this.emitFile({ fileName: serviceWorkerFileName, id: serviceWorkerSource, type: "chunk" });
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
          contents.set(url, bundleBytes(url) ?? new Uint8Array());
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
          contents.set(url, bundleBytes(url) ?? new Uint8Array());
        }

        // The public files the page links, and the icons each web app manifest names, read from
        // the build output where a plugin wrote them there (hashedIconsPlugin's manifest and
        // hashed icons) and otherwise from the public directory. The loop also visits the URLs
        // pushed onto linkedUrls while it runs.
        const linkedUrls = pageUrls.filter(
          (url) => !(url.slice(1) in bundle) || url.endsWith(".webmanifest"),
        );
        for (const url of linkedUrls) {
          if (contents.has(url) && !url.endsWith(".webmanifest")) {
            continue;
          }
          // Each file's references are only known once it is read, so reads run one at a time.
          // eslint-disable-next-line no-await-in-loop
          const bytes = bundleBytes(url) ?? (await readPublicFile(url));
          contents.set(url, bytes);
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
          ...soundUrls.map((url) => [url, bundleBytes(url) ?? new Uint8Array()] as const),
        ]);
        const contentHashes = new Map(
          [...listed]
            .filter(([url]) => !isHashedAssetUrl(policy, url))
            .map(([url, bytes]) => [url, contentHash(bytes)] as const),
        );
        const fingerprint = sha256Hex(
          encoder.encode(
            precacheFingerprint(
              policy,
              new Map([...listed.keys()].map((url) => [url, contentHashes.get(url) ?? ""])),
            ),
          ),
        );
        const manifest: PrecacheManifest = {
          contentHashes: Object.fromEntries(
            [...contentHashes.keys()].sort().map((url) => [url, contentHashes.get(url) ?? ""]),
          ),
          sounds: Object.fromEntries(
            Object.entries(hashed.sounds).map(([format, urls]) => [format, [...urls]]),
          ),
          urls: [...contents.keys()].sort(),
          version: fingerprint.slice(0, 16),
        };

        const serviceWorker = bundle[serviceWorkerFileName];
        if (
          serviceWorker?.type !== "chunk" ||
          !serviceWorker.code.includes(PRECACHE_MANIFEST_PLACEHOLDER)
        ) {
          this.error(
            `precache: ${serviceWorkerFileName} has no ${PRECACHE_MANIFEST_PLACEHOLDER} to replace`,
          );
        }
        serviceWorker.code = serviceWorker.code.replaceAll(
          PRECACHE_MANIFEST_PLACEHOLDER,
          JSON.stringify(manifest),
        );
      },
      order: "post",
    },
    name: "game-kit-precache",
  };
}
