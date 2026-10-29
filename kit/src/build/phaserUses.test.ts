import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import type { PhaserBuild } from "./phaserBuild";
import { flagBlocks, type LackingNames, phaserBuildProblems, phaserUses } from "./phaserUses";

describe("phaserUses", () => {
  const names: LackingNames = {
    factories: new Set(["tilemap"]),
    gameObjects: new Set(["Shader"]),
    imports: new Set(["Physics", "Math", "CANVAS"]),
    loaders: new Set(["audio"]),
    plugins: new Set(["physics"]),
    systems: new Set(["sound"]),
  };

  it.each([
    ["an omitted namespace", 'import { Physics, Scene } from "phaser";', ["Physics"]],
    ["a renamed namespace", 'import { Math as PhaserMath } from "phaser";', ["Math"]],
    ["a constant", 'import { CANVAS } from "phaser";', ["CANVAS"]],
    ["types only", 'import type { Physics } from "phaser";', []],
    ["an inline type", 'import { type Physics, Scene } from "phaser";', []],
    ["the default export", 'import Phaser from "phaser";', ["*"]],
    ["the namespace object", 'import * as Phaser from "phaser";', ["*"]],
    ["a dynamic import", 'void import("phaser");', ["*"]],
    ["a re-export", 'export { Scene } from "phaser";', ["*"]],
    ["a scene plugin", "this.physics.add.sprite(0, 0, key);", ["physics"]],
    ["a game config key", "new Game({ physics: {} });", ["physics"]],
    ["a factory", "scene.add.tilemap({ key });", ["add.tilemap"]],
    ["a creator", "this.make.tilemap({ key });", ["make.tilemap"]],
    ["a factory's name elsewhere", "const { tilemap } = level; level.tilemap.x = 1;", []],
    ["a game object class", "new GameObjects.Shader(scene);", ["GameObjects.Shader"]],
    ["a loader file type", "this.load.audio(key, url);", ["load.audio"]],
    ["a loader method's name elsewhere", "track.audio.play();", []],
    ["a scene's system", "this.sound.play(key);", ["sound"]],
    [
      "the game's system",
      "game.sound.pauseAll(); this.game.sound.mute = true;",
      ["sound", "sound"],
    ],
    ["a scene's sys system", "scene.sys.sound.stopAll();", ["sound"]],
    ["a system's name on the game's own data", "settings.sound = true;", []],
    ["another module", 'import { Physics } from "./phaser";', []],
  ])("finds %s", (_, text, uses) => {
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

  const soundOff: PhaserBuild = { ...build, flags: { ...build.flags, FEATURE_SOUND: false } };
  const webglOff: PhaserBuild = { ...build, flags: { WEBGL_RENDERER: false } };

  it.each<[string, PhaserBuild, string, string[]]>([
    ["a game that uses only what is kept", build, 'import { Scene, WEBGL } from "phaser";', []],
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
      ["game.ts: add.tilemap"],
    ],
    [
      "a scene plugin only an omitted namespace registers",
      build,
      "this.matterPhysics.x;",
      ["game.ts: matterPhysics"],
    ],
    ["the whole of Phaser", build, 'import * as Phaser from "phaser";', ["game.ts: *"]],
    [
      "the Canvas renderer the build leaves out",
      build,
      'import { CANVAS } from "phaser";',
      ["game.ts: CANVAS"],
    ],
    ["sound the build keeps", build, "this.sound.play(key); this.load.audio(key, url);", []],
    ["sound with FEATURE_SOUND false", soundOff, "this.sound.play(key);", ["game.ts: sound"]],
    [
      "the game's sound with FEATURE_SOUND false",
      soundOff,
      "game.sound.mute = true;",
      ["game.ts: sound"],
    ],
    [
      "loading audio with FEATURE_SOUND false",
      soundOff,
      "this.load.audio(key, url);",
      ["game.ts: load.audio"],
    ],
    [
      "loading an audio sprite with FEATURE_SOUND false",
      soundOff,
      "this.load.audioSprite(key, json);",
      ["game.ts: load.audioSprite"],
    ],
    [
      "the WebGL renderer with WEBGL_RENDERER false",
      webglOff,
      'import { WEBGL } from "phaser";',
      ["game.ts: WEBGL"],
    ],
    [
      "a WebGL-only factory with WEBGL_RENDERER false",
      webglOff,
      "this.add.nineslice(0, 0, key);",
      ["game.ts: add.nineslice"],
    ],
    [
      "a WebGL-only factory registered in a module the flag's block requires",
      webglOff,
      "this.add.pointlight(0, 0);",
      ["game.ts: add.pointlight"],
    ],
    [
      "a WebGL-only game object with WEBGL_RENDERER false",
      webglOff,
      "new GameObjects.Shader(scene, key);",
      ["game.ts: GameObjects.Shader"],
    ],
    ["a factory both renderers draw", webglOff, "this.add.image(0, 0, key);", []],
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

describe("flagBlocks", () => {
  it.each([
    ["a block", "if (typeof A)\n{\n  x();\n}\ny();", ["\n  x();\n"]],
    ["nested braces", "if (typeof A) { f({ a: 1 }); } g();", [" f({ a: 1 }); "]],
    ["a condition with more after the flag", "if (typeof A && window) { x(); }", [" x(); "]],
    ["another flag's block", "if (typeof AB) { x(); }", []],
    ["two blocks", "if (typeof A) { x(); } if (typeof A) { y(); }", [" x(); ", " y(); "]],
  ])("reads %s", (_case, text, blocks) => {
    expect(flagBlocks("A", text)).toEqual(blocks);
  });
});
