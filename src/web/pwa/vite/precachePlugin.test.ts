import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { build, type Plugin } from "vite";
import { describe, expect, it } from "vitest";

import { contentHash } from "../../build/vite/contentHash.ts";
import type { CachePolicy } from "../cachePolicy.ts";
import { precacheFingerprint, type PrecacheManifest } from "../precacheList.ts";
import { precachePlugin, type PrecachePluginOptions } from "./precachePlugin.ts";

const POLICY: CachePolicy = {
  cacheNamePrefix: "game-",
  hashedAssetPrefix: "/assets/",
};

const INDEX = `<!doctype html>
<html><head><link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/favicon.png">
</head><body><script type="module" src="/main.js"></script></body></html>
`;

// A site whose page loads main.js and links a favicon and the web app manifest, which names one
// icon, and a worker entry that logs the manifest the build writes in, or holds no placeholder.
function site(icon: string, placeholder = true): string {
  const root = mkdtempSync(join(tmpdir(), "kit-precache-"));
  const files: Record<string, string> = {
    "index.html": INDEX,
    "main.js": "console.log('main');\n",
    "public/favicon.png": "favicon",
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
  // Files a plugin before the precache writes into the build output, by file name.
  readonly emitted?: Readonly<Record<string, string | Uint8Array>>;
  readonly hashedFiles?: PrecachePluginOptions["hashedFiles"];
  // A public file to delete from the site before building.
  readonly missing?: string;
  readonly placeholder?: boolean;
  // A public file to replace with a directory, which the build cannot read.
  readonly unreadable?: string;
  // An existing site to build again, as Vite's output names depend on the root.
  readonly root?: string;
  readonly onOutput?: (files: ReadonlyMap<string, Uint8Array>) => void;
}

function emitPlugin(files: Readonly<Record<string, string | Uint8Array>>): Plugin {
  return {
    generateBundle() {
      for (const [fileName, source] of Object.entries(files)) {
        this.emitFile({ fileName, source, type: "asset" });
      }
    },
    name: "emit",
  };
}

// Builds the site in memory and returns the precache manifest written into sw.js.
async function precache({
  emitted = {},
  hashedFiles,
  missing,
  onOutput,
  placeholder,
  root = site("icon", placeholder),
  unreadable,
}: Build) {
  if (missing !== undefined) {
    rmSync(join(root, "public", missing));
  }
  if (unreadable !== undefined) {
    rmSync(join(root, "public", unreadable));
    mkdirSync(join(root, "public", unreadable));
  }
  const result = await build({
    build: { minify: false, write: false },
    configFile: false,
    logLevel: "silent",
    plugins: [
      emitPlugin(emitted),
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
  onOutput?.(
    new Map(
      result.output.map((file) => [
        file.fileName,
        Buffer.from(file.type === "chunk" ? file.code : file.source),
      ]),
    ),
  );
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
      "/favicon.png",
      "/icon.png",
      "/manifest.webmanifest",
    ]);
    expect(manifest.version).toMatch(/^[0-9a-f]{16}$/);
  });

  it("records the content hash of every precached file outside the hashed build output", async () => {
    const hash = (text: string) => contentHash(new TextEncoder().encode(text));
    const manifest = await precache({
      emitted: { "art/a.ogg": "ogg", "art/sprite.png": "sprite", "assets/b-12345678.ogg": "b" },
      hashedFiles: () => ({
        sounds: { ogg: ["/art/a.ogg", "/assets/b-12345678.ogg"] },
        urls: ["/art/sprite.png"],
      }),
    });
    expect(manifest.contentHashes).toEqual({
      "/": expect.stringMatching(/^[\w-]{8}$/),
      "/art/a.ogg": hash("ogg"),
      "/art/sprite.png": hash("sprite"),
      "/favicon.png": hash("favicon"),
      "/icon.png": hash("icon"),
      "/manifest.webmanifest": hash(JSON.stringify({ icons: [{ src: "/icon.png" }] })),
    });
  });

  it("records sorted exact sizes for normalized URLs, binary assets and all sound alternatives", async () => {
    const root = site("icône 漢字");
    const guide = "<!doctype html><p>Résumé 漢字</p>";
    writeFileSync(
      join(root, "index.html"),
      INDEX.replace("</head>", '<link href="/guide/index.html"></head>'),
    );
    mkdirSync(join(root, "public/guide"));
    writeFileSync(join(root, "public/guide/index.html"), guide);
    let output: ReadonlyMap<string, Uint8Array> = new Map();
    const manifest = await precache({
      emitted: {
        "art/a.mp3": new Uint8Array([1, 2, 3]),
        "art/a.ogg": new Uint8Array([10, 20, 30, 40]).subarray(1, 3),
        "assets/empty-12345678.bin": new Uint8Array(),
        "assets/pixel-12345678.bin": new Uint8Array([1, 2, 3, 4, 5]),
      },
      hashedFiles: () => ({
        sounds: { mp3: ["/art/a.mp3"], ogg: ["/art/a.ogg", "/art/a.ogg"] },
        urls: [
          "/assets/pixel-12345678.bin",
          "/assets/empty-12345678.bin",
          "/assets/pixel-12345678.bin",
        ],
      }),
      onOutput: (files) => {
        output = files;
      },
      root,
    });
    const chunk = [...output.keys()].find((name) => /^assets\/index-[\w-]{8}\.js$/.test(name))!;
    const expected = {
      "/": output.get("index.html")!.byteLength,
      "/art/a.mp3": 3,
      "/art/a.ogg": 2,
      "/assets/empty-12345678.bin": 0,
      "/assets/pixel-12345678.bin": 5,
      "/favicon.png": Buffer.byteLength("favicon"),
      "/guide/": Buffer.byteLength(guide),
      "/icon.png": Buffer.byteLength("icône 漢字"),
      "/manifest.webmanifest": Buffer.byteLength(JSON.stringify({ icons: [{ src: "/icon.png" }] })),
      [`/${chunk}`]: output.get(chunk)!.byteLength,
    };
    expect(manifest.byteSizes).toEqual(expected);
    expect(Object.keys(manifest.byteSizes!)).toEqual(Object.keys(expected).sort());
    expect(manifest.urls).toContain("/guide/");
    expect(manifest.urls).not.toContain("/guide/index.html");
    expect(manifest.contentHashes["/guide/"]).toBe(contentHash(Buffer.from(guide)));
    expect(manifest.sounds).toEqual({ mp3: ["/art/a.mp3"], ogg: ["/art/a.ogg"] });
    const fingerprint = precacheFingerprint(
      POLICY,
      new Map(Object.keys(expected).map((url) => [url, manifest.contentHashes[url] ?? ""])),
      new Map(Object.entries(expected)),
    );
    expect(manifest.version).toBe(
      createHash("sha256").update(fingerprint).digest("hex").slice(0, 16),
    );
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
      byteSizes: { ...first.byteSizes, "/icon.png": Buffer.byteLength(icon) },
      contentHashes: {
        ...first.contentHashes,
        "/icon.png": contentHash(new TextEncoder().encode(icon)),
      },
      version: same,
    });
  });

  it.each<[string, Build, string | RegExp]>([
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
      "a missing public file the page links",
      { missing: "favicon.png" },
      "precache: /favicon.png is not in ",
    ],
    [
      "an unreadable public file the page links",
      { unreadable: "favicon.png" },
      /precache: cannot read \/favicon\.png in .*: EISDIR: /,
    ],
    [
      "a missing icon the web app manifest names",
      { missing: "icon.png" },
      "precache: /icon.png is not in ",
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
