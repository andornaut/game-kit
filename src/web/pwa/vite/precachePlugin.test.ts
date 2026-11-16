import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";

import { build, createServer, type Plugin } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CI_COMMIT_VARIABLE } from "../../build/buildVersion.ts";
import { contentHash } from "../../build/vite/contentHash.ts";
import { gitBuildMetadata, gitHead } from "../../build/vite/gitHead.ts";
import type { CachePolicy } from "../cachePolicy.ts";
import { precacheFingerprint, type PrecacheManifest } from "../precacheList.ts";
import { decodePrecacheManifest } from "../precacheWire.ts";
import { assertClassicWorker } from "./classicWorker.ts";
import { precachePlugin, type PrecachePluginOptions } from "./precachePlugin.ts";

const POLICY: CachePolicy = {
  cacheNamePrefix: "game-",
  hashedAssetPrefix: "/assets/",
};

afterEach(() => vi.unstubAllEnvs());

function cleanSite(): { root: string; buildId: string } {
  vi.stubEnv(CI_COMMIT_VARIABLE, "");
  const root = site("icon");
  writeFileSync(join(root, ".gitignore"), "node_modules/\ndist/\n");
  writeFileSync(join(root, "main.js"), "console.log(__BUILD_ID__);\n");
  execFileSync("git", ["init", "--quiet", root]);
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", [
    "-C",
    root,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "--quiet",
    "-m",
    "Fixture",
  ]);
  return { buildId: gitHead(root).trim(), root };
}

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
  readonly buildId?: string | undefined;
  readonly groups?: PrecachePluginOptions["groups"];
  readonly verifiedJsonBodies?: PrecachePluginOptions["verifiedJsonBodies"];
  readonly lateEmitted?: Readonly<Record<string, string>>;
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
  buildId,
  emitted = {},
  groups,
  hashedFiles,
  missing,
  onOutput,
  lateEmitted = {},
  placeholder,
  root = site("icon", placeholder),
  unreadable,
  verifiedJsonBodies,
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
    define: {
      __BUILD_ID__: JSON.stringify(gitBuildMetadata(root, process.env).buildId) ?? "undefined",
    },
    logLevel: "silent",
    plugins: [
      emitPlugin(emitted),
      precachePlugin({
        buildId,
        ...(groups === undefined ? {} : { groups }),
        ...(hashedFiles === undefined ? {} : { hashedFiles }),
        pageHtmlFile: "index.html",
        policy: POLICY,
        serviceWorkerSource: join(root, "sw.js"),
        ...(verifiedJsonBodies === undefined ? {} : { verifiedJsonBodies }),
      }),
      { ...emitPlugin(lateEmitted), enforce: "post", name: "late-art-json" },
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
  if (worker?.type !== "asset" || typeof worker.source !== "string") {
    throw new Error("missing sw.js or its manifest");
  }
  let manifest: PrecacheManifest | undefined;
  new Script(worker.source).runInNewContext({
    console: {
      log: (value: PrecacheManifest) => {
        manifest = decodePrecacheManifest(value);
      },
    },
  });
  if (manifest === undefined) {
    throw new Error("missing worker manifest");
  }
  return manifest;
}

