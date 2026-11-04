import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { build } from "vite";
import { describe, expect, it } from "vitest";

import type { CachePolicy } from "../cachePolicy.ts";
import type { PrecacheManifest } from "../precacheList.ts";
import { precachePlugin, type PrecachePluginOptions } from "./precachePlugin.ts";

const POLICY: CachePolicy = {
  cacheNamePrefix: "game-",
  hashedAssetPrefix: "/assets/",
  revalidatedUrls: ["/manifest.webmanifest"],
};

const INDEX = `<!doctype html>
<html><head><link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/missing.png">
</head><body><script type="module" src="/main.js"></script></body></html>
`;

// A site whose page loads main.js and links the web app manifest, which names one icon, and a
// worker entry that logs the manifest the build writes in, or holds no placeholder.
function site(icon: string, placeholder = true): string {
  const root = mkdtempSync(join(tmpdir(), "kit-precache-"));
  const files: Record<string, string> = {
    "index.html": INDEX,
    "main.js": "console.log('main');\n",
    "public/icon.png": icon,
    "public/manifest.webmanifest": JSON.stringify({ icons: [{ src: "/icon.png" }] }),
    "sw.js": placeholder ? "console.log(GAME_KIT_PRECACHE_MANIFEST);\n" : "console.log('sw');\n",
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

interface Build {
  readonly hashedFiles?: PrecachePluginOptions["hashedFiles"];
  readonly placeholder?: boolean;
  // An existing site to build again, as Vite's output names depend on the root.
  readonly root?: string;
}

// Builds the site in memory and returns the precache manifest written into sw.js.
async function precache({ hashedFiles, placeholder, root = site("icon", placeholder) }: Build) {
  const result = await build({
    build: { minify: false, write: false },
    configFile: false,
    logLevel: "silent",
    plugins: [
      precachePlugin({
        ...(hashedFiles === undefined ? {} : { hashedFiles }),
        pageHtmlFile: "index.html",
        policy: POLICY,
        serviceWorkerSource: join(root, "sw.js"),
      }),
    ],
    root,
  });
  if (!("output" in result)) {
    throw new Error("expected one build output");
  }
  const worker = result.output.find((file) => file.fileName === "sw.js");
  const json =
    worker?.type === "chunk" ? /console\.log\((\{.*\})\)/s.exec(worker.code)?.[1] : undefined;
  if (json === undefined) {
    throw new Error("missing sw.js or its manifest");
  }
  return JSON.parse(json) as PrecacheManifest;
}

describe("precachePlugin", { timeout: 60_000 }, () => {
  it("precaches the page, its build output, its public links and their icons", async () => {
    const manifest = await precache({});
    expect(manifest.sounds).toEqual({});
    expect(manifest.urls).toEqual([
      "/",
      expect.stringMatching(/^\/assets\/index-[\w-]{8}\.js$/),
      "/icon.png",
      "/manifest.webmanifest",
    ]);
    expect(manifest.version).toMatch(/^[0-9a-f]{16}$/);
  });

  it.each<[string, string, boolean]>([
    ["the same files", "icon", true],
    ["a changed public file", "redrawn", false],
  ])("versions a rebuild of %s the same: %s", async (_, icon, same) => {
    const root = site("icon");
    const first = await precache({ root });
    writeFileSync(join(root, "public/icon.png"), icon);
    const second = await precache({ root });
    expect({ ...second, version: first.version === second.version }).toEqual({
      ...first,
      version: same,
    });
  });

  it.each<[string, Build, string]>([
    [
      "a hashed file outside the build output",
      { hashedFiles: () => ({ sounds: { ogg: ["/assets/a.ogg"] }, urls: [] }) },
      "precache: /assets/a.ogg are named but not in the build output",
    ],
    [
      "a hashedFiles that throws",
      {
        hashedFiles: () => {
          throw new Error("no art");
        },
      },
      "precache: no art",
    ],
    [
      "a worker without the placeholder",
      { placeholder: false },
      "precache: sw.js has no GAME_KIT_PRECACHE_MANIFEST to replace",
    ],
  ])("fails the build for %s", async (_, options, message) => {
    await expect(precache(options)).rejects.toThrow(message);
  });
});
