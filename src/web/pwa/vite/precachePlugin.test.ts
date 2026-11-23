import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
import { gunzipSync } from "node:zlib";

import { build, type Plugin } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CI_COMMIT_VARIABLE } from "../../build/buildVersion.ts";
import { gitBuildMetadata, gitHead } from "../../build/vite/gitHead.ts";
import { parseBuildArchiveIndex, readBuildArchivePrefixSize } from "../buildArchive.ts";
import {
  BUILD_ARCHIVE_PART_BYTES,
  BUILD_POINTER_URL,
  buildArchivePartUrl,
  type BuildManifest,
  buildManifestUrl,
  type BuildPointer,
  GROUP_ARCHIVE_IDENTITY,
  updateGroupRecipesPath,
} from "../buildContract.ts";
import { UNKNOWN_BUILD_ID, validateBuildManifest, validateBuildPointer } from "../buildManifest.ts";
import { installedManifest, parseBuildPointer } from "../buildRecords.ts";
import type { CachePolicy } from "../cachePolicy.ts";
import { assertClassicWorker } from "./classicWorker.ts";
import { precachePlugin, type PrecachePluginOptions } from "./precachePlugin.ts";

const POLICY: CachePolicy = {
  cacheNamePrefix: "game-",
  hashedAssetPrefix: "/assets/",
};

afterEach(() => vi.unstubAllEnvs());

