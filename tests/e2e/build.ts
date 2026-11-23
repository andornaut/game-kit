// Builds the fixture game's deployments with Vite and the kit's own precachePlugin. Each variant
// in VARIANTS changes a known set of files from the one before it, so the runner can predict
// which files an update fetches.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { build, type Plugin } from "vite";

import {
  BUILD_POINTER_URL,
  type BuildManifest,
  type BuildPointer,
} from "../../src/web/pwa/buildContract.ts";
import { validateBuildManifest, validateBuildPointer } from "../../src/web/pwa/buildManifest.ts";
import { parseBuildPointer } from "../../src/web/pwa/buildRecords.ts";
import { precachePlugin } from "../../src/web/pwa/vite/precachePlugin.ts";
import { POLICY } from "./fixture/policy.ts";

const FIXTURE = fileURLToPath(new URL("fixture/", import.meta.url));

// a: the first deployment. a2: a redeploy during the first install that changes the page, the
// code and the last hashed assets the installer fetches. b and c: updates. d: an update whose
// download the server fails.
export const VARIANTS = ["a", "a2", "b", "c", "d"] as const;
export type Variant = (typeof VARIANTS)[number];

export interface FixtureSize {
  // Small binary files under /assets/f/.
  readonly files: number;
  // Each one's approximate byte size.
  readonly fileBytes: number;
}

export interface Deployment {
  readonly variant: Variant;
  readonly directory: string;
  readonly manifest: BuildManifest;
  readonly pointer: BuildPointer;
}

const LEVELS = 7;
// Sounds under /assets/s/, each with an alternative per format; the fixture page plays ogg.
const SOUNDS = 3;
const SOUND_FORMATS = ["ogg", "m4a"] as const;
const SHARED_JSON = ["/data/shared-a.json", "/data/shared-b.json"];
const INDEX_URL = "/data/index.json";

// The asset indexes each variant changes from the one before it.
function changedAssets(variant: Variant, files: number): number[] {
  const spread = (count: number, offset: number) =>
    Array.from({ length: count }, (_, k) => Math.floor((files * (k + 1)) / (count + 1)) + offset);
  switch (variant) {
    case "a":
      return [];
    case "a2":
      // The last files the installer fetches, so a redeploy at 70% reaches them before they are
      // stored.
      return Array.from({ length: 5 }, (_, k) => files - 1 - k);
    case "b":
      return spread(8, 0);
    case "c":
      return spread(6, 1);
    case "d":
      return spread(4, 2);
  }
  throw new RangeError(`Unknown variant ${String(variant)}`);
}

// The variant whose content asset index has in variant: the last one up to it that changed it.
function assetKey(variant: Variant, files: number, index: number): Variant {
  let key: Variant = "a";
  for (const step of VARIANTS.slice(0, VARIANTS.indexOf(variant) + 1)) {
    if (changedAssets(step, files).includes(index)) {
      key = step;
    }
  }
  return key;
}

// Deterministic incompressible bytes.
function noise(seed: string, size: number): Buffer {
  const out = Buffer.alloc(size);
  let block = createHash("sha256").update(seed).digest();
  for (let offset = 0; offset < size; offset += block.length) {
    block.copy(out, offset);
    block = createHash("sha256").update(block).digest();
  }
  return out;
}

function fixtureFiles(
  variant: Variant,
  size: FixtureSize,
  emitted: { readonly sounds: Record<string, string[]>; readonly urls: string[] },
): Plugin {
  const { sounds, urls } = emitted;
  return {
    buildStart() {
      const emit = (url: string, source: Uint8Array | string) => {
        urls.push(url);
        this.emitFile({ fileName: url.slice(1), source, type: "asset" });
      };
      for (let index = 0; index < size.files; index += 1) {
        const key = assetKey(variant, size.files, index);
        const bytes = noise(`${index}:${key}`, size.fileBytes + (index % 7) * 97);
        const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 8);
        emit(`/assets/f/${String(index).padStart(5, "0")}-${hash}.bin`, bytes);
      }
      for (let index = 0; index < SOUNDS; index += 1) {
        const logical = `/assets/s/sound-${index}`;
        sounds[logical] = SOUND_FORMATS.map((format) => {
          const bytes = noise(`${logical}.${format}`, 2000);
          const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 8);
          const url = `${logical}-${hash}.${format}`;
          this.emitFile({ fileName: url.slice(1), source: bytes, type: "asset" });
          return url;
        });
      }
      const levels = Array.from({ length: LEVELS }, (_, level) => `/data/level-${level}.json`);
      levels.forEach((url, level) => {
        const key = level === 3 && VARIANTS.indexOf(variant) >= VARIANTS.indexOf("b") ? "b" : "a";
        emit(url, JSON.stringify({ key, level, tiles: noise(url + key, 600).toString("hex") }));
      });
      const shared = JSON.stringify({ shared: noise("shared", 300).toString("hex") });
      for (const url of SHARED_JSON) {
        emit(url, shared);
      }
      emit(INDEX_URL, JSON.stringify({ files: [...levels, ...SHARED_JSON], variant }));
    },
    name: "e2e-fixture-files",
  };
}

export function readDeployment(variant: Variant, directory: string): Deployment {
  const json = (url: string): unknown => JSON.parse(readFileSync(join(directory, url), "utf8"));
  const { archive, groups, ...legacyPointer } = parseBuildPointer(json(BUILD_POINTER_URL));
  const pointer = {
    ...validateBuildPointer(legacyPointer),
    ...(archive === undefined ? {} : { archive }),
    ...(groups === undefined ? {} : { groups }),
  };
  return { directory, manifest: validateBuildManifest(json(pointer.manifest)), pointer, variant };
}

export async function buildDeployment(
  context: {
    readonly outRoot: string;
    readonly size: FixtureSize;
    readonly updateGroup?: (url: string) => string;
    readonly wholeBuild?: true;
  },
  variant: Variant,
): Promise<Deployment> {
  const directory = join(context.outRoot, variant);
  const urls: string[] = [];
  const sounds: Record<string, string[]> = {};
  await build({
    build: {
      emptyOutDir: true,
      minify: false,
      outDir: directory,
      rolldownOptions: { input: join(FIXTURE, "play/index.html") },
    },
    configFile: false,
    define: { __VARIANT__: JSON.stringify(variant) },
    envDir: false,
    logLevel: "warn",
    plugins: [
      fixtureFiles(variant, context.size, { sounds, urls }),
      precachePlugin({
        boot: () => [
          INDEX_URL,
          ...urls.filter((url) => url.startsWith("/data/level-")),
          ...SHARED_JSON,
        ],
        hashedFiles: () => ({ sounds, urls }),
        pageHtmlFile: "play/index.html",
        policy: POLICY,
        serviceWorkerSource: join(FIXTURE, "sw.ts"),
        ...(context.updateGroup === undefined ? {} : { updateGroup: context.updateGroup }),
        verifiedJsonBodies: () => [SHARED_JSON],
        ...(context.wholeBuild === true ? { wholeBuild: true } : {}),
      }),
    ],
    publicDir: false,
    root: FIXTURE,
  });
  return readDeployment(variant, directory);
}
