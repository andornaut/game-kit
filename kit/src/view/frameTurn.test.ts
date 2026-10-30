import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_TURN,
  FRAME_TURN_ATTRIBUTE,
  frameTurnFor,
  type FrameTurnHost,
  type GameOrientation,
  lockGameOrientation,
  turnedFrameQuery,
  watchFrameTurn,
} from "./frameTurn";
import type { FrameTurn } from "./pagePoint";

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
    }).toEqual({ opposite: true, query: true });
  });
});

describe("frameTurnFor", () => {
  it.each<[GameOrientation, boolean, string | undefined, FrameTurn]>([
    ["landscape", false, "landscape-primary", 0],
    ["landscape", true, "portrait-primary", 90],
    ["landscape", true, "portrait-secondary", -90],
    ["landscape", true, undefined, 90],
    ["portrait", false, "portrait-primary", 0],
    ["portrait", true, "landscape-primary", -90],
    ["portrait", true, "landscape-secondary", 90],
    ["portrait", true, undefined, -90],
  ])("turns a %s game, turned %s, on %s by %i", (game, turned, type, turn) => {
    expect(frameTurnFor(game, turned, type)).toBe(turn);
  });
});

// A window whose media query and screen orientation the test sets, firing change on each.
function fakeHost(matches: boolean, type: string | undefined) {
  const media = new EventTarget();
  const orientation = new EventTarget();
  const attributes = new Map<string, string>();
  const state = { matches, type };
  const host: FrameTurnHost = {
    document: {
      documentElement: {
        removeAttribute: (name: string) => attributes.delete(name),
        setAttribute: (name: string, value: string) => attributes.set(name, value),
      },
    },
    matchMedia: () => ({
      addEventListener: (_: "change", listener: () => void) =>
        media.addEventListener("change", listener),
      get matches() {
        return state.matches;
      },
    }),
    screen:
      type === undefined
        ? {}
        : {
            orientation: {
              addEventListener: (_: "change", listener: () => void) =>
                orientation.addEventListener("change", listener),
              get type() {
                return state.type ?? "";
              },
            },
          },
  };
  return { attributes, host, media, orientation, state };
}

describe("watchFrameTurn", () => {
  it.each<[boolean, string | undefined, FrameTurn, string | undefined]>([
    [false, "landscape-primary", 0, undefined],
    [true, "portrait-primary", 90, "90"],
    [true, "portrait-secondary", -90, "-90"],
    [true, undefined, 90, "90"],
  ])(
    "for a landscape game, turned %s on %s, gives %i and marks %s",
    (matches, type, turn, mark) => {
      const { attributes, host } = fakeHost(matches, type);
      expect([
        watchFrameTurn(host, "landscape").turn(),
        attributes.get(FRAME_TURN_ATTRIBUTE),
      ]).toEqual([turn, mark]);
    },
  );

  it("follows the screen as it turns, telling listeners of each change once", () => {
    const fake = fakeHost(true, "portrait-primary");
    const watch = watchFrameTurn(fake.host, "landscape");
    const told: FrameTurn[] = [];
    watch.onChange((turn) => told.push(turn));
    const seen = [watch.turn()];
    fake.state.type = "portrait-secondary";
    fake.orientation.dispatchEvent(new Event("change"));
    fake.orientation.dispatchEvent(new Event("change"));
    seen.push(watch.turn());
    fake.state.matches = false;
    fake.media.dispatchEvent(new Event("change"));
    seen.push(watch.turn());
    expect({ marked: fake.attributes.has(FRAME_TURN_ATTRIBUTE), seen, told }).toEqual({
      marked: false,
      seen: [90, -90, 0],
      told: [-90, 0],
    });
  });

  it("stops telling a listener once it is removed", () => {
    const fake = fakeHost(true, "portrait-primary");
    const watch = watchFrameTurn(fake.host, "landscape");
    const told: FrameTurn[] = [];
    watch.onChange((turn) => told.push(turn))();
    fake.state.matches = false;
    fake.media.dispatchEvent(new Event("change"));
    expect(told).toEqual([]);
  });
});

describe("lockGameOrientation", () => {
  it.each<GameOrientation>(["landscape", "portrait"])(
    "asks for %s and ignores a refusal",
    async (game) => {
      const asked: string[] = [];
      lockGameOrientation(
        {
          orientation: {
            lock: (orientation) => {
              asked.push(orientation);
              return Promise.reject(new Error("NotSupportedError"));
            },
          },
        },
        game,
      );
      await Promise.resolve();
      expect(asked).toEqual([game]);
    },
  );

  it("does nothing where the browser has no lock", () => {
    expect(() => lockGameOrientation({}, "landscape")).not.toThrow();
  });
});

// The crash screen turns with the frame inside <body>, so it keeps clear of the frame's own safe
// areas: each side's padding reads that side's --inset-* property, and the screen's inset where
// no frame stylesheet sets it.
describe("crash.css", () => {
  const css = readFileSync(join(import.meta.dirname, "../crash/crash.css"), "utf8").replace(
    /\s+/g,
    " ",
  );
  it.each(["top", "right", "bottom", "left"])("pads the %s with the frame's inset", (edge) => {
    expect(css).toContain(`var(--inset-${edge}, env(safe-area-inset-${edge}, 0px))`);
  });
});
