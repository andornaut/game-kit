import { describe, expect, it } from "vitest";

import type { FrameTurn } from "../../../view/pagePoint.ts";
import { FRAME_TURN_ATTRIBUTE, type GameOrientation, turnedFrameQuery } from "../frameTurn.ts";
import { type FrameTurnHost, lockGameOrientation, watchFrameTurn } from "./watchFrameTurn.ts";

// A window whose media query and screen orientation the test sets, firing change on each.
function fakeHost(matches: boolean, type: string | undefined) {
  const media = new EventTarget();
  const orientation = new EventTarget();
  const attributes = new Map<string, string>();
  const queries: string[] = [];
  const state = { matches, type };
  const host: FrameTurnHost = {
    document: {
      documentElement: {
        removeAttribute: (name: string) => attributes.delete(name),
        setAttribute: (name: string, value: string) => attributes.set(name, value),
      },
    },
    matchMedia: (query) => {
      queries.push(query);
      return {
        addEventListener: (_: "change", listener: () => void) =>
          media.addEventListener("change", listener),
        get matches() {
          return state.matches;
        },
      };
    },
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
  return { attributes, host, media, orientation, queries, state };
}

describe("watchFrameTurn", () => {
  it.each<[GameOrientation, boolean, string | undefined, FrameTurn, string | undefined]>([
    ["landscape", false, "landscape-primary", 0, undefined],
    ["landscape", true, "portrait-primary", 90, "90"],
    ["landscape", true, "portrait-secondary", -90, "-90"],
    ["landscape", true, undefined, 90, "90"],
    ["portrait", false, "portrait-primary", 0, undefined],
    ["portrait", true, "landscape-primary", -90, "-90"],
    ["portrait", true, "landscape-secondary", 90, "90"],
    ["portrait", true, undefined, -90, "-90"],
  ])("for a %s game, turned %s on %s, gives %i and marks %s", (game, matches, type, turn, mark) => {
    const fake = fakeHost(matches, type);
    expect([
      watchFrameTurn(game, fake.host).turn(),
      fake.attributes.get(FRAME_TURN_ATTRIBUTE),
      fake.queries,
    ]).toEqual([turn, mark, [turnedFrameQuery(game)]]);
  });

  it("follows the screen as it turns, telling listeners of each change once", () => {
    const fake = fakeHost(true, "portrait-primary");
    const watch = watchFrameTurn("landscape", fake.host);
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

  it("rechecks the screen on request, for a change whose event never came", () => {
    const fake = fakeHost(true, "portrait-primary");
    const watch = watchFrameTurn("landscape", fake.host);
    const told: FrameTurn[] = [];
    watch.onChange((turn) => told.push(turn));
    fake.state.matches = false;
    const before = watch.turn();
    watch.recheck();
    expect({ after: watch.turn(), before, told }).toEqual({ after: 0, before: 90, told: [0] });
  });

  it("stops telling a listener once it is removed", () => {
    const fake = fakeHost(true, "portrait-primary");
    const watch = watchFrameTurn("landscape", fake.host);
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
      lockGameOrientation(game, {
        orientation: {
          lock: (orientation) => {
            asked.push(orientation);
            return Promise.reject(new Error("NotSupportedError"));
          },
        },
      });
      await Promise.resolve();
      expect(asked).toEqual([game]);
    },
  );

  it.each([
    ["no screen orientation", {}],
    ["no lock", { orientation: {} }],
  ])("does nothing where the browser has %s", (_, screen) => {
    expect(() => lockGameOrientation("landscape", screen)).not.toThrow();
  });
});
