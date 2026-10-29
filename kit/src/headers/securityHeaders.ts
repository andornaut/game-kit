// The pure parts of vite/securityHeadersPlugin: finding a page's inline blocks, hashing them,
// and rendering a Cloudflare _headers file with a Content-Security-Policy per page rule.

// Rendered in this order.
export const DIRECTIVE_NAMES = [
  "default-src",
  "script-src",
  "style-src",
  "style-src-attr",
  "font-src",
  "img-src",
  "media-src",
  "connect-src",
  "worker-src",
  "manifest-src",
  "object-src",
  "base-uri",
  "form-action",
  "frame-ancestors",
] as const;

export type DirectiveName = (typeof DIRECTIVE_NAMES)[number];

export type Directives = Readonly<Partial<Record<DirectiveName, readonly string[]>>>;

export type HeaderList = readonly (readonly [name: string, value: string])[];

// A group of pages that share one Content-Security-Policy.
export interface PageRule {
  // Written above the rule in _headers.
  readonly comment: string;
  // Sources added to the base directives for these pages.
  readonly directives: Directives;
  // A Cloudflare _headers path pattern: * matches any run of characters, including none.
  readonly path: string;
}

// An HTML page as the build emits it.
export interface HtmlPage {
  readonly html: string;
  // Its file path under dist/, e.g. "play/index.html".
  readonly fileName: string;
}

// What a page needs allowed beyond its rule's sources.
export interface PageNeeds {
  readonly scriptHashes: readonly string[];
  readonly styleHashes: readonly string[];
}

export interface HeadersRule {
  readonly comment: string;
  readonly headers: HeaderList;
  readonly path: string;
}

// A CSP hash source for text, as the browser computes it over the UTF-8 bytes.
export async function cspHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  const binary = String.fromCharCode(...new Uint8Array(digest));
  return `'sha256-${btoa(binary)}'`;
}

const SCRIPT_PATTERN = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const STYLE_PATTERN = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
const SRC_PATTERN = /\ssrc\s*=\s*["']?([^"'\s>]+)/i;

// The text of each inline <script> (one with no src) and each <style> in a page.
export function inlineBlocks(html: string): { scripts: string[]; styles: string[] } {
  const scripts = [...html.matchAll(SCRIPT_PATTERN)]
    .filter(([, attributes]) => !SRC_PATTERN.test(attributes ?? ""))
    .map(([, , text]) => text ?? "");
  const styles = [...html.matchAll(STYLE_PATTERN)].map(([, text]) => text ?? "");
  return { scripts, styles };
}

// The path a page is served at: Cloudflare serves /dir/index.html at /dir/ and /x.html at /x.
export function servedPath(fileName: string): string {
  return `/${fileName.replace(/(^|\/)index\.html$/, "$1").replace(/\.html$/, "")}`;
}

// Whether a _headers path pattern matches a request path.
export function pathMatches(pattern: string, path: string): boolean {
  const source = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}$`).test(path);
}

// A Vite output name: the source's name, a dash and an 8-character content hash.
const HASHED_NAME = /-[\w-]{8}\.\w+$/;

// The build's files under hashedAssetPath (a _headers path pattern) whose names carry no content
// hash, so a long cache lifetime would keep a stale copy.
export function unhashedAssets(hashedAssetPath: string, fileNames: readonly string[]): string[] {
  return fileNames.filter(
    (fileName) => pathMatches(hashedAssetPath, `/${fileName}`) && !HASHED_NAME.test(fileName),
  );
}

// One directive per name in DIRECTIVE_NAMES order, each source once.
export function renderPolicy(...layers: readonly Directives[]): string {
  return DIRECTIVE_NAMES.flatMap((name: DirectiveName) => {
    const sources = [...new Set(layers.flatMap((layer) => layer[name] ?? []))];
    return sources.length === 0 ? [] : [`${name} ${sources.join(" ")}`];
  }).join("; ");
}

// Each page rule with its policy: the base, the rule's sources, and the hashes its pages need.
// Throws when a page matches no rule or more than one.
export function pageRules(
  base: Directives,
  rules: readonly PageRule[],
  pages: ReadonlyMap<string, PageNeeds>,
): HeadersRule[] {
  const needsByRule = new Map<PageRule, PageNeeds[]>(rules.map((rule) => [rule, []]));
  for (const [path, needs] of [...pages].sort(([a], [b]) => a.localeCompare(b))) {
    const matching = rules.filter((rule) => pathMatches(rule.path, path));
    if (matching.length !== 1) {
      const names = matching.map((rule) => rule.path).join(", ") || "none";
      throw new Error(`${path} must match exactly one page rule, but matches ${names}`);
    }
    needsByRule.get(matching[0] as PageRule)?.push(needs);
  }
  return rules.map((rule) => {
    const needs = needsByRule.get(rule) ?? [];
    const policy = renderPolicy(base, rule.directives, {
      "script-src": needs.flatMap((need) => need.scriptHashes).sort(),
      "style-src": needs.flatMap((need) => need.styleHashes).sort(),
    });
    return {
      comment: rule.comment,
      headers: [["Content-Security-Policy", policy]],
      path: rule.path,
    };
  });
}

// The _headers file: a heading, then each rule as its comment, its path and indented headers.
export function headersFile(heading: string, rules: readonly HeadersRule[]): string {
  const blocks = rules.map(({ comment, headers, path }) =>
    [`# ${comment}`, path, ...headers.map(([name, value]) => `  ${name}: ${value}`)].join("\n"),
  );
  return `${[`# ${heading}`, ...blocks].join("\n\n")}\n`;
}
