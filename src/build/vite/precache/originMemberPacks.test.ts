import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  MAX_ORIGIN_MEMBER_ARCHIVE_BYTES,
  parseOriginMemberIndex,
} from "../../../web/pwa/originMemberIndex.ts";
import { buildOriginMemberPacks, type OriginMemberPackOptions } from "./originMemberPacks.ts";

const file = (path: string, body: string, contentType = "text/plain") => ({
  bytes: new TextEncoder().encode(body),
  contentType,
  path,
});
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

describe("buildOriginMemberPacks", () => {
  it("emits deterministic gzip bodies and indexes the exact selected ranges and aliases", () => {
    const a = file("/a", "alpha");
    const b = file("/b", "bravo!");
    const other = file("/other", "separate");
    const empty = file("/empty", "");
    const alias = file("/legacy-a", "alpha");
    const files = [other, b, a, empty, alias, file("/loose-only", "unchanged")];
    const aliases = { [alias.path]: a.path };
    const groups = { alpha: [empty.path, b.path, a.path], beta: [other.path] };
    const originalInputs = structuredClone({ files, groups });

    const result = buildOriginMemberPacks({ aliases, groups }, files);
    expect(result).toEqual(
      buildOriginMemberPacks(
        {
          aliases,
          groups: Object.fromEntries(
            Object.entries(groups)
              .reverse()
              .map(([id, paths]) => [id, [...paths].reverse()]),
          ),
        },
        [...files].reverse(),
      ),
    );
    expect(parseOriginMemberIndex(result.index)).toEqual(result.index);
    const hashes = result.index.archives.map((archive) => archive.sha256);
    expect(hashes).toEqual([...hashes].sort());
    expect(result.archives).toHaveLength(2);
    expect(result.index.members.map((member) => member.path)).toEqual([
      "/a",
      "/b",
      "/empty",
      "/legacy-a",
      "/other",
    ]);
    const [aEntry, bEntry, emptyEntry, aliasEntry] = result.index.members;
    expect(aEntry).toMatchObject({ offset: 0 });
    expect(bEntry).toMatchObject({ archiveSha256: aEntry!.archiveSha256, offset: 5 });
    expect(emptyEntry).toMatchObject({
      archiveSha256: aEntry!.archiveSha256,
      byteSize: 0,
      offset: 11,
    });
    expect(aliasEntry).toEqual({ ...aEntry, path: alias.path });

    for (const [position, archive] of result.archives.entries()) {
      const sha256 = digest(archive.bytes);
      expect(archive.path).toBe(`/.game-kit/origin-pack-${sha256}.bin`);
      expect([...archive.bytes.slice(4, 8)]).toEqual([0, 0, 0, 0]);
      expect(archive.bytes[9]).toBe(255);
      const decoded = gunzipSync(archive.bytes);
      expect(result.index.archives[position]).toEqual({
        byteSize: archive.bytes.byteLength,
        decodedByteSize: decoded.byteLength,
        sha256,
      });
      for (const member of result.index.members.filter((entry) => entry.archiveSha256 === sha256)) {
        const input = files.find((entry) => entry.path === member.path)!;
        const body = decoded.subarray(member.offset, member.offset + member.byteSize);
        expect(Uint8Array.from(body)).toEqual(input.bytes);
        expect(member.byteSize).toBe(input.bytes.byteLength);
        expect(member.contentType).toBe(input.contentType);
        expect(member.sha256).toBe(digest(input.bytes));
      }
    }
    expect({ files, groups }).toEqual(originalInputs);
  });

  const files = [
    file("/a", "original"),
    file("/alias", "original"),
    file("/different-body", "modified"),
    file("/different-mime", "original", "application/json"),
  ];
  const groups = { first: ["/a"] };
  const rejected: readonly [string, OriginMemberPackOptions, RegExp][] = [
    ["a missing group member", { groups: { first: ["/missing"] } }, /missing input \/missing/],
    ["an empty group", { groups: { first: [] } }, /group first is empty/],
    ["overlapping groups", { groups: { ...groups, second: ["/a"] } }, /selected more than once/],
    ["an undeclared alias", { aliases: { "/missing": "/a" }, groups }, /Missing input.*alias/],
    [
      "an alias chain",
      { aliases: { "/alias": "/a", "/missing": "/alias" }, groups },
      /canonical group member/,
    ],
    ["an alias overriding a member", { aliases: { "/a": "/a" }, groups }, /canonical group member/],
    [
      "a different alias body",
      { aliases: { "/different-body": "/a" }, groups },
      /differs .* in bytes or MIME type/,
    ],
    [
      "a different alias MIME type",
      { aliases: { "/different-mime": "/a" }, groups },
      /differs .* in bytes or MIME type/,
    ],
  ];
  it.each(rejected)("rejects %s", (_name, options, message) => {
    expect(() => buildOriginMemberPacks(options, files)).toThrow(message);
  });

  it("rejects selections above the archive and member limits", () => {
    const groups = Object.fromEntries(Array.from({ length: 101 }, (_, id) => [id, ["/unused"]]));
    expect(() => buildOriginMemberPacks({ groups }, [])).toThrow(/at most 100 .* groups/);

    const paths = Array.from({ length: 10_000 }, (_, id) => `/${id}`);
    const files = [...paths, "/alias"].map((path) => file(path, ""));
    expect(() =>
      buildOriginMemberPacks({ aliases: { "/alias": "/0" }, groups: { all: paths } }, files),
    ).toThrow(/at most 10000 .* including aliases/);
  });

  it("rejects both decoded and encoded archives above 24 MiB", () => {
    const options = { groups: { large: ["/large"] } };
    const input = file("/large", "", "application/octet-stream");
    const limit = MAX_ORIGIN_MEMBER_ARCHIVE_BYTES;
    expect(() =>
      buildOriginMemberPacks(options, [{ ...input, bytes: new Uint8Array(limit + 1) }]),
    ).toThrow(/Decoded .* Split the group/);

    // Fixed pseudo-random data expands in gzip and crosses the encoded limit.
    const bytes = new Uint8Array(limit);
    let state = 1;
    for (let offset = 0; offset < bytes.length; offset++) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      bytes[offset] = state;
    }
    expect(() => buildOriginMemberPacks(options, [{ ...input, bytes }])).toThrow(
      /Encoded .* Split the group/,
    );
  });
});
