import { describe, expect, it } from "vitest";

import {
  basePrecacheUrls,
  type PrecacheGroups,
  precacheGroupUrls,
  validatePrecacheGroups,
} from "./precacheGroups.ts";

const available = [
  "/page/",
  "/shared.bin",
  "/alpha/shared.bin",
  "/a.bin",
  "/a.ogg",
  "/a.mp3",
  "/b.bin",
  "/b.ogg",
  "/b.mp3",
];
const groups = validatePrecacheGroups(available, {
  initial: ["alpha"],
  urls: {
    alpha: ["/a.bin", "/a.ogg", "/a.mp3"],
    beta: ["/b.bin", "/b.ogg", "/b.mp3"],
  },
});
// The caller has already selected audio. The planner only intersects these exact URLs.
const selected = [
  "/page/",
  "/shared.bin",
  "/alpha/shared.bin",
  "/a.bin",
  "/a.ogg",
  "/b.bin",
  "/b.ogg",
];

describe("validatePrecacheGroups", () => {
  it("copies and canonicalizes group members while preserving deduplicated initial order", () => {
    const input = Object.freeze({
      initial: Object.freeze(["beta", "alpha", "beta"]),
      urls: Object.freeze(
        Object.fromEntries([
          ["beta", Object.freeze(["/b.ogg", "/b.bin", "/b.ogg"])],
          ["alpha", Object.freeze(["/a.ogg", "/a.bin"])],
        ]),
      ),
    });
    const before = JSON.stringify(input);
    const result = validatePrecacheGroups([...available, "/a.bin"], input);
    expect(result).toEqual({
      initial: ["beta", "alpha"],
      urls: { alpha: ["/a.bin", "/a.ogg"], beta: ["/b.bin", "/b.ogg"] },
    });
    expect(Object.keys(result.urls)).toEqual(["alpha", "beta"]);
    expect(result.initial).not.toBe(input.initial);
    expect(result.urls.alpha).not.toBe(input.urls.alpha);
    expect(JSON.stringify(input)).toBe(before);
    expect(
      validatePrecacheGroups([...available].reverse(), {
        initial: ["beta", "alpha"],
        urls: { alpha: ["/a.bin", "/a.ogg"], beta: ["/b.bin", "/b.ogg"] },
      }),
    ).toEqual(result);
  });

  it("rejects unknown inventory members, cross-group overlap and unknown initial IDs", () => {
    expect(() =>
      validatePrecacheGroups(available, { initial: [], urls: { alpha: ["/missing"] } }),
    ).toThrow(/Unknown precache URL/);
    expect(() =>
      validatePrecacheGroups(available, {
        initial: [],
        urls: { alpha: ["/a.bin", "/a.bin"], beta: ["/a.bin"] },
      }),
    ).toThrow(/multiple groups/);
    expect(() =>
      validatePrecacheGroups(available, { initial: ["missing"], urls: groups.urls }),
    ).toThrow(/Unknown precache group/);
  });

  it("uses own properties for special IDs and excludes inherited groups", () => {
    const special = Object.fromEntries([
      ["__proto__", ["/a.bin"]],
      ["constructor", ["/b.bin"]],
      ["toString", ["/shared.bin"]],
    ]);
    const result = validatePrecacheGroups(available, {
      initial: ["constructor", "__proto__"],
      urls: special,
    });
    expect(Object.hasOwn(result.urls, "__proto__")).toBe(true);
    expect(
      precacheGroupUrls({ groups: result, selectedUrls: selected }, ["__proto__", "toString"]),
    ).toEqual(["/a.bin", "/shared.bin"]);
    expect(Object.getPrototypeOf(result.urls)).toBe(Object.prototype);
    const inherited = Object.create({ inherited: ["/page/"] }) as Record<string, string[]>;
    Object.defineProperty(inherited, "own", { value: ["/a.bin"] });
    expect(validatePrecacheGroups(available, { initial: ["own"], urls: inherited }).urls).toEqual({
      own: ["/a.bin"],
    });
    expect(() =>
      validatePrecacheGroups(available, { initial: ["inherited"], urls: inherited }),
    ).toThrow(/Unknown precache group/);
    expect(() => precacheGroupUrls({ groups, selectedUrls: selected }, ["toString"])).toThrow(
      /Unknown precache group/,
    );
  });

  it("rejects malformed serialized group arrays", () => {
    expect(() =>
      validatePrecacheGroups(available, {
        initial: "alpha",
        urls: groups.urls,
      } as unknown as PrecacheGroups),
    ).toThrow(TypeError);
    expect(() =>
      validatePrecacheGroups(available, {
        initial: [],
        urls: { alpha: "/a.bin" },
      } as unknown as PrecacheGroups),
    ).toThrow(TypeError);
  });
});

describe("selected precache planning", () => {
  it("keeps unassigned shared assets mandatory without guessing from path prefixes", () => {
    const input = Object.freeze([...selected, "/shared.bin"]);
    expect(basePrecacheUrls(groups, input)).toEqual(["/alpha/shared.bin", "/page/", "/shared.bin"]);
    expect(input).toEqual([...selected, "/shared.bin"]);
    expect(precacheGroupUrls({ groups, selectedUrls: input }, groups.initial)).toEqual([
      "/a.bin",
      "/a.ogg",
    ]);
  });

  it("unions initial, prior-ready and requested groups with only the selected codec", () => {
    const ids = Object.freeze([...groups.initial, "beta", "alpha", "beta"]);
    const context = { groups, selectedUrls: selected };
    const union = precacheGroupUrls(context, ids);
    expect(union).toEqual(["/a.bin", "/a.ogg", "/b.bin", "/b.ogg"]);
    expect(
      precacheGroupUrls({ groups, selectedUrls: [...selected].reverse() }, [...ids].reverse()),
    ).toEqual(union);
    expect(
      precacheGroupUrls(
        { groups, selectedUrls: ["/a.bin", "/a.mp3", "/b.bin", "/b.mp3", "/shared.bin"] },
        ids,
      ),
    ).toEqual(["/a.bin", "/a.mp3", "/b.bin", "/b.mp3"]);
    expect(ids).toEqual(["alpha", "beta", "alpha", "beta"]);
  });

  it("validates the whole request before accessing the selected URL work inventory", () => {
    let reads = 0;
    const context = {
      groups,
      get selectedUrls(): readonly string[] {
        reads++;
        return selected;
      },
    };
    expect(() => precacheGroupUrls(context, ["alpha", "missing"])).toThrow(
      /Unknown precache group/,
    );
    expect(reads).toBe(0);
    expect(() => precacheGroupUrls({ groups, selectedUrls: [] }, ["missing"])).toThrow(
      /Unknown precache group/,
    );
  });

  it("supports empty partitions, known empty groups and empty requests without invented work", () => {
    const empty = validatePrecacheGroups(available, { initial: [], urls: {} });
    expect(basePrecacheUrls(empty, ["/page/", "/page/"])).toEqual(["/page/"]);
    expect(precacheGroupUrls({ groups: empty, selectedUrls: selected }, [])).toEqual([]);
    const partition = validatePrecacheGroups(available, {
      initial: ["empty"],
      urls: { empty: [] },
    });
    expect(precacheGroupUrls({ groups: partition, selectedUrls: selected }, ["empty"])).toEqual([]);
    expect(precacheGroupUrls({ groups, selectedUrls: [] }, groups.initial)).toEqual([]);
  });
});
