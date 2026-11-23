import { describe, expect, it } from "vitest";

import {
  BUILD_ARCHIVE_HEADER_BYTES,
  type BuildArchiveFile,
  encodeBuildArchiveIndex,
  MAX_BUILD_ARCHIVE_INDEX_BYTES,
  parseBuildArchiveIndex,
  readBuildArchivePrefixSize,
} from "./buildArchive.ts";

const ID = { buildId: "dev", version: "0123456789abcdef" };
const ENCODER = new TextEncoder();
const JSON_INDEX =
  '{"schema":1,"version":"0123456789abcdef","buildId":"dev","files":[["/play/",3,"text/html; charset=utf-8"]]}';

function prefixWith(index: string | Uint8Array): Uint8Array<ArrayBuffer> {
  const body = typeof index === "string" ? ENCODER.encode(index) : index;
  const prefix = new Uint8Array(12 + body.byteLength);
  prefix.set(ENCODER.encode("GKBLD001"));
  new DataView(prefix.buffer).setUint32(8, body.byteLength, true);
  prefix.set(body, 12);
  return prefix;
}

function prefixWithFiles(files: readonly (readonly unknown[])[]) {
  // eslint-disable-next-line sort-keys -- The fixture uses the v1 wire order.
  return prefixWith(JSON.stringify({ schema: 1, version: ID.version, buildId: ID.buildId, files }));
}

function parseFile(file: readonly unknown[], payloadBytes = 0) {
  const prefix = prefixWithFiles([file]);
  return parseBuildArchiveIndex(ID, prefix.byteLength + payloadBytes, prefix);
}

