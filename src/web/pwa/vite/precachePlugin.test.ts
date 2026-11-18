import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";

import { build, type Plugin } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CI_COMMIT_VARIABLE } from "../../build/buildVersion.ts";
import { gitBuildMetadata, gitHead } from "../../build/vite/gitHead.ts";
import {
  BUILD_POINTER_URL,
  type BuildManifest,
  buildManifestUrl,
  type BuildPointer,
} from "../buildContract.ts";
import { UNKNOWN_BUILD_ID, validateBuildManifest, validateBuildPointer } from "../buildManifest.ts";
import type { CachePolicy } from "../cachePolicy.ts";
import { assertClassicWorker } from "./classicWorker.ts";
import { precachePlugin, type PrecachePluginOptions } from "./precachePlugin.ts";

const POLICY: CachePolicy = {
  cacheNamePrefix: "game-",
  hashedAssetPrefix: "/assets/",
};

afterEach(() => vi.unstubAllEnvs());

const sha256 = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");

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
// icon, and a worker entry.
function site(icon: string): string {
  const root = mkdtempSync(join(tmpdir(), "kit-precache-"));
  const files: Record<string, string> = {
    "index.html": INDEX,
    "main.js": "console.log('main');\n",
    "public/favicon.png": "favicon",
    "public/icon.png": icon,
    "public/manifest.webmanifest": JSON.stringify({ icons: [{ src: "/icon.png" }] }),
    "sw.js": "console.log('sw');\n",
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

interface Build {
  readonly boot?: PrecachePluginOptions["boot"];
  readonly buildId?: string | undefined;
  readonly verifiedJsonBodies?: PrecachePluginOptions["verifiedJsonBodies"];
  readonly lateEmitted?: Readonly<Record<string, string>>;
  // Files a plugin before the precache writes into the build output, by file name.
  readonly emitted?: Readonly<Record<string, string | Uint8Array>>;
  readonly hashedFiles?: PrecachePluginOptions["hashedFiles"];
  // A public file to delete from the site before building.
  readonly missing?: string;
  // A public file to replace with a directory, which the build cannot read.
  readonly unreadable?: string;
  // An existing site to build again, as Vite's output names depend on the root.
  readonly root?: string;
}

interface Built {
  readonly manifest: BuildManifest;
  readonly output: ReadonlyMap<string, Uint8Array>;
  readonly pointer: BuildPointer;
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

function fileMap(manifest: BuildManifest) {
  return new Map(manifest.files.map((file) => [file.url, file]));
}

// Builds the site in memory and returns the emitted pointer and manifest, validated.
async function precache({
  boot,
  buildId,
  emitted = {},
  hashedFiles,
  lateEmitted = {},
  missing,
  root = site("icon"),
  unreadable,
  verifiedJsonBodies,
}: Build): Promise<Built> {
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
        ...(boot === undefined ? {} : { boot }),
        buildId,
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
  const output = new Map(
    result.output.map((file) => [
      file.fileName,
      Buffer.from(file.type === "chunk" ? file.code : file.source),
    ]),
  );
  const json = (fileName: string): unknown =>
    JSON.parse(Buffer.from(output.get(fileName) ?? "null").toString());
  const pointer = validateBuildPointer(json(BUILD_POINTER_URL.slice(1)));
  const manifest = validateBuildManifest(json(pointer.manifest.slice(1)));
  return { manifest, output, pointer };
}

describe("precachePlugin", { timeout: 60_000 }, () => {
  it("emits the pointer and the immutable manifest named by the version", async () => {
    const { manifest, output, pointer } = await precache({});
    expect(pointer).toEqual({
      buildId: UNKNOWN_BUILD_ID,
      manifest: buildManifestUrl(manifest.version),
      schema: 1,
      version: manifest.version,
    });
    expect(manifest.version).toMatch(/^[0-9a-f]{16}$/);
    expect(manifest.buildId).toBe(UNKNOWN_BUILD_ID);
    expect([...output.keys()].filter((name) => name.startsWith(".game-kit/")).sort()).toEqual([
      ".game-kit/build.json",
      `.game-kit/manifest-${manifest.version}.json`,
    ]);
    expect(manifest.files.map((file) => file.url)).not.toContain("/sw.js");
    expect(manifest.files.some((file) => file.url.startsWith("/.game-kit/"))).toBe(false);
  });

  it("precaches the page, its build output, its public links and their icons", async () => {
    const { manifest } = await precache({});
    expect(manifest.sounds).toEqual({});
    expect(manifest.boot).toEqual([]);
    expect(manifest.files.map((file) => file.url)).toEqual([
      "/",
      expect.stringMatching(/^\/assets\/index-[\w-]{8}\.js$/),
      "/favicon.png",
      "/icon.png",
      "/manifest.webmanifest",
    ]);
    expect(manifest).not.toHaveProperty("verifiedJsonBodies");
  });

  it("records the full SHA-256 and exact size of every file, hashed build output included", async () => {
    const root = site("icône 漢字");
    const guide = "<!doctype html><p>Résumé 漢字</p>";
    writeFileSync(
      join(root, "index.html"),
      INDEX.replace("</head>", '<link href="/guide/index.html"></head>'),
    );
    mkdirSync(join(root, "public/guide"));
    writeFileSync(join(root, "public/guide/index.html"), guide);
    const binary = {
      "art/a.mp3": new Uint8Array([1, 2, 3]),
      "art/a.ogg": new Uint8Array([10, 20, 30, 40]).subarray(1, 3),
      "assets/empty-12345678.bin": new Uint8Array(),
      "assets/pixel-12345678.bin": new Uint8Array([1, 2, 3, 4, 5]),
    };
    const { manifest, output } = await precache({
      emitted: binary,
      hashedFiles: () => ({
        sounds: { "/art/a": ["/art/a.ogg", "/art/a.mp3", "/art/a.ogg"] },
        urls: [
          "/assets/pixel-12345678.bin",
          "/assets/empty-12345678.bin",
          "/assets/pixel-12345678.bin",
        ],
      }),
      root,
    });
    const chunk = [...output.keys()].find((name) => /^assets\/index-[\w-]{8}\.js$/.test(name))!;
    const bytes: Record<string, Uint8Array | string> = {
      "/": output.get("index.html")!,
      ...Object.fromEntries(Object.entries(binary).map(([name, value]) => [`/${name}`, value])),
      "/favicon.png": "favicon",
      "/guide/": guide,
      "/icon.png": "icône 漢字",
      "/manifest.webmanifest": JSON.stringify({ icons: [{ src: "/icon.png" }] }),
      [`/${chunk}`]: output.get(chunk)!,
    };
    expect(manifest.files).toEqual(
      Object.keys(bytes)
        .sort()
        .map((url) => ({
          byteSize: Buffer.byteLength(bytes[url]!),
          sha256: sha256(bytes[url]!),
          url,
        })),
    );
    expect(manifest.sounds).toEqual({ "/art/a": ["/art/a.ogg", "/art/a.mp3"] });
  });

  it("lists boot files from the final discovery and fails for one outside the build", async () => {
    const root = site("icon");
    const options = {
      emitted: { "art/a.ogg": "ogg", "art/sprite.png": "sprite" },
      hashedFiles: () => ({ sounds: { "/art/a": ["/art/a.ogg"] }, urls: ["/art/sprite.png"] }),
      root,
    };
    let seen: Parameters<NonNullable<PrecachePluginOptions["boot"]>>[0] | undefined;
    const { manifest } = await precache({
      ...options,
      boot: (files) => {
        seen = files;
        return ["/art/sprite.png", "/art/a.ogg"];
      },
    });
    expect(seen?.sounds).toEqual({ "/art/a": ["/art/a.ogg"] });
    expect(seen?.urls).toContain("/art/sprite.png");
    expect(manifest.boot).toEqual(["/art/sprite.png", "/art/a.ogg"]);
    const unbooted = await precache(options);
    expect(unbooted.manifest.version).not.toBe(manifest.version);
    await expect(precache({ ...options, boot: () => ["/missing.png"] })).rejects.toThrow(
      /Boot file \/missing\.png is not a build file/,
    );
  });

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
    const { manifest } = await precache(options);
    expect(manifest.verifiedJsonBodies).toEqual([
      { byteSize: Buffer.byteLength(text), sha256: sha256(text), urls: ["/a.json", "/b.json"] },
    ]);
    expect(fileMap(manifest).get("/b.json")).toEqual({
      byteSize: Buffer.byteLength(text),
      sha256: sha256(text),
      url: "/b.json",
    });
    const legacy = await precache({ hashedFiles: options.hashedFiles, lateEmitted: emitted, root });
    expect(legacy.manifest).not.toHaveProperty("verifiedJsonBodies");
    expect(legacy.manifest.version).not.toBe(manifest.version);
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
    expect(data.manifest.verifiedJsonBodies![0]!.responseProfile).toBe("fetch-json-data-v1");
    expect(data.manifest.version).not.toBe(legacy.manifest.version);
    expect(data.manifest.files).toEqual(legacy.manifest.files);
  });

  it("builds one self-contained classic worker with no manifest written in", async () => {
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
        "self.marker = __WORKER_MARKER__;",
    );
    const workerOf = async (icon: string) => {
      writeFileSync(join(root, "public/icon.png"), icon);
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
      return result.output;
    };
    const output = await workerOf("icon");
    const worker = output.find(({ fileName }) => fileName === "offline-worker.js");
    if (worker?.type !== "asset" || typeof worker.source !== "string") {
      throw new Error("missing worker");
    }
    const scope: Record<string, unknown> = {};
    new Script(worker.source).runInNewContext({ self: scope });
    expect(scope.total).toBe(11);
    expect(scope.marker).toBe("captured");
    expect(worker.source).toContain("downloadByteTotal");
    const page = output.filter((file) => file.type === "chunk");
    expect(page).toHaveLength(1);
    expect(page[0]?.imports).toEqual([]);
    expect(page[0]?.dynamicImports).toEqual([]);
    expect(page[0]?.code).toContain("downloadByteTotal");
    const redrawn = (await workerOf("redrawn")).find(
      ({ fileName }) => fileName === "offline-worker.js",
    );
    expect(redrawn?.type === "asset" ? redrawn.source : undefined).toBe(worker.source);
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

  it("binds the same full source ID into app, pointer, manifest and version", async () => {
    const { buildId, root } = cleanSite();
    const { manifest, output, pointer } = await precache({ buildId, root });
    expect(pointer.buildId).toBe(buildId);
    expect(manifest.buildId).toBe(buildId);
    const app = [...output].find(([name]) => /^assets\/index-/.test(name))![1];
    expect(Buffer.from(app).toString()).toContain(buildId);
    expect(Buffer.from(app).toString()).not.toContain("__BUILD_ID__");
    const again = await precache({ buildId, root });
    expect(again.manifest).toEqual(manifest);
  });

  it("rejects dirty, mismatched and undefined-app source identities", async () => {
    const { buildId, root } = cleanSite();
    await expect(precache({ buildId: "0".repeat(40), root })).rejects.toThrow(/clean source/);
    await expect(precache({ buildId: "dev", root })).rejects.toThrow(/clean source/);
    await expect(
      build({
        build: { write: false },
        configFile: false,
        logLevel: "silent",
        plugins: [
          precachePlugin({
            buildId,
            pageHtmlFile: "index.html",
            policy: POLICY,
            serviceWorkerSource: join(root, "sw.js"),
          }),
        ],
        root,
      }),
    ).rejects.toThrow(/app __BUILD_ID__/);
    writeFileSync(join(root, "untracked.txt"), "untracked");
    await expect(precache({ buildId, root })).rejects.toThrow(/clean source/);
  });

  it.each<[string, string, boolean]>([
    ["the same files", "icon", true],
    ["a changed public file", "redrawn", false],
  ])("versions a rebuild of %s the same: %s", async (_, icon, same) => {
    const root = site("icon");
    const first = await precache({ root });
    writeFileSync(join(root, "public/icon.png"), icon);
    const second = await precache({ root });
    expect(second.manifest.version === first.manifest.version).toBe(same);
    expect(fileMap(second.manifest).get("/icon.png")).toEqual({
      byteSize: Buffer.byteLength(icon),
      sha256: sha256(icon),
      url: "/icon.png",
    });
  });

  it.each<[string, Build, string | RegExp]>([
    [
      "a hashed file outside the build output",
      { hashedFiles: () => ({ sounds: { "/assets/a": ["/assets/a.ogg"] }, urls: [] }) },
      "precache: /assets/a.ogg are named but not in the build output",
    ],
    [
      "a sound alternative under two logical URLs",
      {
        emitted: { "art/a.ogg": "ogg" },
        hashedFiles: () => ({
          sounds: { "/art/a": ["/art/a.ogg"], "/art/b": ["/art/a.ogg"] },
          urls: [],
        }),
      },
      /Sound alternative \/art\/a\.ogg is listed more than once/,
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
      "a build file in the reserved manifest directory",
      { emitted: { ".game-kit/build.json": "{}" } },
      "precache: .game-kit/build.json is reserved for the build manifest",
    ],
  ])("fails the build for %s", async (_, options, message) => {
    await expect(precache(options)).rejects.toThrow(message);
  });
});
