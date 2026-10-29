import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// A production build's Phaser, bundled from Phaser's source by vite/phaserBuildPlugin: without
// the namespaces the game reads nothing from, and with Phaser's feature flags replaced in each
// `typeof <FLAG>` test of its source, so code behind a flag set false drops out. phaserUses.ts
// checks that the game uses nothing the build leaves out.
export interface PhaserBuild {
  // Flags set apart from Phaser's own ESM build (PHASER_ESM_FLAGS), such as CANVAS_RENDERER:
  // false for a game that runs on WebGL alone.
  readonly flags: Readonly<Record<string, boolean>>;
  // The namespaces left out. A module in one is still bundled when a kept module requires it.
  readonly omitted: readonly string[];
}

// The values Phaser's ESM build sets its feature flags to (config/webpack.dist.config.js).
export const PHASER_ESM_FLAGS: Readonly<Record<string, boolean>> = {
  CANVAS_RENDERER: true,
  EXPERIMENTAL: false,
  FEATURE_SOUND: true,
  WEBGL_DEBUG: false,
  WEBGL_RENDERER: true,
};

// The entry module the build resolves `phaser` to. Rolldown's \0 prefix marks it as naming no
// file; a game's Vite config can put it in its Phaser chunk.
export const PHASER_ENTRY_ID = "\0phaser-entry.cjs";

const FLAG_TEST = /typeof ([A-Z][A-Z0-9_]+)\b/g;
const NAMESPACE_EXPORT = /^export const (\w+) = require\('([^']+)'\);$/;
const CONSTANT_EXPORT = /^export const (\w+) = CONST\.(\w+);$/;
const POLYFILL = /^require\('(\.\/polyfills\/[^']+)'\);$/;

// Phaser's source folder, phaser/src/, found through its package.json (the package's exports name
// no other path).
export function phaserSourceDir(): string {
  return join(dirname(createRequire(import.meta.url).resolve("phaser/package.json")), "src");
}

export interface PhaserExports {
  // Each namespace's module, relative to phaser/src/.
  namespaces: Map<string, string>;
  // Each constant's key in phaser/src/const.js.
  constants: Map<string, string>;
  polyfills: string[];
}

// The named exports of Phaser's ESM entry, phaser/src/phaser-esm.js. Throws on an export of any
// other form, so a Phaser release that changes the entry's shape stops the build.
export function phaserExports(esmEntry: string): PhaserExports {
  const exports: PhaserExports = { constants: new Map(), namespaces: new Map(), polyfills: [] };
  const lines = esmEntry.split("\n").map((line) => line.trim());
  const defaultExport = lines.findIndex((line) => line.startsWith("export default"));
  for (const line of defaultExport < 0 ? lines : lines.slice(0, defaultExport)) {
    const namespace = NAMESPACE_EXPORT.exec(line);
    const constant = CONSTANT_EXPORT.exec(line);
    const polyfill = POLYFILL.exec(line);
    if (namespace?.[1] !== undefined && namespace[2] !== undefined) {
      exports.namespaces.set(namespace[1], namespace[2]);
    } else if (constant?.[1] !== undefined && constant[2] !== undefined) {
      exports.constants.set(constant[1], constant[2]);
    } else if (polyfill?.[1] !== undefined) {
      exports.polyfills.push(polyfill[1]);
    } else if (line.startsWith("export ")) {
      throw new Error(`phaser-esm.js has an export this build cannot read: ${line}`);
    }
  }
  return exports;
}

// The entry as CommonJS, like Phaser's own: its namespaces less the omitted ones, and its
// constants, each module named by its absolute path.
export function phaserEntrySource(
  omitted: readonly string[],
  sourceDir: string,
  esmEntry: string,
): string {
  const { constants, namespaces, polyfills } = phaserExports(esmEntry);
  const path = (module: string) => JSON.stringify(join(sourceDir, module));
  const kept = [...namespaces].filter(([name]) => !omitted.includes(name));
  return [
    ...polyfills.map((module) => `require(${path(module)});`),
    `var CONST = require(${path("./const")});`,
    "module.exports = {",
    ...kept.map(([name, module]) => `  ${name}: require(${path(module)}),`),
    ...[...constants].map(([name, key]) => `  ${name}: CONST.${key},`),
    "};",
    "",
  ].join("\n");
}

// Every flag's value: Phaser's ESM build's, with the game's flags over them.
export function phaserFlags(build: PhaserBuild): Readonly<Record<string, boolean>> {
  return { ...PHASER_ESM_FLAGS, ...build.flags };
}

// code with each of Phaser's feature flag tests replaced by its value in flags.
export function replacePhaserFlags(flags: Readonly<Record<string, boolean>>, code: string): string {
  return code.replace(FLAG_TEST, (test, flag: string) =>
    flag in flags ? String(flags[flag]) : test,
  );
}
