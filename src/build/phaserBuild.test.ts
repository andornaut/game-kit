import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  PHASER_ESM_FLAGS,
  phaserEntrySource,
  phaserExports,
  phaserFlags,
  replacePhaserFlags,
} from "./phaserBuild.ts";

const SOURCE_DIR = join(
  dirname(createRequire(import.meta.url).resolve("phaser/package.json")),
  "src",
);
const ESM_ENTRY = readFileSync(join(SOURCE_DIR, "phaser-esm.js"), "utf8");
const PHASER_EXPORTS = phaserExports(ESM_ENTRY);

// A small entry in phaser-esm.js's shape.
const ENTRY = [
  "require('./polyfills/requestVideoFrame');",
  "var CONST = require('./const');",
  "export const Actions = require('./actions');",
  "export const Physics = require('./physics');",
  "export const VERSION = CONST.VERSION;",
  "export default { Actions, Physics };",
  "export const Ignored = 1;",
].join("\n");

describe("PHASER_ESM_FLAGS", () => {
  it("sets each feature flag as Phaser's own ESM build does", () => {
    const config = readFileSync(join(SOURCE_DIR, "../config/webpack.dist.config.js"), "utf8");
    const esmBuild = config.slice(config.indexOf("name: 'phaser-esm'"));
    const flags = Object.fromEntries(
      [...esmBuild.matchAll(/"typeof (\w+)": JSON\.stringify\((true|false)\)/g)].map(
        ([, flag, value]) => [flag, value === "true"],
      ),
    );
    expect(PHASER_ESM_FLAGS).toEqual(flags);
  });
});

describe("phaserExports", () => {
  it("reads the entry's namespaces, constants and polyfills before its default export", () => {
    expect(phaserExports(ENTRY)).toEqual({
      constants: new Map([["VERSION", "VERSION"]]),
      namespaces: new Map([
        ["Actions", "./actions"],
        ["Physics", "./physics"],
      ]),
      polyfills: ["./polyfills/requestVideoFrame"],
    });
  });

  it.each([
    ["a function", "export function boot() {}"],
    ["a re-export", "export { Scene } from './scene';"],
    ["a computed constant", "export const AUTO = 1 + CONST.AUTO;"],
  ])("throws on %s it cannot read", (_, line) => {
    expect(() => phaserExports(line)).toThrow(`cannot read: ${line}`);
  });

  it("reads Phaser's own entry", () => {
    expect(PHASER_EXPORTS.namespaces.get("GameObjects")).toBe("./gameobjects");
    expect(PHASER_EXPORTS.constants.get("WEBGL")).toBe("WEBGL");
  });
});

describe("phaserFlags", () => {
  it.each<[string, Record<string, boolean>, Record<string, boolean>]>([
    ["Phaser's own flags", {}, PHASER_ESM_FLAGS],
    [
      "a game's flag over Phaser's",
      { CANVAS_RENDERER: false },
      { ...PHASER_ESM_FLAGS, CANVAS_RENDERER: false },
    ],
    ["a flag Phaser's build leaves unset", { EXTRA: true }, { ...PHASER_ESM_FLAGS, EXTRA: true }],
  ])("takes %s", (_, flags, expected) => {
    expect(phaserFlags({ flags, omitted: [] })).toEqual(expected);
  });
});

describe("replacePhaserFlags", () => {
  const flags = phaserFlags({ flags: { CANVAS_RENDERER: false }, omitted: [] });

  it.each([
    ["a flag the game sets", "if (typeof CANVAS_RENDERER) {}", "if (false) {}"],
    ["a negated flag", "!typeof WEBGL_RENDERER", "!true"],
    ["a global", "typeof URL === 'function'", "typeof URL === 'function'"],
    ["a flag Phaser's build leaves unset", "typeof PLUGIN_FBINSTANT", "typeof PLUGIN_FBINSTANT"],
  ])("replaces %s as Phaser's build does", (_, code, replaced) => {
    expect(replacePhaserFlags(flags, code)).toBe(replaced);
  });
});

describe("phaserEntrySource", () => {
  it.each([
    ["nothing omitted", []],
    ["some namespaces omitted", ["Physics", "Tilemaps"]],
  ])("exports every kept namespace and constant with %s", (_, omitted: string[]) => {
    const entry = phaserEntrySource(omitted, SOURCE_DIR, ESM_ENTRY);
    const exported = [...entry.matchAll(/^ {2}(\w+): /gm)].map(([, name]) => name);
    const kept = [...PHASER_EXPORTS.namespaces.keys()].filter((name) => !omitted.includes(name));
    expect(exported.sort()).toEqual([...kept, ...PHASER_EXPORTS.constants.keys()].sort());
    expect(kept).toContain("GameObjects");
  });

  it.each([
    ["a source folder", "/phaser/src"],
    ["a source folder with a trailing separator", "/phaser/src/"],
  ])("names each module by its absolute path in %s", (_, sourceDir) => {
    expect(phaserEntrySource(["Physics"], sourceDir, ENTRY)).toBe(
      [
        'require("/phaser/src/polyfills/requestVideoFrame");',
        'var CONST = require("/phaser/src/const");',
        "module.exports = {",
        '  Actions: require("/phaser/src/actions"),',
        "  VERSION: CONST.VERSION,",
        "};",
        "",
      ].join("\n"),
    );
  });
});
