import type { Plugin } from "vite";

import { contentHash } from "../../build/contentHash";
import { hashIcons } from "../hashedIcons";

export interface HashedIconsPluginOptions {
  // The icons to hash, as root-relative URLs of files in the public directory, e.g.
  // "/icons/icon-192.png": the web app manifest's icons and the pages' favicons and
  // apple-touch-icon.
  readonly icons: readonly string[];
  // The web app manifest's URL; it keeps its name, as a launched app fetches it by that name.
  // "/manifest.webmanifest" when unset.
  readonly webManifest?: string;
}

// In a build, writes each icon again under its content-hashed name in Vite's assets directory
// (hashedIcons.ts), beside Vite's own hashed output, and points
// every built page and the web app manifest there. The manifest is written into the build output
// under its own name with its icons rewritten, so precachePlugin precaches the hashed icons it
// names. Fails the build for an icon that is missing or that nothing names. Runs after Vite has
// written the pages and before precachePlugin reads them.
export function hashedIconsPlugin({
  icons,
  webManifest = "/manifest.webmanifest",
}: HashedIconsPluginOptions): Plugin {
  return {
    apply: "build",
    enforce: "post",
    async generateBundle(_options, bundle) {
      const { build, publicDir } = this.environment.config;
      const read = async (url: string) => {
        try {
          return await this.fs.readFile(`${publicDir}${url}`);
        } catch {
          return this.error(`hashed icons: ${url} is not in ${publicDir}`);
        }
      };
      const decoder = new TextDecoder();
      const iconFiles = new Map(
        await Promise.all(icons.map(async (url) => [url, await read(url)] as const)),
      );
      const pages = Object.values(bundle).filter(
        (file) => file.type === "asset" && file.fileName.endsWith(".html"),
      );
      const texts = new Map([
        [webManifest.slice(1), decoder.decode(await read(webManifest))],
        ...pages.map((page) => {
          const { source } = page as { source: string | Uint8Array };
          return [
            page.fileName,
            typeof source === "string" ? source : decoder.decode(source),
          ] as const;
        }),
      ]);
      const hashed = hashIcons(contentHash, build.assetsDir, iconFiles, texts);
      if (hashed.unreferenced.length > 0) {
        this.error(`hashed icons: no page or manifest names ${hashed.unreferenced.join(", ")}`);
      }
      for (const [url, source] of hashed.files) {
        this.emitFile({ fileName: url.slice(1), source, type: "asset" });
      }
      for (const page of pages) {
        (page as { source: string }).source = hashed.texts.get(page.fileName) ?? "";
      }
      this.emitFile({
        fileName: webManifest.slice(1),
        source: hashed.texts.get(webManifest.slice(1)) ?? "",
        type: "asset",
      });
    },
    name: "game-kit-hashed-icons",
  };
}
