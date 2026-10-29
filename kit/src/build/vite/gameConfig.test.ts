import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PluginOption } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ViteUserConfig } from "vitest/config";

import { PHASER_ENTRY_ID } from "../phaserBuild";
import { gameViteConfig } from "./gameConfig";

// A game's repository, laid out as gameViteConfig expects, whose config module imports the kit
// by its alias.
const repo = mkdtempSync(join(tmpdir(), "game-config-"));
afterAll(() => rmSync(repo, { force: true, recursive: true }));

interface Modules {
  readonly marker: string;
}

let config: ViteUserConfig;
const seen: { modules?: Modules; repoPath?: string } = {};
const plugin: PluginOption = { name: "game-plugin" };

beforeAll(async () => {
  mkdirSync(join(repo, "vendor/game-kit/src"), { recursive: true });
  mkdirSync(join(repo, "src/tools"), { recursive: true });
  writeFileSync(join(repo, "package.json"), JSON.stringify({ version: "1.2.3" }));
  writeFileSync(join(repo, "vendor/game-kit/src/marker.ts"), 'export const MARKER = "kit";\n');
  writeFileSync(
    join(repo, "src/tools/configModules.ts"),
    'export { MARKER as marker } from "@andornaut/game-kit/marker";\n',
  );
  config = await gameViteConfig<Modules>({
    chunkSizeWarningLimit: 1100,
    configModules: "src/tools/configModules.ts",
    pages: { main: "pages/index.html", play: "pages/play/index.html" },
    plugins: (modules, repoPath) => {
      seen.modules = modules;
      seen.repoPath = repoPath("x");
      return [plugin];
    },
    previewHost: "game-preview",
    repoRoot: repo,
    testTimeout: 30_000,
  });
}, 30_000);

describe("gameViteConfig", () => {
  it("loads the game's plugins from its config module, given the kit's alias", () => {
    // The module runner gives a module namespace, so its export is compared, not the object.
    expect([seen.modules?.marker, seen.repoPath]).toEqual(["kit", join(repo, "x")]);
    expect(config.plugins).toEqual([plugin]);
  });

  it.each<[string, (built: ViteUserConfig) => unknown, unknown]>([
    ["roots Vite at pages/", (built) => built.root, join(repo, "pages")],
    ["builds to dist/", (built) => built.build?.outDir, join(repo, "dist")],
    ["copies public/", (built) => built.publicDir, join(repo, "public")],
    [
      "builds each page in order",
      (built) => built.build?.rolldownOptions?.input,
      { main: join(repo, "pages/index.html"), play: join(repo, "pages/play/index.html") },
    ],
    [
      "aliases /src and the kit",
      (built) => built.resolve?.alias,
      { "/src": join(repo, "src"), "@andornaut/game-kit": join(repo, "vendor/game-kit/src") },
    ],
    ["names the package's version", (built) => built.define?.__APP_VERSION__, '"1.2.3"'],
    ["answers the preview host", (built) => built.preview?.allowedHosts, ["game-preview"]],
    ["answers the dev host", (built) => built.server?.allowedHosts, ["game-preview"]],
    ["warns past the chunk limit", (built) => built.build?.chunkSizeWarningLimit, 1100],
    [
      "tests the kit and the game",
      (built) => built.test?.include,
      ["vendor/game-kit/src/**/*.test.ts", "src/**/*.test.ts"],
    ],
    ["gives each test its time", (built) => built.test?.testTimeout, 30_000],
  ])("%s", (_case, read, expected) => {
    expect(read(config)).toEqual(expected);
  });

  it.each([
    ["the build's Phaser entry", PHASER_ENTRY_ID, true],
    ["Phaser's package", "/repo/node_modules/phaser/src/core/Game.js", true],
    ["the game's code", "/repo/src/main.ts", false],
  ])("puts %s in the Phaser chunk: %s", (_case, id, inChunk) => {
    const output = config.build?.rolldownOptions?.output;
    const groups = (output as { codeSplitting: { groups: { test: (id: string) => boolean }[] } })
      .codeSplitting.groups;
    expect(groups.some((group) => group.test(id))).toBe(inChunk);
  });
});