describe("precachePlugin", { timeout: 60_000 }, () => {
  it("records full identity only for explicitly selected identical final JSON bodies", async () => {
    const text = '{"values":[1,2,3]}';
    const root = site("icon");
    const emitted = { "a.json": text, "b.json": text };
    const options = {
      hashedFiles: () => ({ sounds: {}, urls: ["/a.json", "/b.json"] }),
      lateEmitted: emitted,
      root,
      verifiedJsonBodies: () => [["/b.json", "/a.json"]],
    };
    const manifest = await precache(options);
    expect(manifest.verifiedJsonBodies).toEqual([
      {
        byteSize: Buffer.byteLength(text),
        sha256: createHash("sha256").update(text).digest("hex"),
        urls: ["/a.json", "/b.json"],
      },
    ]);
    expect(manifest.urls).toEqual(expect.arrayContaining(["/a.json", "/b.json"]));
    expect(manifest.byteSizes?.["/a.json"]).toBe(Buffer.byteLength(text));
    expect(manifest.contentHashes["/b.json"]).toBe(contentHash(Buffer.from(text)));
    const legacy = await precache({ hashedFiles: options.hashedFiles, lateEmitted: emitted, root });
    expect(legacy).not.toHaveProperty("verifiedJsonBodies");
    expect(legacy.version).not.toBe(manifest.version);
    await expect(
      precache({ ...options, lateEmitted: { ...emitted, "b.json": '{"values":[1,2,4]}' } }),
    ).rejects.toThrow(/bodies differ/);
  });

  it("emits and fingerprints an explicit data profile from the final discovery", async () => {
    const root = site("icon");
    const options = {
      hashedFiles: () => ({ sounds: {}, urls: ["/a.json", "/b.json"] }),
      lateEmitted: { "a.json": "{}", "b.json": "{}" },
      root,
    };
    const legacy = await precache({
      ...options,
      verifiedJsonBodies: () => [["/a.json", "/b.json"]],
    });
    const data = await precache({
      ...options,
      verifiedJsonBodies: () => [
        { responseProfile: "fetch-json-data-v1", urls: ["/a.json", "/b.json"] },
      ],
    });
    expect(data.verifiedJsonBodies![0]!.responseProfile).toBe("fetch-json-data-v1");
    expect(data.version).not.toBe(legacy.version);
    expect(data.urls).toEqual(legacy.urls);
    expect(data.contentHashes).toEqual(legacy.contentHashes);
    expect(data.byteSizes).toEqual(legacy.byteSizes);
  });

  it("isolates a classic worker when page and worker share the byte-progress runtime", async () => {
    const root = site("icon");
    const shared = fileURLToPath(new URL("../downloadProgress.ts", import.meta.url));
    writeFileSync(
      join(root, "main.js"),
      'import { downloadByteTotal } from "@progress";' +
        'console.log(downloadByteTotal({a: 7}, ["a"]));',
    );
    writeFileSync(
      join(root, "sw.js"),
      'import { downloadByteTotal } from "@progress";' +
        'self.total = downloadByteTotal({a: 11}, ["a"]);' +
        "self.marker = __WORKER_MARKER__; self.manifest = GAME_KIT_PRECACHE_MANIFEST;",
    );
    const result = await build({
      build: { minify: false, target: "es2022", write: true },
      configFile: false,
      define: { __WORKER_MARKER__: JSON.stringify("captured") },
      logLevel: "silent",
      plugins: [
        precachePlugin({
          pageHtmlFile: "index.html",
          policy: POLICY,
          serviceWorkerFileName: "offline-worker.js",
          serviceWorkerSource: join(root, "sw.js"),
        }),
      ],
      resolve: { alias: { "@progress": shared } },
      root,
    });
    if (!("output" in result)) {
      throw new Error("expected output");
    }
    const worker = result.output.find(({ fileName }) => fileName === "offline-worker.js");
    expect(worker?.type).toBe("asset");
    if (worker?.type !== "asset" || typeof worker.source !== "string") {
      throw new Error("missing worker");
    }
    expect(worker.source).not.toContain("GAME_KIT_PRECACHE_MANIFEST");
    const scope: Record<string, unknown> = {};
    new Script(worker.source).runInNewContext({ self: scope });
    expect(scope.total).toBe(11);
    expect(scope.marker).toBe("captured");
    const manifest = decodePrecacheManifest(scope.manifest);
    expect(manifest.byteSizes).toHaveProperty("/");
    expect(manifest.urls).not.toContain("/offline-worker.js");
    const page = result.output.filter((file) => file.type === "chunk");
    expect(page).toHaveLength(1);
    expect(page[0]?.imports).toEqual([]);
    expect(page[0]?.dynamicImports).toEqual([]);
    expect(page[0]?.code).toContain("downloadByteTotal");
    expect(worker.source).toContain("downloadByteTotal");
    await expect(
      build({
        build: { write: false },
        configFile: false,
        logLevel: "silent",
        plugins: [
          precachePlugin({
            pageHtmlFile: "index.html",
            policy: POLICY,
            serviceWorkerSource: join(root, "sw.js"),
          }),
        ],
        resolve: { alias: { "@progress": shared } },
        root,
        worker: { rolldownOptions: { external: ["@progress"] } },
      }),
    ).rejects.toThrow(/split or external/);
    for (const code of [
      'import "./page.js";',
      'import("./page.js");',
      'importScripts("./page.js");',
    ]) {
      expect(() => assertClassicWorker("sw.js", code)).toThrow(/classic|import/);
    }
  });

  it("partitions late emissions and binds the same full source ID into app and worker", async () => {
    const { buildId, root } = cleanSite();
    let discovery: Parameters<NonNullable<PrecachePluginOptions["groups"]>>[0] | undefined;
    let output: ReadonlyMap<string, Uint8Array> = new Map();
    const manifest = await precache({
      buildId,
      emitted: { "assets/a-12345678.mp3": "mp3", "assets/a-12345678.ogg": "ogg" },
      groups: (files) => {
        discovery = files;
        expect(files.urls).toEqual(
          expect.arrayContaining([
            "/",
            "/late.json",
            "/favicon.png",
            "/icon.png",
            "/manifest.webmanifest",
          ]),
        );
        expect(files.sounds).toEqual({
          mp3: ["/assets/a-12345678.mp3"],
          ogg: ["/assets/a-12345678.ogg"],
        });
        return {
          initial: ["optional"],
          urls: { optional: ["/late.json", ...Object.values(files.sounds).flat()] },
        };
      },
      hashedFiles: () => ({
        sounds: { mp3: ["/assets/a-12345678.mp3"], ogg: ["/assets/a-12345678.ogg"] },
        urls: ["/late.json"],
      }),
      lateEmitted: { "late.json": '{"generated":true}' },
      onOutput: (files) => {
        output = files;
      },
      root,
    });
    expect(manifest.buildId).toBe(buildId);
    expect(manifest.groups).toEqual({
      initial: ["optional"],
      urls: { optional: ["/assets/a-12345678.mp3", "/assets/a-12345678.ogg", "/late.json"] },
    });
    const listed = [
      ...new Set([...manifest.urls, ...Object.values(manifest.sounds).flat()]),
    ].sort();
    expect(Object.keys(manifest.contentHashes)).toEqual(listed);
    expect(manifest.contentHashes["/assets/a-12345678.ogg"]).toBe(contentHash(Buffer.from("ogg")));
    expect(discovery?.urls).toEqual(manifest.urls);
    const app = [...output].find(([name]) => /^assets\/index-/.test(name))![1];
    expect(Buffer.from(app).toString()).toContain(buildId);
    expect(Buffer.from(app).toString()).not.toContain("__BUILD_ID__");
    expect(manifest.version).toBe(
      createHash("sha256")
        .update(
          precacheFingerprint(
            POLICY,
            new Map(Object.entries(manifest.contentHashes)),
            new Map(Object.entries(manifest.byteSizes!)),
            { buildId, groups: manifest.groups! },
          ),
        )
        .digest("hex")
        .slice(0, 16),
    );
    const regrouped = await precache({ buildId, groups: () => ({ initial: [], urls: {} }), root });
    const same = await precache({ buildId, groups: () => ({ initial: [], urls: {} }), root });
    expect(regrouped.version).toBe(same.version);
  });

  it("rejects dirty, missing, mismatched and development grouped identities", async () => {
    const { buildId, root } = cleanSite();
    const groups = () => ({ initial: [], urls: {} });
    await expect(precache({ groups, root })).rejects.toThrow(/clean source/);
    await expect(precache({ buildId: "0".repeat(40), groups, root })).rejects.toThrow(
      /clean source/,
    );
    await expect(
      build({
        build: { write: false },
        configFile: false,
        logLevel: "silent",
        plugins: [
          precachePlugin({
            buildId,
            groups,
            pageHtmlFile: "index.html",
            policy: POLICY,
            serviceWorkerSource: join(root, "sw.js"),
          }),
        ],
        root,
      }),
    ).rejects.toThrow(/app __BUILD_ID__/);
    writeFileSync(join(root, "untracked.txt"), "untracked");
    await expect(precache({ buildId, groups, root })).rejects.toThrow(/clean source/);
    rmSync(join(root, "untracked.txt"));
    await expect(
      createServer({
        configFile: false,
        plugins: [
          precachePlugin({
            buildId,
            groups,
            pageHtmlFile: "index.html",
            policy: POLICY,
            serviceWorkerSource: join(root, "sw.js"),
          }),
        ],
        root,
      }),
    ).rejects.toThrow(/development/);
  });

  it("rejects partition metadata against all discovered URLs before emitting grouped output", async () => {
    const { buildId, root } = cleanSite();
    await expect(
      precache({ buildId, groups: () => ({ initial: ["missing"], urls: {} }), root }),
    ).rejects.toThrow(/Unknown precache group/);
    await expect(
      precache({ buildId, groups: () => ({ initial: [], urls: { a: ["/missing"] } }), root }),
    ).rejects.toThrow(/Unknown precache URL/);
    await expect(
      precache({ buildId, groups: () => ({ initial: [], urls: { a: ["/"], b: ["/"] } }), root }),
    ).rejects.toThrow(/multiple groups/);
  });

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
    expect(manifest).not.toHaveProperty("groups");
    expect(manifest).not.toHaveProperty("buildId");
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
