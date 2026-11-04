import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { FrameTurn } from "../../view/pagePoint.ts";
import {
  DEFAULT_TURN,
  FRAME_TURN_ATTRIBUTE,
  frameTurnFor,
  type GameOrientation,
  turnedFrameQuery,
} from "./frameTurn.ts";

describe("turnedFrameQuery", () => {
  it.each<[GameOrientation, string]>([
    ["landscape", "(orientation: portrait) and (pointer: coarse)"],
    ["portrait", "(orientation: landscape) and (pointer: coarse)"],
  ])("turns a %s game under %s", (game, query) => {
    expect(turnedFrameQuery(game)).toBe(query);
  });

  // The stylesheet must turn under the same query the script reads, and by the default turn.
  it.each<[GameOrientation, string]>([
    ["landscape", "frameTurnLandscapeGame.css"],
    ["portrait", "frameTurnPortraitGame.css"],
  ])("matches the %s game's stylesheet, %s", (game, file) => {
    const css = readFileSync(join(import.meta.dirname, file), "utf8");
    const other = -DEFAULT_TURN[game];
    expect({
      opposite: css.includes(`[${FRAME_TURN_ATTRIBUTE}="${other}"]`),
      query: css.includes(`@media ${turnedFrameQuery(game)} {`),
      unturned: css.includes(`@media not all and ${turnedFrameQuery(game)} {`),
    }).toEqual({ opposite: true, query: true, unturned: true });
  });

  // A frame's own edges read the screen's insets the turn moves onto them, and every edge is set
  // in each block that sets any.
  it.each(["frameTurnLandscapeGame.css", "frameTurnPortraitGame.css"])(
    "%s sets every inset",
    (file) => {
      const css = readFileSync(join(import.meta.dirname, file), "utf8");
      const blocks = [...css.matchAll(/\{([^{}]*--inset-\w+:[^{}]*)\}/g)].map(([, body]) =>
        [...(body ?? "").matchAll(/--inset-(\w+):/g)].map(([, edge]) => edge).sort(),
      );
      expect(blocks).toEqual(Array(3).fill(["bottom", "left", "right", "top"]));
    },
  );
});

describe("frameTurnFor", () => {
  it.each<[GameOrientation, boolean, string | undefined, FrameTurn]>([
    ["landscape", false, "landscape-primary", 0],
    ["landscape", false, "portrait-secondary", 0],
    ["landscape", true, "portrait-primary", 90],
    ["landscape", true, "portrait-secondary", -90],
    ["landscape", true, "landscape-secondary", 90],
    ["landscape", true, undefined, 90],
    ["portrait", false, "portrait-primary", 0],
    ["portrait", true, "landscape-primary", -90],
    ["portrait", true, "landscape-secondary", 90],
    ["portrait", true, "portrait-secondary", -90],
    ["portrait", true, undefined, -90],
  ])("turns a %s game, turned %s, on %s by %i", (game, turned, type, turn) => {
    expect(frameTurnFor(game, turned, type)).toBe(turn);
  });
});
