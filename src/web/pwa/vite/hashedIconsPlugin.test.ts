import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { build } from "vite";
import { describe, expect, it } from "vitest";

import { contentHash } from "../../build/vite/contentHash.ts";
import { hashedIconsPlugin, type HashedIconsPluginOptions } from "./hashedIconsPlugin.ts";

const INDEX = `<!doctype html>
<html><head><link rel="icon" href="/icons/a.png"><link rel="manifest" href="/app.webmanifest">
</head><body><script type="module" src="/main.js"></script></body></html>
`;
const MANIFEST = '{"icons":[{"src":"/icons/b.png"}]}';

const bytes = (text: string) => new TextEncoder().encode(text);
const hashed = (url: string, text: string) =>
  url.replace(/^\/(.*)(\.png)$/, `/assets/$1-${contentHash(bytes(text))}$2`);

// A site whose page names icon a and whose web app manifest names icon b.
function site(): string {
  const root = mkdtempSync(join(tmpdir(), "kit-icons-"));
  const files: Record<string, string> = {
    "index.html": INDEX,
    "main.js": "console.log('main');\n",
    "public/app.webmanifest": MANIFEST,
    "public/icons/a.png": "icon a",
    "public/icons/b.png": "icon b",
    "public/icons/c.png": "icon c",
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

// Builds the site in memory and returns each output asset's text by file name.
async function icons(options: HashedIconsPluginOptions): Promise<Map<string, string>> {
  const result = await build({
    build: { minify: false, write: false },
    configFile: false,
    logLevel: "silent",
    plugins: [hashedIconsPlugin(options)],
    root: site(),
  });
  if (!("output" in result)) {
    throw new Error("expected one build output");
  }
  const decoder = new TextDecoder();
  const text = (source: string | Uint8Array) =>
    typeof source === "string" ? source : decoder.decode(source);
  return new Map(
    result.output.flatMap((file) =>
      file.type === "asset" ? [[file.fileName, text(file.source)] as const] : [],
    ),
  );
}

describe("hashedIconsPlugin", { timeout: 60_000 }, () => {
  it("writes each icon under its content hash and points the page and manifest there", async () => {
    const output = await icons({
      icons: ["/icons/a.png", "/icons/b.png"],
      webManifest: "/app.webmanifest",
    });
    const a = hashed("/icons/a.png", "icon a");
    const b = hashed("/icons/b.png", "icon b");
    expect([output.get(a.slice(1)), output.get(b.slice(1))]).toEqual(["icon a", "icon b"]);
    expect(output.get("index.html")).toContain(`<link rel="icon" href="${a}">`);
    expect(output.get("index.html")).not.toContain('"/icons/a.png"');
    expect(output.get("app.webmanifest")).toBe(`{"icons":[{"src":"${b}"}]}`);
  });

  it.each<[string, HashedIconsPluginOptions, string]>([
    [
      "an icon missing from the public directory",
      { icons: ["/icons/d.png"], webManifest: "/app.webmanifest" },
      "hashed icons: /icons/d.png is not in",
    ],
    [
      "an icon nothing names",
      { icons: ["/icons/a.png", "/icons/c.png"], webManifest: "/app.webmanifest" },
      "hashed icons: no page or manifest names /icons/c.png",
    ],
    [
      "a missing web app manifest",
      { icons: ["/icons/a.png"] },
      "hashed icons: /manifest.webmanifest is not in",
    ],
  ])("fails the build for %s", async (_, options, message) => {
    await expect(icons(options)).rejects.toThrow(message);
  });
});
