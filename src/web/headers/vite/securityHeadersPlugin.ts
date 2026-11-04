import { createHash } from "node:crypto";

import type { Plugin } from "vite";

import {
  type Directives,
  headersFile,
  type HeadersRule,
  type HtmlPage,
  inlineBlocks,
  type PageNeeds,
  type PageRule,
  pageRules,
  servedPath,
  sha256Source,
  unhashedAssets,
  VITE_HASHED_NAME,
} from "../securityHeaders.ts";

export interface SecurityHeadersOptions {
  // Every page's policy before its rule's sources and hashes are added.
  readonly base: Directives;
  // Fails the build for a page: the reason it is wrong, or undefined when it is not.
  readonly checkPage?: (page: HtmlPage) => string | undefined;
  // Written before the page rules: headers on every response and on files rather than pages.
  readonly fileRules: readonly HeadersRule[];
  // Where the build writes its content-hashed files, as a _headers path pattern (e.g.
  // "/assets/*"): the build fails for a file there whose name does not match hashedName.
  readonly hashedAssetPath: string;
  // A content-hashed output name. Defaults to VITE_HASHED_NAME, Vite's default naming.
  readonly hashedName?: RegExp;
  // The _headers file's first comment line.
  readonly heading: string;
  // Each built or public HTML page must match exactly one, or the build fails: two matching
  // policies would join into one header and the browser would enforce both.
  readonly pageRules: readonly PageRule[];
}

export const HEADERS_FILE_NAME = "_headers";

// The CSP hash source for a block, over its UTF-8 bytes as the browser hashes them.
function cspHash(text: string): string {
  return sha256Source(createHash("sha256").update(text, "utf8").digest("base64"));
}

// Writes _headers for Cloudflare into the build output: the file rules, then a
// Content-Security-Policy per page rule with the hashes of every inline <script> and <style> in
// the built pages and the pages copied from the public directory. Fails the build for a page
// checkPage rejects, and for an unhashed file under the hashed asset path.
export function securityHeadersPlugin(options: SecurityHeadersOptions): Plugin {
  const hashedName = options.hashedName ?? VITE_HASHED_NAME;
  return {
    apply: "build",
    enforce: "post",
    generateBundle: {
      async handler(_options, bundle) {
        const { publicDir } = this.environment.config;
        const decoder = new TextDecoder();
        const readPublic = async (path: string): Promise<string> =>
          decoder.decode(await this.fs.readFile(`${publicDir}/${path}`));

        const publicHtml = async (dir: string): Promise<string[]> => {
          const entries = await this.fs.readdir(`${publicDir}/${dir}`, { withFileTypes: true });
          const nested = await Promise.all(
            entries.map(async (entry) => {
              const path = dir === "" ? entry.name : `${dir}/${entry.name}`;
              if (entry.isDirectory()) {
                return publicHtml(path);
              }
              return entry.isFile() && path.endsWith(".html") ? [path] : [];
            }),
          );
          return nested.flat();
        };

        // Vite resolves a disabled public directory to "", and keeps the path of a missing one.
        const publicFiles =
          publicDir === ""
            ? []
            : await publicHtml("").catch((error: unknown) => {
                if ((error as { code?: unknown } | undefined)?.code === "ENOENT") {
                  return [];
                }
                throw error;
              });
        const pages: HtmlPage[] = [
          ...Object.values(bundle).flatMap((file) =>
            file.type === "asset" &&
            file.fileName.endsWith(".html") &&
            typeof file.source === "string"
              ? [{ fileName: file.fileName, html: file.source }]
              : [],
          ),
          ...(await Promise.all(
            publicFiles.map(async (fileName) => ({ fileName, html: await readPublic(fileName) })),
          )),
        ];

        for (const page of pages) {
          const problem = options.checkPage?.(page);
          if (problem !== undefined) {
            this.error(`security headers: ${problem}`);
          }
        }

        const unhashed = unhashedAssets(options.hashedAssetPath, hashedName, Object.keys(bundle));
        if (unhashed.length > 0) {
          this.error(
            `security headers: ${unhashed.join(", ")} is under ${options.hashedAssetPath}, but ` +
              "its name has no content hash",
          );
        }

        const needs = new Map<string, PageNeeds>(
          pages.map(({ fileName, html }) => {
            const { scripts, styles } = inlineBlocks(html);
            const pageNeeds: PageNeeds = {
              scriptHashes: scripts.map(cspHash),
              styleHashes: styles.map(cspHash),
            };
            return [servedPath(fileName), pageNeeds] as const;
          }),
        );

        let rules: HeadersRule[] = [];
        try {
          rules = pageRules(options.base, options.pageRules, needs);
        } catch (error) {
          this.error(`security headers: ${(error as Error).message}`);
        }
        this.emitFile({
          fileName: HEADERS_FILE_NAME,
          source: headersFile(options.heading, [...options.fileRules, ...rules]),
          type: "asset",
        });
      },
      order: "post",
    },
    name: "game-kit-security-headers",
  };
}
