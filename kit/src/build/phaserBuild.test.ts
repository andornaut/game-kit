import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  PHASER_ESM_FLAGS,
  phaserEntrySource,
  phaserExports,
  phaserFlags,
  phaserSourceDir,
  replacePhaserFlags,
} from "./phaserBuild";

const SOURCE_DIR = phaserSourceDir();
const ESM_ENTRY = readFileSync(join(SOURCE_DIR, "phaser-esm.js"), "utf8");
const PHASER_EXPORTS = phaserExports(ESM_ENTRY);

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
});
