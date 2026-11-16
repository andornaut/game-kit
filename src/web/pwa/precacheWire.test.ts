import { describe, expect, it } from "vitest";

import { precacheFingerprint } from "./precacheList.ts";
import type { PrecacheManifest } from "./precacheManifest.ts";
import { decodePrecacheManifest, encodePrecacheManifest } from "./precacheWire.ts";

const POLICY = { cacheNamePrefix: "fixture-", hashedAssetPrefix: "/assets/" };
function manifest(): PrecacheManifest {
  return {
    buildId: "a".repeat(40),
    byteSizes: { "/a.json": 2, "/b.json": 2, "/sound.mp3": 3, "/sound.ogg": 4 },
    contentHashes: {
      "/a.json": "AAAAAAAA",
      "/b.json": "AAAAAAAA",
      "/sound.mp3": "BBBBBBBB",
      "/sound.ogg": "CCCCCCCC",
    },
    groups: {
      initial: ["later", "first"],
      urls: { first: ["/b.json", "/a.json"], later: ["/sound.ogg", "/sound.mp3"] },
    },
    sounds: { mp3: ["/sound.mp3"], ogg: ["/sound.ogg"] },
    urls: ["/b.json", "/a.json"],
    verifiedJsonBodies: [{ byteSize: 2, sha256: "0".repeat(64), urls: ["/b.json", "/a.json"] }],
    version: "0123456789abcdef",
  };
}
const fingerprint = (m: PrecacheManifest) =>
  precacheFingerprint(
    POLICY,
    new Map(
      [...new Set([...m.urls, ...Object.values(m.sounds).flat()])].map((url) => [
        url,
        m.contentHashes[url] ?? "",
      ]),
    ),
    m.byteSizes === undefined ? undefined : new Map(Object.entries(m.byteSizes)),
    m.groups === undefined ? undefined : { buildId: m.buildId!, groups: m.groups },
    m.verifiedJsonBodies,
  );

it("round trips semantic fields, array order and full body identity with the same fingerprint", () => {
  const input = manifest();
  const before = structuredClone(input);
  const wire = encodePrecacheManifest(input);
  const decoded = decodePrecacheManifest(JSON.parse(JSON.stringify(wire)));
  expect(decoded).toEqual(input);
  expect(fingerprint(decoded)).toBe(fingerprint(input));
  expect(input).toEqual(before);
  expect(wire[3]).toEqual(["/a.json", "/b.json", "/sound.mp3", "/sound.ogg"]);
  expect(wire[4]).toEqual([1, 0]);
  expect(JSON.stringify(wire).match(/\/a\.json/g)).toHaveLength(1);
});

it("preserves absent versus empty optional fields and ungrouped hashed files without recorded hashes", () => {
  const absent: PrecacheManifest = {
    contentHashes: { "/assets/hashed.js": "" },
    sounds: {},
    urls: ["/assets/hashed.js", "/another-hashed.js"],
    version: "0123456789abcdef",
  };
  expect(decodePrecacheManifest(encodePrecacheManifest(absent))).toEqual(absent);
  const empty: PrecacheManifest = {
    byteSizes: {},
    contentHashes: {},
    sounds: {},
    urls: [],
    verifiedJsonBodies: [],
    version: "0123456789abcdef",
  };
  expect(decodePrecacheManifest(encodePrecacheManifest(empty))).toEqual(empty);
  const grouped: PrecacheManifest = {
    ...empty,
    buildId: "b".repeat(40),
    groups: { initial: [], urls: {} },
  };
  expect(decodePrecacheManifest(encodePrecacheManifest(grouped))).toEqual(grouped);
});

it("keeps legacy semantic hash and URL shapes valid without applying new wire restrictions", () => {
  const legacy = {
    contentHashes: { "/index.html": "historic-hash" },
    sounds: {},
    urls: ["/index.html"],
    version: "old",
  };
  expect(decodePrecacheManifest(legacy)).toBe(legacy);
  expect(() => encodePrecacheManifest(legacy)).toThrow();
  for (const input of [null, {}, { ...legacy, version: "" }, { ...legacy, urls: [1] }]) {
    expect(() => decodePrecacheManifest(input)).toThrow();
  }
});

