import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { parseBuildArchiveIndex } from "../buildArchive.ts";
import {
  BUILD_ARCHIVE_PART_BYTES,
  buildArchivePartUrl,
  buildManifestUrl,
  GROUP_ARCHIVE_IDENTITY,
} from "../buildContract.ts";
import { validateBuildPointer } from "../buildManifest.ts";
import { parseBuildPointer } from "../buildRecords.ts";
import { encodeGroupArchive } from "./groupArchive.ts";

const text = (value: string) => new TextEncoder().encode(value);
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const GROUP_ID = { buildId: GROUP_ARCHIVE_IDENTITY, version: GROUP_ARCHIVE_IDENTITY };

describe("encodeGroupArchive", () => {
  const members = [
    { bytes: text("tiles ".repeat(400)), url: "/data/level.json" },
    { bytes: text("console.log(1);".repeat(200)), url: "/assets/app.js" },
  ];

  it("names the group by its decoded archive and serves it as deterministic gzip", () => {
    const encoded = encodeGroupArchive({}, members);
    const { archive, group } = encoded;
    expect(group).toEqual({
      byteSize: archive.byteLength,
      encodedByteSize: encoded.encoded.byteLength,
      encoding: "gzip",
      schema: 1,
      sha256: digest(archive),
    });
    expect(encoded.path).toBe(`/.game-kit/group-${group.sha256}.bin`);
    expect(encoded.path).not.toBe(buildArchivePartUrl(group, 0));
    expect(Buffer.from(gunzipSync(encoded.encoded)).equals(Buffer.from(archive))).toBe(true);
    expect(encoded.encoded.byteLength).toBeLessThan(archive.byteLength / 4);
    // Portable header: no timestamp and the unknown OS byte.
    expect([...encoded.encoded.subarray(4, 8)]).toEqual([0, 0, 0, 0]);
    expect(encoded.encoded[9]).toBe(255);
    // Member order does not change the archive.
    const again = encodeGroupArchive({}, [...members].reverse());
    expect(Buffer.from(again.encoded).equals(Buffer.from(encoded.encoded))).toBe(true);
    expect(again.group).toEqual(group);
  });

  it("archives members in URL order with their media types", () => {
    const { archive, files } = encodeGroupArchive({}, members);
    const index = parseBuildArchiveIndex(GROUP_ID, archive.byteLength, archive);
    expect(index.files.map(({ contentType, url }) => [url, contentType])).toEqual([
      ["/assets/app.js", "text/javascript; charset=utf-8"],
      ["/data/level.json", "application/json"],
    ]);
    expect(files).toEqual(
      index.files.map(({ byteSize, contentType, url }) => [url, byteSize, contentType]),
    );
    const [first] = index.files;
    expect(
      new TextDecoder().decode(archive.subarray(first!.offset, first!.offset + first!.byteSize)),
    ).toBe("console.log(1);".repeat(200));
  });

  it("produces a pointer entry every kit validator accepts", () => {
    const tagged = encodeGroupArchive({ soundFormat: "ogg" }, [
      { bytes: new Uint8Array(64).fill(3), url: "/assets/s/hit-12345678.ogg" },
    ]);
    expect(tagged.group.soundFormat).toBe("ogg");
    const pointer = {
      buildId: "dev",
      groupedFirstInstall: true,
      groups: [encodeGroupArchive({}, members).group, tagged.group],
      manifest: buildManifestUrl("0123456789abcdef"),
      schema: 1,
      version: "0123456789abcdef",
    };
    expect(validateBuildPointer(pointer)).toEqual(pointer);
    expect(parseBuildPointer(pointer)).toEqual(pointer);
  });

  it("rejects repeated URLs, unknown media types and oversized groups", () => {
    expect(() => encodeGroupArchive({}, [members[0]!, members[0]!])).toThrow("Duplicate");
    expect(() => encodeGroupArchive({}, [{ bytes: text("x"), url: "/a.unknown" }])).toThrow(
      "Unknown build archive content type",
    );
    expect(() => encodeGroupArchive({ soundFormat: "" }, members)).toThrow(RangeError);
    expect(() =>
      encodeGroupArchive({}, [
        { bytes: new Uint8Array(BUILD_ARCHIVE_PART_BYTES), url: "/assets/big.bin" },
      ]),
    ).toThrow("Split the group");
  });
});
