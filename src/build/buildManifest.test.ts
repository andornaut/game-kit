import { describe, expect, it } from "vitest";

import { buildManifestUrl } from "../web/pwa/buildContract.ts";
import {
  createBuildManifest,
  createBuildPointer,
  UNKNOWN_BUILD_ID,
  validateBuildManifest,
  validateBuildPointer,
} from "./buildManifest.ts";

const VERSION = "0123456789abcdef";
const BUILD_ID = "a".repeat(40);
const JSON_SHA = "b".repeat(64);

function manifest(): Record<string, unknown> {
  return {
    boot: ["/art/sprite.png"],
    buildId: BUILD_ID,
    files: [
      { byteSize: 10, sha256: "1".repeat(64), url: "/" },
      { byteSize: 3, sha256: "2".repeat(64), url: "/art/a.ogg" },
      { byteSize: 4, sha256: "3".repeat(64), url: "/art/a.mp3" },
      { byteSize: 0, sha256: "4".repeat(64), url: "/art/sprite.png" },
      { byteSize: 2, sha256: JSON_SHA, url: "/a.json" },
      { byteSize: 2, sha256: JSON_SHA, url: "/b.json" },
    ],
    schema: 1,
    sounds: { "/art/a": ["/art/a.ogg", "/art/a.mp3"] },
    verifiedJsonBodies: [{ byteSize: 2, sha256: JSON_SHA, urls: ["/b.json", "/a.json"] }],
    version: VERSION,
  };
}

function without(value: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
}

function pointer(): Record<string, unknown> {
  return { buildId: BUILD_ID, manifest: buildManifestUrl(VERSION), schema: 1, version: VERSION };
}