it("uses own properties for special group and sound keys", () => {
  const input: PrecacheManifest = { ...manifest(), verifiedJsonBodies: [] };
  input.groups = {
    initial: ["__proto__"],
    urls: Object.fromEntries([
      ["__proto__", ["/a.json"]],
      ["constructor", ["/b.json"]],
    ]),
  };
  input.sounds = Object.fromEntries([["__proto__", ["/sound.mp3", "/sound.ogg"]]]);
  const output = decodePrecacheManifest(encodePrecacheManifest(input));
  expect(output).toEqual(input);
  expect(Object.hasOwn(output.groups!.urls, "__proto__")).toBe(true);
  expect(Object.getPrototypeOf(output.groups!.urls)).toBe(Object.prototype);
});

describe("strict versioned wire", () => {
  it.each<[string, (wire: unknown[]) => void]>([
    [
      "unknown schema",
      (wire) => {
        wire[0] = 2;
      },
    ],
    [
      "extra tuple field",
      (wire) => {
        wire.push(null);
      },
    ],
    [
      "duplicate URL",
      (wire) => {
        (wire[3] as string[])[1] = "/a.json";
      },
    ],
    [
      "out of range reference",
      (wire) => {
        wire[4] = [99];
      },
    ],
    [
      "fractional reference",
      (wire) => {
        wire[4] = [0.5];
      },
    ],
    [
      "duplicate reference",
      (wire) => {
        wire[4] = [0, 0];
      },
    ],
    [
      "unclaimed table entry",
      (wire) => {
        wire[4] = [0];
        (wire[8] as unknown[])[1] = [];
      },
    ],
    [
      "malformed named tuple",
      (wire) => {
        wire[7] = [["ogg"]];
      },
    ],
    [
      "duplicate named key",
      (wire) => {
        wire[7] = [
          ["ogg", [2]],
          ["ogg", [3]],
        ];
      },
    ],
    [
      "incomplete sizes",
      (wire) => {
        wire[6] = [2];
      },
    ],
    [
      "unsafe size",
      (wire) => {
        (wire[6] as number[])[0] = Number.MAX_SAFE_INTEGER + 1;
      },
    ],
    [
      "negative size",
      (wire) => {
        (wire[6] as number[])[0] = -1;
      },
    ],
    [
      "malformed hash",
      (wire) => {
        (wire[5] as string[])[0] = "short";
      },
    ],
    [
      "missing grouped hash",
      (wire) => {
        (wire[5] as unknown[])[0] = null;
      },
    ],
    [
      "missing grouped size",
      (wire) => {
        wire[6] = null;
      },
    ],
    [
      "missing grouped build ID",
      (wire) => {
        wire[2] = null;
      },
    ],
    [
      "invalid build ID",
      (wire) => {
        wire[2] = "dev";
      },
    ],
    [
      "noncanonical wire version",
      (wire) => {
        wire[1] = "proof";
      },
    ],
    [
      "empty grouped hash",
      (wire) => {
        (wire[5] as unknown[])[0] = "";
      },
    ],
    [
      "invalid version",
      (wire) => {
        wire[1] = "";
      },
    ],
    [
      "unknown initial group",
      (wire) => {
        (wire[8] as unknown[])[0] = ["missing"];
      },
    ],
    [
      "overlapping group URLs",
      (wire) => {
        (wire[8] as unknown[])[1] = [
          ["first", [0]],
          ["later", [0]],
        ];
      },
    ],
    [
      "invalid full body hash",
      (wire) => {
        wire[9] = [["short", 2, [0, 1]]];
      },
    ],
    [
      "conflicting full body size",
      (wire) => {
        wire[9] = [["0".repeat(64), 3, [0, 1]]];
      },
    ],
  ])("rejects %s before returning a manifest", (_name, corrupt) => {
    const wire: unknown[] = structuredClone(
      encodePrecacheManifest(manifest()),
    ) as unknown as unknown[];
    corrupt(wire);
    expect(() => decodePrecacheManifest(wire)).toThrow();
  });
});
