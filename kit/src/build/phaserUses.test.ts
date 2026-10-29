import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import type { PhaserBuild } from "./phaserBuild";
import { phaserBuildProblems, phaserUses } from "./phaserUses";

describe("phaserUses", () => {
  it.each([
    ["a namespace", 'import { Physics, Scene } from "phaser";', ["Physics", "Scene"]],
    ["a renamed namespace", 'import { Math as PhaserMath } from "phaser";', ["Math"]],
    ["types only", 'import type { Physics } from "phaser";', []],
    ["an inline type", 'import { type Geom, Scene } from "phaser";', ["Scene"]],
    ["the default export", 'import Phaser from "phaser";', ["*"]],
    ["the namespace object", 'import * as Phaser from "phaser";', ["*"]],
    ["a dynamic import", 'void import("phaser");', ["*"]],
    ["a re-export", 'export { Physics } from "phaser";', ["*"]],
    ["a scene plugin", "this.physics.add.sprite(0, 0, key);", ["physics"]],
    ["a factory", "scene.add.tilemap({ key });", ["tilemap"]],
    ["a creator", "this.make.tilemap({ key });", ["tilemap"]],
    ["a factory's name elsewhere", "const { tilemap } = level; level.tilemap.x = 1;", []],
    ["a game config key", "new Game({ physics: {} });", ["physics"]],
    ["another module", 'import { x } from "./phaser";', []],
  ])("finds %s", (_, text, uses) => {
    const names = { factories: new Set(["tilemap"]), plugins: new Set(["physics"]) };
    expect(phaserUses(names, text)).toEqual(uses);
  });
});

describe("phaserBuildProblems", () => {
  const root = mkdtempSync(join(tmpdir(), "phaser-uses-"));
  afterAll(() => rmSync(root, { force: true, recursive: true }));
  // A module under root with text, as a game ships it.
  const shipped = (name: string, text: string) => {
    writeFileSync(join(root, name), text);
    return join(root, name);
  };
  const build: PhaserBuild = {
    flags: { CANVAS_RENDERER: false },
    omitted: ["Physics", "Tilemaps"],
  };

  it.each<[string, PhaserBuild, string, string[]]>([
    ["a game that uses only what is kept", build, 'import { Scene } from "phaser";', []],
    [
      "an omitted namespace the game imports",
      build,
      'import { Tilemaps } from "phaser";',
      ["game.ts: Tilemaps"],
    ],
    [
      "a factory only an omitted namespace registers",
      build,
      "this.add.tilemap({});",
      ["game.ts: tilemap"],
    ],
    [
      "a scene plugin only an omitted namespace registers",
      build,
      "this.matterPhysics.x;",
      ["game.ts: matterPhysics"],
    ],
    ["the whole of Phaser", build, 'import * as Phaser from "phaser";', ["game.ts: *"]],
    [
      "an omission Phaser does not export",
      { ...build, omitted: ["Tilemap"] },
      "",
      ["Phaser exports no namespace Tilemap"],
    ],
    [
      "a flag Phaser does not have",
      { ...build, flags: { CANVAS: false } },
      "",
      ["Phaser has no feature flag CANVAS"],
    ],
  ])("reports %s", (_case, checked, text, problems) => {
    expect(phaserBuildProblems(checked, root, [shipped("game.ts", text)])).toEqual(problems);
  });
});