describe("build archive v1", () => {
  it("emits exact deterministic header and index bytes in input order", () => {
    const input = { ...ID, files: [["/play/", 3, "text/html; charset=utf-8"]] } as const;
    const prefix = encodeBuildArchiveIndex(input);
    expect(prefix).toEqual(prefixWith(JSON_INDEX));
    expect(encodeBuildArchiveIndex(input)).toEqual(prefix);
    expect([...prefix.subarray(8, 12)]).toEqual([JSON_INDEX.length, 0, 0, 0]);
  });

  it("derives absolute offsets from two Blob slices, including encoded paths and empty bodies", async () => {
    const files: readonly BuildArchiveFile[] = [
      ["/play/", 3, "text/html; charset=utf-8"],
      ["/assets/%C3%A9%20sound.ogg", 0, "audio/ogg"],
      ["/data.json", 2, "application/json"],
    ];
    const prefix = encodeBuildArchiveIndex({ ...ID, files });
    const archive = new Blob([prefix, "abc{}"]);
    const header = new Uint8Array(await archive.slice(0, BUILD_ARCHIVE_HEADER_BYTES).arrayBuffer());
    const bytes = readBuildArchivePrefixSize(archive.size, header);
    expect(bytes).toBe(prefix.byteLength);
    const sliced = new Uint8Array(await archive.slice(0, bytes).arrayBuffer());
    const parsed = parseBuildArchiveIndex(ID, archive.size, sliced);
    expect(parsed).toEqual({
      ...ID,
      files: files.map(([url, byteSize, contentType], index) => ({
        byteSize,
        contentType,
        offset: index === 0 ? bytes : bytes + 3,
        url,
      })),
      payloadOffset: bytes,
      schema: 1,
    });
    const json = parsed.files[2]!;
    expect(await archive.slice(json.offset, json.offset + json.byteSize).text()).toBe("{}");

    const larger = new Uint8Array(archive.size + 5);
    larger.set(new Uint8Array(await archive.arrayBuffer()), 5);
    expect(parseBuildArchiveIndex(ID, archive.size, larger.subarray(5))).toEqual(parsed);
  });

  it("rejects corrupt magic, truncated prefixes, and impossible or oversized lengths", () => {
    const prefix = prefixWith(JSON_INDEX);
    const fullLength = prefix.byteLength + 3;
    expect(() => readBuildArchivePrefixSize(fullLength, prefix.subarray(0, 11))).toThrow();
    expect(() => parseBuildArchiveIndex(ID, fullLength, prefix.subarray(0, -1))).toThrow();
    expect(() => readBuildArchivePrefixSize(prefix.byteLength - 1, prefix)).toThrow();
    expect(() => readBuildArchivePrefixSize(Infinity, prefix)).toThrow();
    for (const length of [0, MAX_BUILD_ARCHIVE_INDEX_BYTES + 1, 0xffffffff]) {
      const bad = prefix.slice(0, 12);
      new DataView(bad.buffer).setUint32(8, length, true);
      expect(() => readBuildArchivePrefixSize(length + 12, bad)).toThrow(/index length/);
    }
    prefix[0] = 0;
    expect(() => parseBuildArchiveIndex(ID, fullLength, prefix)).toThrow(/header/);
    expect(() =>
      encodeBuildArchiveIndex({
        ...ID,
        files: [[`/${"a".repeat(MAX_BUILD_ARCHIVE_INDEX_BYTES)}`, 0, "text/plain"]],
      }),
    ).toThrow(/too large/);
  });

  it("rejects invalid UTF-8, duplicate object fields, extra fields and mismatched identity", () => {
    for (const index of [
      Uint8Array.of(0xc3, 0x28),
      `\uFEFF${JSON_INDEX}`,
      JSON_INDEX.replace('"schema":1', '"schema":1,"schema":1'),
      JSON_INDEX.replace('"schema":1', '"schema":2'),
      JSON_INDEX.replace('"files":', '"extra":true,"files":'),
    ]) {
      const prefix = prefixWith(index);
      expect(() => parseBuildArchiveIndex(ID, prefix.byteLength + 3, prefix)).toThrow();
    }
    const prefix = prefixWith(JSON_INDEX);
    for (const wrong of [
      { ...ID, version: "other" },
      { ...ID, buildId: "other" },
    ]) {
      expect(() => parseBuildArchiveIndex(wrong, prefix.byteLength + 3, prefix)).toThrow(
        /identity does not match/,
      );
    }
  });

  it.each([
    "https://example.test/a",
    "//example.test/a",
    "/a/../b",
    "/%2E%2E/b",
    "/a//b",
    "/a%2Fb",
    "/a%5Cb",
    "/a\\b",
    "/a%0Ab",
    "/%252E%252E/b",
    "/%61",
    "/%c3%a9",
    "/a%",
    "/a?b",
    "/a#b",
  ])("rejects a noncanonical path %j", (url) => {
    expect(() => parseFile([url, 0, "text/plain"])).toThrow(/path/);
  });

  it("rejects duplicate URLs and malformed file tuples", () => {
    const file = ["/play/", 0, "text/html"] as const;
    expect(() => encodeBuildArchiveIndex({ ...ID, files: [file, file] })).toThrow(/duplicate/);
    const prefix = prefixWithFiles([file, file]);
    expect(() => parseBuildArchiveIndex(ID, prefix.byteLength, prefix)).toThrow(/duplicate/);
    expect(() => parseFile(["/play/", 0, "text/html", "extra"])).toThrow(/tuple/);
  });

  it.each(["text", "*/*", "text/html, text/plain", "text/html\n", "text/html\r\nX-Foo: yes"])(
    "rejects unsafe media type %j",
    (contentType) => {
      expect(() => parseFile(["/play/", 0, contentType])).toThrow(/media type/);
    },
  );

  it("rejects noninteger and unsafe sizes, overflow, truncated payloads and trailing bytes", () => {
    for (const size of [-1, 0.1, Number.MAX_SAFE_INTEGER + 1, "1"]) {
      expect(() => parseFile(["/play/", size, "text/html"])).toThrow(/file size/);
    }
    expect(() => parseFile(["/play/", 3, "text/html"], 2)).toThrow(/file size/);
    expect(() => parseFile(["/play/", 3, "text/html"], 4)).toThrow(/trailing bytes/);
    expect(() =>
      encodeBuildArchiveIndex({
        ...ID,
        files: [["/play/", Number.MAX_SAFE_INTEGER, "text/html"]],
      }),
    ).toThrow(/too large/);
  });
});
