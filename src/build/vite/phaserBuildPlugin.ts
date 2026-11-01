import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Plugin } from "vite";

import {
  PHASER_ENTRY_ID,
  type PhaserBuild,
  phaserEntrySource,
  phaserFlags,
  phaserSourceDir,
  replacePhaserFlags,
} from "../phaserBuild";

// The production build only: resolves `phaser` to an entry built from Phaser's source without
// build's omitted namespaces, and replaces the feature flags in Phaser's source with build's
// values, so code behind a flag set false drops out. The dev server and Vitest load the package's
// own bundle.
export function phaserBuildPlugin(build: PhaserBuild): Plugin {
  const sourceDir = phaserSourceDir();
  const flags = phaserFlags(build);
  const inSource = (id: string) => id.startsWith(`${sourceDir}/`);
  return {
    apply: "build",
    enforce: "pre",
    load(id) {
      if (id !== PHASER_ENTRY_ID) {
        return undefined;
      }
      const esmEntry = readFileSync(join(sourceDir, "phaser-esm.js"), "utf8");
      return { code: phaserEntrySource(build.omitted, sourceDir, esmEntry), moduleType: "js" };
    },
    name: "game-kit-phaser-build",
    resolveId(id) {
      return id === "phaser" ? PHASER_ENTRY_ID : undefined;
    },
    transform(code, id) {
      return inSource(id) ? { code: replacePhaserFlags(flags, code), map: null } : undefined;
    },
  };
}
