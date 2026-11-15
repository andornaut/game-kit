import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PluginOption } from "vite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ViteUserConfig } from "vitest/config";

import { type BuildMetadata, CI_COMMIT_VARIABLE } from "../buildVersion.ts";
import { PHASER_ENTRY_ID } from "../phaserBuild.ts";
import { gameViteConfig } from "./gameConfig.ts";
import { gitHead } from "./gitHead.ts";

// A game's repository, laid out as gameViteConfig expects, whose config module imports an
// installed package through its exports.
const repo = mkdtempSync(join(tmpdir(), "game-config-"));
const CI_SHA = "16d17c38a1b2c3d4e5f60718293a4b5c6d7e8f90";
afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(repo, { force: true, recursive: true });
});

interface Modules {
  readonly marker: string;
}

let config: ViteUserConfig;
const seen: { modules?: Modules; repoPath?: string } = {};
const plugin: PluginOption = { name: "game-plugin" };

beforeAll(async () => {
  const kit = join(repo, "node_modules/@andornaut/game-kit");
  mkdirSync(join(kit, "dist"), { recursive: true });
  mkdirSync(join(repo, "src/tools"), { recursive: true });
  writeFileSync(
    join(kit, "package.json"),
    JSON.stringify({
      exports: { "./marker": "./dist/marker.js" },
      name: "@andornaut/game-kit",
      type: "module",
    }),
  );
  writeFileSync(join(kit, "dist/marker.js"), 'export const MARKER = "kit";\n');
  writeFileSync(join(repo, "package.json"), JSON.stringify({ version: "1.2.3" }));
  writeFileSync(
    join(repo, "src/tools/configModules.ts"),
    'export { MARKER as marker } from "@andornaut/game-kit/marker";\n',
  );
  writeFileSync(join(repo, ".gitignore"), "node_modules/\ndist/\n");
  execFileSync("git", ["init", "--quiet", repo]);
  execFileSync("git", ["-C", repo, "add", "."]);
  execFileSync("git", [
    "-C",
    repo,
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
  vi.stubEnv(CI_COMMIT_VARIABLE, CI_SHA);
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
  it("shares one immutable clean app/plugin ID and withholds it when dirty", async () => {
    const head = gitHead(repo).trim();
    vi.stubEnv(CI_COMMIT_VARIABLE, head);
    let seenMetadata: BuildMetadata | undefined;
    const configure = () =>
      gameViteConfig<Modules>({
        chunkSizeWarningLimit: 1100,
        configModules: "src/tools/configModules.ts",
        pages: { main: "pages/index.html" },
        plugins: (_modules, _repoPath, metadata) => {
          seenMetadata = metadata;
          return [];
        },
        previewHost: undefined,
        repoRoot: repo,
        testTimeout: 30_000,
      });
    const clean = await configure();
    expect(seenMetadata).toEqual({ buildId: head, commit: head.slice(0, 8) });
    expect(Object.isFrozen(seenMetadata)).toBe(true);
    expect(clean.define?.__BUILD_ID__).toBe(JSON.stringify(seenMetadata!.buildId));
    expect(clean.define?.__COMMIT__).toBe(JSON.stringify(head.slice(0, 8)));
    writeFileSync(join(repo, "untracked.txt"), "change");
    try {
      const dirty = await configure();
      expect(seenMetadata?.buildId).toBeUndefined();
      expect(dirty.define?.__BUILD_ID__).toBe("undefined");
      expect(dirty.define?.__COMMIT__).toBe(clean.define?.__COMMIT__);
    } finally {
      rmSync(join(repo, "untracked.txt"));
    }
  });

  it("loads the game's plugins from its config module, through the installed package", () => {
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
      "aliases only the game source",
      (built) => built.resolve?.alias,
      { "/src": join(repo, "src") },
    ],
    ["names the package's version", (built) => built.define?.__APP_VERSION__, '"1.2.3"'],
    ["names CI's commit", (built) => built.define?.__COMMIT__, JSON.stringify(CI_SHA.slice(0, 8))],
    ["answers the preview host", (built) => built.preview?.allowedHosts, ["game-preview"]],
    ["answers the dev host", (built) => built.server?.allowedHosts, ["game-preview"]],
    ["warns past the chunk limit", (built) => built.build?.chunkSizeWarningLimit, 1100],
    ["runs only game-owned tests", (built) => built.test?.include, ["src/**/*.test.ts"]],
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
