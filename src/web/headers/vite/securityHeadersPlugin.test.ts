import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { build, type Plugin } from "vite";
import { describe, expect, it } from "vitest";

import type { HeadersRule, PageRule } from "../securityHeaders.ts";
import { HEADERS_FILE_NAME, securityHeadersPlugin } from "./securityHeadersPlugin.ts";

const INDEX = `<!doctype html>
<html><head><script>window.started = true;</script></head>
<body><script type="module" src="/main.js"></script></body></html>
`;
const NOTE = "<!doctype html><html><head><style>p { color: red; }</style></head></html>\n";

const FILE_RULES: HeadersRule[] = [
  { comment: "Every response.", headers: [["X-Content-Type-Options", "nosniff"]], path: "/*" },
];
const PAGE_RULES: PageRule[] = [
  { comment: "Home.", directives: { "font-src": ["https://fonts.example"] }, path: "/" },
  { comment: "Notes.", directives: {}, path: "/notes/*" },
];

const hash = (text: string) =>
  `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;

// A site with a built index page and, unless publicDir is false, a public notes page.
function site(): string {
  const root = mkdtempSync(join(tmpdir(), "kit-headers-"));
  const files: Record<string, string> = {
    "index.html": INDEX,
    "main.js": "console.log('main');\n",
    "public/notes/a.html": NOTE,
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

// Emits a file under /assets/ whose name has no content hash.
const UNHASHED: Plugin = {
  generateBundle() {
    this.emitFile({ fileName: "assets/plain.txt", source: "plain", type: "asset" });
  },
  name: "unhashed",
};

interface Build {
  readonly checkPage?: Parameters<typeof securityHeadersPlugin>[0]["checkPage"];
  readonly pageRules?: readonly PageRule[];
  readonly plugins?: readonly Plugin[];
  readonly publicDir?: false | string;
}

// Builds the site in memory and returns its _headers text.
async function headers({ checkPage, pageRules = PAGE_RULES, plugins = [], publicDir }: Build) {
  const root = site();
  const result = await build({
    build: { minify: false, write: false },
    configFile: false,
    logLevel: "silent",
    plugins: [
      ...plugins,
      securityHeadersPlugin({
        base: { "default-src": ["'self'"] },
        ...(checkPage === undefined ? {} : { checkPage }),
        fileRules: FILE_RULES,
        hashedAssetPath: "/assets/*",
        heading: "Written by the build.",
        pageRules,
      }),
    ],
    root,
    ...(publicDir === undefined ? {} : { publicDir: publicDir && join(root, publicDir) }),
  });
  if (!("output" in result)) {
    throw new Error("expected one build output");
  }
  const files = new Map(result.output.map((file) => [file.fileName, file]));
  const index = files.get("index.html");
  const file = files.get(HEADERS_FILE_NAME);
  if (index?.type !== "asset" || file?.type !== "asset") {
    throw new Error("missing index.html or _headers");
  }
  return { html: String(index.source), text: String(file.source) };
}

describe("securityHeadersPlugin", { timeout: 60_000 }, () => {
  it("writes the file rules, then each page rule with its pages' inline hashes", async () => {
    const { html, text } = await headers({});
    expect(html).toContain("<script>window.started = true;</script>");
    expect(text).toBe(
      [
        "# Written by the build.",
        "",
        "# Every response.",
        "/*",
        "  X-Content-Type-Options: nosniff",
        "",
        "# Home.",
        "/",
        "  Content-Security-Policy: default-src 'self'; " +
          `script-src ${hash("window.started = true;")}; font-src https://fonts.example`,
        "",
        "# Notes.",
        "/notes/*",
        `  Content-Security-Policy: default-src 'self'; style-src ${hash("p { color: red; }")}`,
        "",
      ].join("\n"),
    );
  });

  it.each<[string, false | string]>([
    ["disabled", false],
    ["missing", "absent"],
  ])("builds only the bundle's pages when the public directory is %s", async (_, publicDir) => {
    const { text } = await headers({ publicDir });
    expect(text).toContain("/notes/*\n  Content-Security-Policy: default-src 'self'\n");
  });

  it.each<[string, Build, string]>([
    [
      "a page checkPage rejects",
      { checkPage: ({ fileName }) => (fileName === "notes/a.html" ? "bad" : undefined) },
      "security headers: bad",
    ],
    [
      "an unhashed file under the hashed asset path",
      { plugins: [UNHASHED] },
      "security headers: assets/plain.txt is under /assets/*, but its name has no content hash",
    ],
    [
      "a page matching no rule",
      { pageRules: PAGE_RULES.slice(0, 1) },
      "security headers: /notes/a must match exactly one page rule, but matches none",
    ],
  ])("fails the build for %s", async (_, options, message) => {
    await expect(headers(options)).rejects.toThrow(message);
  });
});