describe("validateBuildPointer", () => {
  it("returns a frozen copy of a well-formed pointer", () => {
    const input = pointer();
    const result = validateBuildPointer(input);
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
    expect(Object.isFrozen(result)).toBe(true);
    expect(validateBuildPointer({ ...input, buildId: UNKNOWN_BUILD_ID }).buildId).toBe("dev");
  });

  it.each<[string, unknown, ErrorConstructor]>([
    ["a non-object", [], TypeError],
    ["null", null, TypeError],
    ["an extra key", { ...pointer(), extra: 1 }, TypeError],
    ["a missing key", { ...pointer(), buildId: undefined }, TypeError],
    ["another schema", { ...pointer(), schema: 2 }, RangeError],
    ["a short version", { ...pointer(), version: "abc" }, RangeError],
    ["an uppercase version", { ...pointer(), version: VERSION.toUpperCase() }, RangeError],
    ["a numeric version", { ...pointer(), version: 1 }, TypeError],
    ["a short build ID", { ...pointer(), buildId: "a".repeat(8) }, RangeError],
    [
      "another version's manifest",
      { ...pointer(), manifest: buildManifestUrl("f".repeat(16)) },
      RangeError,
    ],
  ])("rejects %s", (_, value, error) => {
    expect(() => validateBuildPointer(value)).toThrow(error);
  });

  const GROUP = { byteSize: 40, schema: 1, sha256: "c".repeat(64) };
  const GZIP = { ...GROUP, encodedByteSize: 30, encoding: "gzip", sha256: "d".repeat(64) };
  const TAGGED = { ...GROUP, sha256: "e".repeat(64), soundFormat: "ogg" };

  it.each<[string, Record<string, unknown>]>([
    ["a whole-build archive", { archive: { byteSize: 9, schema: 1, sha256: "f".repeat(64) } }],
    ["plain groups", { groups: [GROUP] }],
    ["sound-format groups", { groups: [GROUP, TAGGED] }],
    ["compressed groups", { groups: [GZIP, { ...TAGGED, encodedByteSize: 41, encoding: "gzip" }] }],
    ["a grouped first install", { groupedFirstInstall: true, groups: [GROUP, GZIP, TAGGED] }],
  ])("accepts %s, as the producer emits it", (_, fields) => {
    const input = { ...pointer(), ...fields, buildId: UNKNOWN_BUILD_ID };
    const result = validateBuildPointer(input);
    expect(result).toEqual(input);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it.each<[string, Record<string, unknown>, ErrorConstructor]>([
    ["both an archive and groups", { archive: GROUP, groups: [GZIP] }, TypeError],
    ["a grouped first install without groups", { groupedFirstInstall: true }, TypeError],
    ["a false grouped first install", { groupedFirstInstall: false, groups: [GROUP] }, TypeError],
    ["no groups", { groups: [] }, RangeError],
    ["101 groups", { groups: Array.from({ length: 101 }, () => GROUP) }, RangeError],
    ["a repeated group", { groups: [GROUP, { ...GROUP }] }, RangeError],
    ["an extra group key", { groups: [{ ...GROUP, url: "/x" }] }, TypeError],
    ["an oversized group", { groups: [{ ...GROUP, byteSize: 24 * 1024 * 1024 + 1 }] }, RangeError],
    ["an empty sound format", { groups: [{ ...GROUP, soundFormat: "" }] }, RangeError],
    ["another encoding", { groups: [{ ...GZIP, encoding: "br" }] }, RangeError],
    ["an encoding without its size", { groups: [{ ...GROUP, encoding: "gzip" }] }, TypeError],
    ["a size without its encoding", { groups: [{ ...GROUP, encodedByteSize: 3 }] }, TypeError],
    ["an empty transport", { groups: [{ ...GZIP, encodedByteSize: 0 }] }, RangeError],
    ["an uppercase digest", { groups: [{ ...GROUP, sha256: "C".repeat(64) }] }, RangeError],
  ])("rejects %s", (_, fields, error) => {
    expect(() => validateBuildPointer({ ...pointer(), ...fields })).toThrow(error);
  });
});

describe("validateBuildManifest", () => {
  it("returns a frozen copy with canonical verified families", () => {
    const input = manifest();
    const result = validateBuildManifest(input);
    expect(result.files).toEqual(input.files);
    expect(result.sounds).toEqual(input.sounds);
    expect(result.verifiedJsonBodies).toEqual([
      { byteSize: 2, sha256: JSON_SHA, urls: ["/a.json", "/b.json"] },
    ]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.files[0])).toBe(true);
    expect(Object.isFrozen(result.sounds["/art/a"])).toBe(true);
    expect(validateBuildManifest(without(input, "verifiedJsonBodies"))).not.toHaveProperty(
      "verifiedJsonBodies",
    );
  });

  const files = manifest().files as Record<string, unknown>[];
  const withFile = (patch: Record<string, unknown>) => ({
    ...manifest(),
    files: [{ ...files[0], ...patch }, ...files.slice(1)],
  });
  it.each<[string, unknown, ErrorConstructor]>([
    ["a non-object", "manifest", TypeError],
    ["an extra key", { ...manifest(), groups: {} }, TypeError],
    ["a missing boot list", { ...manifest(), boot: undefined }, TypeError],
    ["another schema", { ...manifest(), schema: 0 }, RangeError],
    ["a bad version", { ...manifest(), version: "v1" }, RangeError],
    ["a bad build ID", { ...manifest(), buildId: `${BUILD_ID}\n` }, RangeError],
    ["non-array files", { ...manifest(), files: {} }, TypeError],
    ["an extra file key", withFile({ contentHash: "x" }), TypeError],
    ["a short SHA-256", withFile({ sha256: "1".repeat(8) }), RangeError],
    ["an uppercase SHA-256", withFile({ sha256: "A".repeat(64) }), RangeError],
    ["a string size", withFile({ byteSize: "10" }), TypeError],
    ["an infinite size", withFile({ byteSize: Infinity }), RangeError],
    ["a fractional size", withFile({ byteSize: 1.5 }), RangeError],
    ["a negative size", withFile({ byteSize: -1 }), RangeError],
    ["a cross-origin URL", withFile({ url: "//other.test/a" }), RangeError],
    ["an absolute URL", withFile({ url: "https://other.test/a" }), RangeError],
    ["a query", withFile({ url: "/?x" }), RangeError],
    ["a dot segment", withFile({ url: "/a/../b" }), RangeError],
    ["an index.html URL", withFile({ url: "/guide/index.html" }), RangeError],
    ["a reserved URL", withFile({ url: "/.game-kit/build.json" }), RangeError],
    ["a repeated URL", withFile({ url: "/art/a.ogg" }), RangeError],
    ["an unlisted sound alternative", { ...manifest(), sounds: { "/x": ["/x.ogg"] } }, RangeError],
    ["a sound without alternatives", { ...manifest(), sounds: { "/x": [] } }, RangeError],
    ["a relative logical sound URL", { ...manifest(), sounds: { x: ["/art/a.ogg"] } }, RangeError],
    [
      "an alternative of two sounds",
      { ...manifest(), sounds: { "/a": ["/art/a.ogg"], "/b": ["/art/a.ogg"] } },
      RangeError,
    ],
    ["non-array sounds", { ...manifest(), sounds: [] }, TypeError],
    ["an unlisted boot file", { ...manifest(), boot: ["/missing.png"] }, RangeError],
    ["a repeated boot file", { ...manifest(), boot: ["/", "/"] }, RangeError],
    [
      "a family hash differing from its files",
      {
        ...manifest(),
        verifiedJsonBodies: [{ byteSize: 2, sha256: "c".repeat(64), urls: ["/a.json", "/b.json"] }],
      },
      RangeError,
    ],
    [
      "a family size differing from its files",
      {
        ...manifest(),
        verifiedJsonBodies: [{ byteSize: 3, sha256: JSON_SHA, urls: ["/a.json", "/b.json"] }],
      },
      RangeError,
    ],
    [
      "a family with an extra key",
      {
        ...manifest(),
        verifiedJsonBodies: [{ byteSize: 2, extra: 1, sha256: JSON_SHA, urls: ["/a.json"] }],
      },
      TypeError,
    ],
    [
      "a family with string URLs",
      { ...manifest(), verifiedJsonBodies: [{ byteSize: 2, sha256: JSON_SHA, urls: "/a.json" }] },
      TypeError,
    ],
  ])("rejects %s", (_, value, error) => {
    expect(() => validateBuildManifest(value)).toThrow(error);
  });
});

describe("createBuildManifest", () => {
  it("sorts files and sounds, keeps alternative and boot order, and round-trips JSON", () => {
    const input = without(manifest(), "schema");
    const created = createBuildManifest({
      ...(input as unknown as Parameters<typeof createBuildManifest>[0]),
      sounds: Object.fromEntries([
        ["/z", ["/art/sprite.png"]],
        ["/art/a", ["/art/a.mp3", "/art/a.ogg"]],
      ]),
    });
    expect(created.schema).toBe(1);
    expect(created.files.map((file) => file.url)).toEqual([
      "/",
      "/a.json",
      "/art/a.mp3",
      "/art/a.ogg",
      "/art/sprite.png",
      "/b.json",
    ]);
    expect(Object.keys(created.sounds)).toEqual(["/art/a", "/z"]);
    expect(created.sounds["/art/a"]).toEqual(["/art/a.mp3", "/art/a.ogg"]);
    expect(created.boot).toEqual(["/art/sprite.png"]);
    expect(validateBuildManifest(JSON.parse(JSON.stringify(created)))).toEqual(created);
  });

  it("throws for invalid content", () => {
    const input = without(manifest(), "schema");
    expect(() =>
      createBuildManifest({
        ...(input as unknown as Parameters<typeof createBuildManifest>[0]),
        boot: ["/missing"],
      }),
    ).toThrow(RangeError);
  });
});

describe("createBuildPointer", () => {
  it("names the manifest's version, build ID and manifest URL", () => {
    const built = validateBuildManifest(manifest());
    expect(createBuildPointer(built)).toEqual(pointer());
  });
});
