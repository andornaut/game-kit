import { describe, expect, it } from "vitest";

import {
  MAX_ORIGIN_MEMBER_ARCHIVE_BYTES,
  originMemberArchivePath,
  parseOriginMemberIndex,
} from "./originMemberIndex.ts";

const archive = { byteSize: 32, decodedByteSize: 8, sha256: "a".repeat(64) };
const member = {
  archiveSha256: archive.sha256,
  byteSize: 8,
  contentType: "application/json; charset=utf-8",
  offset: 0,
  path: "/data/a.json",
  sha256: "b".repeat(64),
};

describe("origin member index", () => {
  it("accepts complete coverage with exact aliases and empty files", () => {
    const index = {
      archives: [archive],
      members: [
        member,
        { ...member, path: "/data/r%C3%A9plica.json" },
        { ...member, byteSize: 0, offset: 8, path: "/empty", sha256: "c".repeat(64) },
      ],
      schema: 1,
    };

    expect(parseOriginMemberIndex(index)).toEqual(index);
    expect(originMemberArchivePath(archive.sha256)).toBe(
      `/.game-kit/origin-pack-${archive.sha256}.bin`,
    );
  });

  it("rejects oversized, incomplete and conflicting ranges", () => {
    const cases = [
      { archives: [{ ...archive, decodedByteSize: MAX_ORIGIN_MEMBER_ARCHIVE_BYTES + 1 }] },
      { archives: [{ ...archive, byteSize: 0 }] },
      { members: [{ ...member, byteSize: 7 }] },
      { members: [member, { ...member, byteSize: 2, offset: 6, path: "/tail" }] },
      { members: [member, { ...member, path: "/other", sha256: "c".repeat(64) }] },
    ];
    for (const change of cases) {
      expect(() =>
        parseOriginMemberIndex({ archives: [archive], members: [member], schema: 1, ...change }),
      ).toThrow();
    }
  });

  it("rejects ambiguous paths, unsafe media types, and unknown schema", () => {
    const cases = [
      { members: [member, member] },
      { members: [{ ...member, path: "/data/%2e%2e/a.json" }] },
      { members: [{ ...member, path: "/data%2Fa.json" }] },
      { members: [{ ...member, path: originMemberArchivePath(archive.sha256) }] },
      { members: [{ ...member, contentType: "text/plain\r\n" }] },
      { schema: 2 },
    ];
    for (const change of cases) {
      expect(() =>
        parseOriginMemberIndex({ archives: [archive], members: [member], schema: 1, ...change }),
      ).toThrow();
    }
  });
});
