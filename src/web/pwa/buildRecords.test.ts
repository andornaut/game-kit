import { describe, expect, it } from "vitest";

import { type BuildManifest, buildManifestUrl } from "./buildContract.ts";
import {
  installedManifest,
  parseBuildManifest,
  parseBuildPointer,
  parseVersionRecord,
  soundFormatOf,
  verifiedJsonFamilies,
  versionRecordText,
} from "./buildRecords.ts";

const sha = (digit: string) => digit.repeat(64);

const valid: BuildManifest = {
  boot: ["/a.js"],
  buildId: "build-v1",
  files: [
    { byteSize: 1, sha256: sha("a"), url: "/a.js" },
    { byteSize: 2, sha256: sha("b"), url: "/b.json" },
    { byteSize: 2, sha256: sha("b"), url: "/c.json" },
  ],
  schema: 1,
  sounds: {},
  version: "v1",
};

describe("version records", () => {
  it("writes and reads the {version} body", () => {
    expect(parseVersionRecord(JSON.parse(versionRecordText("v1")))).toBe("v1");
    for (const body of [null, "v1", {}, { version: null }, { version: "" }, { version: "a/b" }]) {
      expect(parseVersionRecord(body)).toBeUndefined();
    }
    expect(() => versionRecordText("a b")).toThrow(TypeError);
  });
});

describe("parseBuildPointer", () => {
  it("accepts a pointer naming its version's manifest and ignores added fields", () => {
    const pointer = { buildId: "id", manifest: buildManifestUrl("v1"), schema: 1, version: "v1" };
    expect(parseBuildPointer({ ...pointer, later: true })).toMatchObject(pointer);
    for (const invalid of [
      { ...pointer, schema: 2 },
      { ...pointer, manifest: buildManifestUrl("v2") },
      { ...pointer, version: "" },
      { ...pointer, buildId: 1 },
    ]) {
      expect(() => parseBuildPointer(invalid)).toThrow(TypeError);
    }
  });
});

describe("parseBuildManifest", () => {
  it("accepts a manifest with fields a later kit adds", () => {
    expect(parseBuildManifest(valid)).toBe(valid);
    const later = { ...valid, packs: [] };
    expect(parseBuildManifest(later)).toBe(later);
  });

  it("rejects malformed manifests", () => {
    for (const invalid of [
      { ...valid, schema: 2 },
      { ...valid, version: "a b" },
      { ...valid, files: [{ byteSize: 1, sha256: "A".repeat(64), url: "/a.js" }] },
      { ...valid, files: [{ byteSize: -1, sha256: sha("a"), url: "/a.js" }] },
      { ...valid, files: [{ byteSize: 1, sha256: sha("a"), url: "//evil/a.js" }] },
      { ...valid, files: [...valid.files, ...valid.files] },
      { ...valid, boot: undefined },
      { ...valid, boot: ["/missing.js"] },
      { ...valid, verifiedJsonBodies: {} },
    ]) {
      expect(() => parseBuildManifest(invalid)).toThrow(TypeError);
    }
  });
});

describe("verifiedJsonFamilies", () => {
  it("maps each member URL to its family", () => {
    const family = { byteSize: 2, sha256: sha("b"), urls: ["/b.json", "/c.json"] };
    const families = verifiedJsonFamilies({ ...valid, verifiedJsonBodies: [family] });
    expect([...families.keys()]).toEqual(["/b.json", "/c.json"]);
    expect(families.get("/c.json")).toEqual(family);
    expect(verifiedJsonFamilies(valid).size).toBe(0);
  });

  it("rejects a family whose digest differs from its files", () => {
    expect(() =>
      verifiedJsonFamilies({
        ...valid,
        files: [...valid.files.slice(0, 2), { byteSize: 2, sha256: sha("c"), url: "/c.json" }],
        verifiedJsonBodies: [{ byteSize: 2, sha256: sha("b"), urls: ["/b.json", "/c.json"] }],
      }),
    ).toThrow(RangeError);
  });
});

describe("installedManifest", () => {
  const withSounds: BuildManifest = {
    boot: ["/a.js", "/s/hit-1.m4a", "/s/hum-1.m4a"],
    buildId: "build-v1",
    files: [
      { byteSize: 1, sha256: sha("a"), url: "/a.js" },
      { byteSize: 3, sha256: sha("c"), url: "/s/hit-1.ogg" },
      { byteSize: 4, sha256: sha("d"), url: "/s/hit-1.m4a" },
      { byteSize: 5, sha256: sha("e"), url: "/s/hum-1.m4a" },
    ],
    schema: 1,
    sounds: { "/s/hit": ["/s/hit-1.ogg", "/s/hit-1.m4a"], "/s/hum": ["/s/hum-1.m4a"] },
    version: "v1",
  };

  it("names an alternative's format by its URL's extension", () => {
    expect(soundFormatOf("/assets/hit-1a2b.ogg")).toBe("ogg");
    expect(soundFormatOf("/a.b/hit")).toBeUndefined();
  });

  it("keeps only the chosen format's alternatives and every other file, and records the format", () => {
    expect(installedManifest("ogg", withSounds)).toEqual({
      boot: ["/a.js", "/s/hit-1.ogg"],
      buildId: "build-v1",
      files: [withSounds.files[0], withSounds.files[1]],
      schema: 1,
      soundFormat: "ogg",
      sounds: { "/s/hit": ["/s/hit-1.ogg"] },
      version: "v1",
    });
    expect(installedManifest("m4a", withSounds).files.map((file) => file.url)).toEqual([
      "/a.js",
      "/s/hit-1.m4a",
      "/s/hum-1.m4a",
    ]);
  });

  it("keeps every alternative without a format, and ignores a recorded format", () => {
    const all = installedManifest(undefined, {
      ...withSounds,
      soundFormat: "ogg",
    } as BuildManifest);
    expect(all).toEqual(withSounds);
    expect(all).not.toHaveProperty("soundFormat");
  });

  it("leaves left-out alternatives out of verified JSON families", () => {
    const family = { byteSize: 2, sha256: sha("b"), urls: ["/b.json", "/s/c.json"] };
    const json: BuildManifest = {
      ...valid,
      files: [...valid.files.slice(0, 2), { byteSize: 2, sha256: sha("b"), url: "/s/c.json" }],
      sounds: { "/s/c": ["/s/c.json"] },
      verifiedJsonBodies: [family],
    };
    expect(installedManifest("ogg", json).verifiedJsonBodies).toEqual([]);
    expect(installedManifest("json", json).verifiedJsonBodies).toEqual([family]);
  });
});