const sha256 = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function cleanSite(icon = "icon"): { root: string; buildId: string } {
  vi.stubEnv(CI_COMMIT_VARIABLE, "");
  const root = site(icon);
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
  readonly packs?: PrecachePluginOptions["packs"];
  readonly buildId?: string | undefined;
  readonly emitUpdateGroupRecipes?: PrecachePluginOptions["emitUpdateGroupRecipes"];
  readonly verifiedJsonBodies?: PrecachePluginOptions["verifiedJsonBodies"];
  readonly lateEmitted?: Readonly<Record<string, string>>;
  // Files a plugin before the precache writes into the build output, by file name.
  readonly emitted?: Readonly<Record<string, string | Uint8Array>>;
  readonly hashedFiles?: PrecachePluginOptions["hashedFiles"];
  // A public file to delete from the site before building.
  readonly missing?: string;
  // A public file to replace with a directory, which the build cannot read.
  readonly unreadable?: string;
  readonly updateGroup?: PrecachePluginOptions["updateGroup"];
  readonly wholeBuild?: PrecachePluginOptions["wholeBuild"];
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
  emitUpdateGroupRecipes,
  emitted = {},
  hashedFiles,
  lateEmitted = {},
  missing,
  packs,
  root = site("icon"),
  unreadable,
  updateGroup,
  verifiedJsonBodies,
  wholeBuild,
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
        ...(emitUpdateGroupRecipes === undefined ? {} : { emitUpdateGroupRecipes }),
        ...(hashedFiles === undefined ? {} : { hashedFiles }),
        pageHtmlFile: "index.html",
        ...(packs === undefined ? {} : { packs }),
        policy: POLICY,
        serviceWorkerSource: join(root, "sw.js"),
        ...(updateGroup === undefined ? {} : { updateGroup }),
        ...(verifiedJsonBodies === undefined ? {} : { verifiedJsonBodies }),
        ...(wholeBuild === undefined ? {} : { wholeBuild }),
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
  const { archive, groups, ...legacyPointer } = parseBuildPointer(json(BUILD_POINTER_URL.slice(1)));
  const pointer = {
    ...validateBuildPointer(legacyPointer),
    ...(archive === undefined ? {} : { archive }),
    ...(groups === undefined ? {} : { groups }),
  };
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

  it("emits deterministic bounded packs while keeping individual files and sound formats", async () => {
    const emitted = {
      "art/a.svg": "<svg>a".repeat(42),
      "art/family-a.json": '{"a":1}',
      "art/family-b.json": '{"a":1}',
      "art/one.m4a": "m4a1".repeat(48),
      "art/one.ogg": "ogg1".repeat(48),
      "art/two.m4a": "m4a2".repeat(48),
      "art/two.ogg": "ogg2".repeat(48),
      "art/z.svg": "<svg>z".repeat(42),
    };
    const root = site("icon");
    const options: Build = {
      hashedFiles: () => ({
        sounds: {
          "/one": ["/art/one.ogg", "/art/one.m4a"],
          "/two": ["/art/two.ogg", "/art/two.m4a"],
        },
        urls: ["/art/z.svg", "/art/a.svg", "/art/family-a.json", "/art/family-b.json"],
      }),
      root,
      verifiedJsonBodies: () => [["/art/family-a.json", "/art/family-b.json"]],
    };
    const packed = await precache({ ...options, emitted, packs: { maxBytes: 504 } });
    const reordered = await precache({
      ...options,
      emitted: Object.fromEntries(Object.entries(emitted).reverse()),
      packs: { maxBytes: 504 },
    });
    const plain = await precache({ ...options, emitted });
    const wider = await precache({ ...options, emitted, packs: { maxBytes: 1024 } });
    expect(packed.manifest).toEqual(reordered.manifest);
    expect(packed.manifest.files).toEqual(plain.manifest.files);
    expect(plain.manifest).not.toHaveProperty("packs");
    expect(packed.pointer.version).not.toBe(plain.pointer.version);
    expect(packed.pointer.version).not.toBe(wider.pointer.version);
    const sizes = fileMap(packed.manifest);
    const packs = packed.manifest.packs!;
    expect(packs.map((pack) => pack.members)).toContainEqual(["/art/a.svg", "/art/z.svg"]);
    expect(packs.map((pack) => pack.members)).toContainEqual(["/art/one.ogg", "/art/two.ogg"]);
    expect(packs.map((pack) => pack.members)).toContainEqual(["/art/one.m4a", "/art/two.m4a"]);
    for (const { encodedByteSize, encoding, members, url } of packs) {
      const pack = packed.output.get(url.slice(1))!;
      const decoded = gunzipSync(pack);
      expect(sizes.has(url)).toBe(false);
      expect(encoding).toBe("gzip");
      expect(encodedByteSize).toBe(pack.byteLength);
      expect([...pack.subarray(4, 8)]).toEqual([0, 0, 0, 0]);
      expect(pack[9]).toBe(255);
      expect(pack.byteLength).toBeLessThan(decoded.byteLength);
      expect(decoded.byteLength).toBeLessThanOrEqual(504);
      expect(decoded.byteLength).toBe(
        members.reduce((sum, member) => sum + sizes.get(member)!.byteSize, 0),
      );
      expect(members).toEqual([...members].sort());
      expect(members).not.toContain("/art/family-a.json");
      expect(members).not.toContain("/art/family-b.json");
      expect(pack).toEqual(reordered.output.get(url.slice(1)));
    }
    const art = packs.find((pack) => pack.members.includes("/art/a.svg"))!;
    expect(gunzipSync(packed.output.get(art.url.slice(1))!).toString()).toBe(
      emitted["art/a.svg"] + emitted["art/z.svg"],
    );
    expect(Buffer.from(packed.output.get("art/a.svg")!).toString()).toBe(emitted["art/a.svg"]);
    expect(
      installedManifest("ogg", packed.manifest).packs?.flatMap(({ members }) => members),
    ).not.toContain("/art/one.m4a");
  });

  it("emits bounded parts of one verified archive covering every legacy manifest file", async () => {
    const root = site("icon");
    writeFileSync(
      join(root, "index.html"),
      INDEX.replace("</head>", '<link href="/guide/index.html"></head>'),
    );
    mkdirSync(join(root, "public/guide"));
    const guide = "<!doctype html><p>Guide</p>";
    writeFileSync(join(root, "public/guide/index.html"), guide);
    const emitted = {
      "art/hit.m4a": new Uint8Array([1, 2, 3]),
      "art/hit.ogg": new Uint8Array([4, 5, 6]),
      "assets/OFL.txt": "Font licence, droits réservés\r\n",
      "assets/data.json": '{"ok":true}',
      "assets/empty.bin": new Uint8Array(),
      "assets/extra.json": JSON.stringify({ value: "a".repeat(200) }),
      "assets/font.woff2": "font",
      "assets/layout.css": "body { color: black; }",
      "assets/spanning.bin": new Uint8Array(BUILD_ARCHIVE_PART_BYTES + 1).fill(0xa5),
    };
    const options: Build = {
      boot: () => ["/assets/data.json"],
      emitted,
      hashedFiles: () => ({
        sounds: { "/art/hit": ["/art/hit.ogg", "/art/hit.m4a"] },
        urls: Object.keys(emitted)
          .filter((name) => name.startsWith("assets/"))
          .map((name) => `/${name}`),
      }),
      packs: { maxBytes: 1024 },
      root,
    };
    const legacy = await precache(options);
    const { manifest, output, pointer } = await precache({ ...options, wholeBuild: true });
    expect(legacy.pointer).not.toHaveProperty("archive");
    expect(pointer.version).not.toBe(legacy.pointer.version);
    expect(manifest).toEqual({ ...legacy.manifest, version: pointer.version });
    expect(manifest.packs?.length).toBeGreaterThan(0);
    const { archive } = pointer;
    expect(archive).toBeDefined();
    const partNames = [0, 1].map((index) => buildArchivePartUrl(archive!, index).slice(1));
    expect(
      [...output.keys()].filter((name) => name.startsWith(".game-kit/archive-")).sort(),
    ).toEqual(partNames);
    const parts = partNames.map((name) => output.get(name)!);
    expect(parts.map((part) => part.byteLength)).toEqual([
      BUILD_ARCHIVE_PART_BYTES,
      archive!.byteSize - BUILD_ARCHIVE_PART_BYTES,
    ]);
    const bytes = Buffer.concat(parts);
    expect(archive).toEqual({ byteSize: bytes.byteLength, schema: 1, sha256: sha256(bytes) });
    const prefixSize = readBuildArchivePrefixSize(bytes.byteLength, bytes);
    const index = parseBuildArchiveIndex(pointer, bytes.byteLength, bytes.subarray(0, prefixSize));
    expect(index.files.map(({ url }) => url)).toEqual(manifest.files.map(({ url }) => url));
    const media = new Map(index.files.map(({ contentType, url }) => [url, contentType]));
    expect(Object.fromEntries(media)).toMatchObject({
      "/": "text/html; charset=utf-8",
      "/art/hit.m4a": "audio/mp4",
      "/art/hit.ogg": "audio/ogg",
      "/assets/OFL.txt": "text/plain; charset=utf-8",
      "/assets/data.json": "application/json",
      "/assets/font.woff2": "font/woff2",
      "/assets/layout.css": "text/css; charset=utf-8",
      "/guide/": "text/html; charset=utf-8",
      "/manifest.webmanifest": "application/manifest+json",
    });
    const script = index.files.find(({ url }) => url.endsWith(".js"))!;
    expect(script.contentType).toBe("text/javascript; charset=utf-8");
    expect(output.get(script.url.slice(1))).toEqual(legacy.output.get(script.url.slice(1)));
    const files = fileMap(manifest);
    for (const { byteSize, offset, url } of index.files) {
      expect({ byteSize, sha256: sha256(bytes.subarray(offset, offset + byteSize)), url }).toEqual(
        files.get(url),
      );
    }
  });

  it("emits a sorted, complete group partition and reuses unchanged bytes across build IDs", async () => {
    const firstSite = cleanSite();
    const nextSite = cleanSite("next icon");
    const emitted = {
      "art/a.svg": `<svg>${"a".repeat(300)}</svg>`,
      "art/body.fnt": '<font><info face="Bitmap" /></font>',
      "art/z.svg": `<svg>${"z".repeat(300)}</svg>`,
    };
    const options: Build = {
      emitted,
      hashedFiles: () => ({ sounds: {}, urls: ["/art/z.svg", "/art/body.fnt", "/art/a.svg"] }),
      packs: { maxBytes: 1024 },
      updateGroup: (url) => (url.startsWith("/art/") ? "a-art" : "Z-core"),
    };
    const initial = await precache({ ...options, ...firstSite });
    const next = await precache({
      ...options,
      ...nextSite,
      hashedFiles: () => ({ sounds: {}, urls: ["/art/a.svg", "/art/body.fnt", "/art/z.svg"] }),
    });
    const withRecipes = await precache({
      ...options,
      ...nextSite,
      emitUpdateGroupRecipes: true,
      hashedFiles: () => ({ sounds: {}, urls: ["/art/a.svg", "/art/body.fnt", "/art/z.svg"] }),
    });
    const recipeName = updateGroupRecipesPath(next.manifest.version).slice(1);
    expect(next.output.has(recipeName)).toBe(false);
    expect([...withRecipes.output.keys()].filter((name) => !next.output.has(name))).toEqual([
      recipeName,
    ]);
    expect(new Map([...withRecipes.output].filter(([name]) => name !== recipeName))).toEqual(
      next.output,
    );

    expect(initial.pointer.buildId).not.toBe(next.pointer.buildId);
    expect(initial.pointer.version).not.toBe(next.pointer.version);
    expect(initial.pointer).not.toHaveProperty("archive");
    expect(next.manifest.packs?.flatMap(({ members }) => members)).toEqual(
      expect.arrayContaining(["/art/a.svg", "/art/z.svg"]),
    );
    const bytesOf = ({ output }: Built, group: NonNullable<BuildPointer["groups"]>[number]) =>
      output.get(buildArchivePartUrl(group, 0).slice(1))!;
    const [core, art] = next.pointer.groups!;
    expect(next.pointer.groups).toHaveLength(2);
    expect(core).not.toEqual(initial.pointer.groups?.[0]);
    expect(art).toEqual(initial.pointer.groups?.[1]);
    expect(bytesOf(next, art!)).toEqual(bytesOf(initial, art!));
    const identity = { buildId: GROUP_ARCHIVE_IDENTITY, version: GROUP_ARCHIVE_IDENTITY };
    const files = fileMap(next.manifest);
    const recipes = next.pointer.groups!.map((group) => {
      const bytes = bytesOf(next, group);
      expect(group).toEqual({ byteSize: bytes.byteLength, schema: 1, sha256: sha256(bytes) });
      const index = parseBuildArchiveIndex(identity, bytes.byteLength, bytes);
      const entries = index.files.map(({ byteSize, contentType, offset, url }) => {
        if (url === "/art/body.fnt") {
          expect(contentType).toBe("text/xml; charset=utf-8");
        }
        const digest = sha256(bytes.subarray(offset, offset + byteSize));
        expect({ byteSize, sha256: digest, url }).toEqual(files.get(url));
        return [url, byteSize, contentType, digest] as const;
      });
      return { archive: group, files: entries };
    });
    expect(JSON.parse(Buffer.from(withRecipes.output.get(recipeName)!).toString())).toEqual({
      groups: recipes,
      schema: 1,
    });
    const urls = recipes.map(({ files }) => files.map(([url]) => url));
    expect(urls[0]).toContain("/");
    expect(urls[1]).toEqual(["/art/a.svg", "/art/body.fnt", "/art/z.svg"]);
    expect(urls.flat().sort()).toEqual([...files.keys()].sort());
    expect(Buffer.from(next.output.get("art/a.svg")!).toString()).toBe(emitted["art/a.svg"]);

    const regrouped = await precache({
      ...options,
      ...nextSite,
      updateGroup: (url) => (url.startsWith("/art/") || url === "/icon.png" ? "a-art" : "Z-core"),
    });
    expect(regrouped.pointer.version).not.toBe(next.pointer.version);
    expect(regrouped.manifest.files).toEqual(next.manifest.files);
  });

  it.each(["specific-file updates", "groups"] as const)(
    "allows 100 units and rejects 101 in %s",
    async (mode) => {
      const build = (extra: number) => {
        const names = Array.from({ length: extra }, (_, index) => `art/file-${index}.bin`);
        const updateGroup = (url: string) =>
          url === "/" ? "home" : url.slice(1).replaceAll("/", ":");
        return precache({
          emitted: Object.fromEntries(names.map((name) => [name, "x"])),
          hashedFiles: () => ({ sounds: {}, urls: names.map((name) => `/${name}`) }),
          ...(mode === "groups" ? { updateGroup } : {}),
        });
      };
      // The fixture discovers five files without the extra assets.
      const allowed = await build(95);
      expect(allowed.manifest.files).toHaveLength(100);
      if (mode === "groups") {
        expect(allowed.pointer.groups).toHaveLength(100);
      }
      await expect(build(96)).rejects.toThrow(
        mode === "groups" ? /101 groups.*100/ : /specific-file updates list 101 files.*100/,
      );
    },
  );

  it("rejects a group exceeding one transport part after accounting for the index", async () => {
    await expect(
      precache({
        emitted: { "art/large.bin": new Uint8Array(BUILD_ARCHIVE_PART_BYTES) },
        hashedFiles: () => ({ sounds: {}, urls: ["/art/large.bin"] }),
        updateGroup: (url) => (url === "/art/large.bin" ? "large" : "other"),
      }),
    ).rejects.toThrow(/update group "large".*including its index.*Split the group/);
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
    const shared = fileURLToPath(new URL("../buildContract.ts", import.meta.url));
    writeFileSync(
      join(root, "main.js"),
      'import { buildManifestUrl } from "@contract"; console.log(buildManifestUrl("page"));',
    );
    writeFileSync(
      join(root, "sw.js"),
      'import { buildManifestUrl } from "@contract";' +
        'self.total = buildManifestUrl("worker");' +
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
        resolve: { alias: { "@contract": shared } },
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
    expect(scope.total).toBe("/.game-kit/manifest-worker.json");
    expect(scope.marker).toBe("captured");
    expect(worker.source).toContain("buildManifestUrl");
    const page = output.filter((file) => file.type === "chunk");
    expect(page).toHaveLength(1);
    expect(page[0]?.imports).toEqual([]);
    expect(page[0]?.dynamicImports).toEqual([]);
    expect(page[0]?.code).toContain("buildManifestUrl");
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
        resolve: { alias: { "@contract": shared } },
        root,
        worker: { rolldownOptions: { external: ["@contract"] } },
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
    [
      "a missing update group identifier",
      { updateGroup: () => "" },
      /updateGroup\("\/"\) must return a nonempty group identifier/,
    ],
    [
      "update group recipes without update groups",
      { emitUpdateGroupRecipes: true },
      "precache: emitUpdateGroupRecipes requires updateGroup",
    ],
    [
      "grouped and whole-build modes together",
      { updateGroup: () => "all", wholeBuild: true },
      "precache: choose updateGroup or wholeBuild",
    ],
    [
      "an archive file with an unknown media type",
      {
        emitted: { "art/a.unknown": "art" },
        hashedFiles: () => ({ sounds: {}, urls: ["/art/a.unknown"] }),
        wholeBuild: true,
      },
      "precache: Unknown build archive content type for /art/a.unknown",
    ],
    [
      "a noncanonical archive URL",
      {
        emitted: { "art/%61.png": "art" },
        hashedFiles: () => ({ sounds: {}, urls: ["/art/%61.png"] }),
        wholeBuild: true,
      },
      "precache: Invalid or duplicate build archive path",
    ],
  ])("fails the build for %s", async (_, options, message) => {
    await expect(precache(options)).rejects.toThrow(message);
  });
});
