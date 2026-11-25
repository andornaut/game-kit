import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { build } from "vite";
import { describe, expect, it } from "vitest";

import { PHASER_ENTRY_ID, type PhaserBuild, phaserExports } from "../phaserBuild.ts";
import { phaserBuildPlugin } from "./phaserBuildPlugin.ts";
import { phaserSourceDir } from "./phaserSource.ts";

const SOURCE_DIR = phaserSourceDir();
// Every namespace, so a build omitting them all bundles only the entry's constants and polyfills.
const NAMESPACES = [
  ...phaserExports(readFileSync(join(SOURCE_DIR, "phaser-esm.js"), "utf8")).namespaces.keys(),
];
// A module of Phaser's source with a block per renderer flag, each requiring that renderer.
const LAYER_RENDER = join(SOURCE_DIR, "tilemaps/TilemapLayerRender.js");
const WEBGL = join(SOURCE_DIR, "tilemaps/TilemapLayerWebGLRenderer.js");
const CANVAS = join(SOURCE_DIR, "tilemaps/TilemapLayerCanvasRenderer.js");

// Builds an entry importing Phaser's VERSION and LAYER_RENDER in memory, and returns the ids of
// the modules it bundled.
async function bundledModules(phaser: PhaserBuild): Promise<string[]> {
  const root = mkdtempSync(join(tmpdir(), "kit-phaser-build-"));
  writeFileSync(
    join(root, "main.js"),
    `import { VERSION } from "phaser";\nimport layer from ${JSON.stringify(LAYER_RENDER)};\n` +
      "console.log(VERSION, layer);\n",
  );
  const result = await build({
    build: { lib: { entry: join(root, "main.js"), formats: ["es"] }, minify: false, write: false },
    configFile: false,
    logLevel: "silent",
    plugins: [phaserBuildPlugin(phaser)],
    root,
  });
  return (Array.isArray(result) ? result : [result])
    .flatMap((output) => ("output" in output ? output.output : []))
    .flatMap((file) => (file.type === "chunk" ? file.moduleIds : []));
}

describe("phaserBuildPlugin", { timeout: 60_000 }, () => {
  it.each<[string, Record<string, boolean>, string[], string[]]>([
    ["Phaser's own flags", {}, [WEBGL, CANVAS], []],
    ["CANVAS_RENDERER false", { CANVAS_RENDERER: false }, [WEBGL], [CANVAS]],
    ["WEBGL_RENDERER false", { WEBGL_RENDERER: false }, [CANVAS], [WEBGL]],
  ])("bundles Phaser's source with %s", async (_, flags, kept, dropped) => {
    const ids = await bundledModules({ flags, omitted: NAMESPACES });
    expect(ids).toEqual(expect.arrayContaining([PHASER_ENTRY_ID, join(SOURCE_DIR, "const.js")]));
    expect(ids).toEqual(expect.arrayContaining(kept));
    expect(ids.filter((id) => dropped.includes(id))).toEqual([]);
    // An omitted namespace no kept module requires is left out.
    expect(ids).not.toContain(join(SOURCE_DIR, "sound/index.js"));
  });
});
