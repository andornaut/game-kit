// A game's whole Vite and Vitest config, for its vite.config.ts to export:
//
//   import type * as ConfigModules from "./src/tools/viteConfigModules";
//   import { gameViteConfig } from "@andornaut/game-kit/build/vite/gameConfig";
//   export default gameViteConfig<typeof ConfigModules>({ ... });
//
// The game installs this source package as file:vendor/game-kit. Vite and its module runner
// resolve the same explicit package exports before and after loading the config.
//
// The game's repository is laid out as: pages/ (Vite's root; each HTML page's path under it is its
// URL, and pages load modules as /src/...), public/ (copied as is), src/, vendor/game-kit/src/,
// package.json (its version is __APP_VERSION__), and the build writes dist/.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { type PluginOption, runnerImport } from "vite";
import type { ViteUserConfig } from "vitest/config";

import { gitHead, shortCommit } from "../buildVersion";
import { PHASER_ENTRY_ID } from "../phaserBuild";

export interface GameViteOptions<Modules> {
  // The size in kB past which the build warns about a chunk: just above the largest, so growth
  // still warns.
  readonly chunkSizeWarningLimit: number;
  // The module (relative to repoRoot) that exports what plugins needs from the game's code.
  readonly configModules: string;
  // Each page's entry name and HTML file, relative to repoRoot, in build input order.
  readonly pages: Readonly<Record<string, string>>;
  // The game's plugins, given configModules' exports and repoPath.
  readonly plugins: (modules: Modules, repoPath: (path: string) => string) => PluginOption[];
  // A host name the dev and preview servers answer besides localhost, or undefined for none.
  readonly previewHost: string | undefined;
  // The repository's root: import.meta.dirname in vite.config.ts.
  readonly repoRoot: string;
  // Vitest's per-test time limit, in ms.
  readonly testTimeout: number;
}

// The Vite and Vitest config for a game laid out as above. Phaser and phaserBuildPlugin's entry
// go in their own chunk, so a game code change keeps the Phaser chunk's hashed name and a new
// service worker's precache gets it from the browser's HTTP cache. __APP_VERSION__ and
// __COMMIT__ (build/buildInfo.d.ts) are fixed per commit, so two builds of one commit match.
export async function gameViteConfig<Modules>(
  options: GameViteOptions<Modules>,
): Promise<ViteUserConfig> {
  // An absolute path in the repository. Vite resolves relative paths against root, which is
  // pages/, so every path goes through here instead.
  const repoPath = (path: string) => resolve(options.repoRoot, path);
  // configFile: false, so the runner resolves its own config from these options alone rather than
  // loading vite.config.ts, which calls this function, again.
  const { module } = await runnerImport<Modules>(repoPath(options.configModules), {
    configFile: false,
  });
  const packageVersion: string = JSON.parse(readFileSync(repoPath("package.json"), "utf8")).version;
  const hosts = options.previewHost === undefined ? [] : [options.previewHost];
  return {
    build: {
      chunkSizeWarningLimit: options.chunkSizeWarningLimit,
      // Outside root, so Vite would leave the previous build's files in place without it.
      emptyOutDir: true,
      outDir: repoPath("dist"),
      rolldownOptions: {
        input: Object.fromEntries(
          Object.entries(options.pages).map(([name, page]) => [name, repoPath(page)]),
        ),
        output: {
          codeSplitting: {
            groups: [
              {
                name: "phaser",
                test: (id: string) =>
                  id === PHASER_ENTRY_ID || /[\\/]node_modules[\\/]phaser[\\/]/.test(id),
              },
            ],
          },
        },
      },
    },
    define: {
      __APP_VERSION__: JSON.stringify(packageVersion),
      __COMMIT__: JSON.stringify(shortCommit(() => gitHead(repoPath(".")), process.env)),
    },
    plugins: options.plugins(module, repoPath),
    preview: { allowedHosts: hosts },
    publicDir: repoPath("public"),
    // The pages load their modules as /src/..., which names the repository's src/ rather than
    // pages/src/.
    resolve: { alias: { "/src": repoPath("src") } },
    root: repoPath("pages"),
    server: {
      allowedHosts: hosts,
      // The dev server serves src/ and node_modules/ from outside root, as /@fs/ URLs.
      fs: { allow: [repoPath(".")] },
    },
    test: {
      environment: "node",
      include: ["vendor/game-kit/src/**/*.test.ts", "src/**/*.test.ts"],
      root: repoPath("."),
      testTimeout: options.testTimeout,
    },
  };
}
