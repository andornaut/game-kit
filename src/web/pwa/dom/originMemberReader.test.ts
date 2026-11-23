import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

import { describe, expect, it, vi } from "vitest";

import { originMemberArchivePath } from "../originMemberIndex.ts";
import { createOriginMemberReader } from "./originMemberReader.ts";

const digest = (body: Uint8Array | string) => createHash("sha256").update(body).digest("hex");

function packed(
  files: Readonly<Record<string, string>>,
  encoded = gzipSync(Buffer.from(Object.values(files).join(""))),
) {
  const sha256 = digest(encoded);
  let decodedByteSize = 0;
  const members = Object.entries(files).map(([path, body]) => {
    const byteSize = Buffer.byteLength(body);
    const offset = decodedByteSize;
    decodedByteSize += byteSize;
    return {
      archiveSha256: sha256,
      byteSize,
      contentType: "text/plain; charset=utf-8",
      offset,
      path,
      sha256: digest(body),
    };
  });
  const archive = { byteSize: encoded.byteLength, decodedByteSize, sha256 };
  return { archive, encoded, members, transport: originMemberArchivePath(sha256) };
}

type Pack = ReturnType<typeof packed>;
const indexOf = (...packs: Pack[]) => ({
  archives: packs.map(({ archive }) => archive),
  members: packs.flatMap(({ members }) => members),
  schema: 1,
});

function streamFor(source: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(source.subarray(0, 3));
      controller.enqueue(source.subarray(3));
      controller.close();
    },
  });
}

describe("origin member reader", () => {
  it("looks up canonical members and returns only the verified slice with its original MIME", async () => {
    const pack = packed({ "/first": "prefix", "/second": "é🌱" });
    const readArchive = vi.fn(async () => streamFor(pack.encoded));
    const reader = createOriginMemberReader({ readArchive }, indexOf(pack));
    await expect(reader.read("/second?variant=1")).resolves.toBeUndefined();
    await expect(reader.read("/./second")).resolves.toBeUndefined();
    expect(readArchive).not.toHaveBeenCalled();
    const response = (await reader.read("/second"))!;
    expect(response.status).toBe(200);
    expect([...response.headers]).toEqual([
      ["content-length", "6"],
      ["content-type", "text/plain; charset=utf-8"],
      ["x-content-type-options", "nosniff"],
    ]);
    expect(await response.text()).toBe("é🌱");
    expect(await (await reader.read("/first"))?.text()).toBe("prefix");
    expect(readArchive).toHaveBeenCalledExactlyOnceWith(pack.transport);
  });

  it("serializes verification and retains only the last decoded archive", async () => {
    const first = packed({ "/a": "alpha", "/also-a": "same archive" });
    const second = packed({ "/b": "beta" });
    let supply!: (stream: ReadableStream<Uint8Array>) => void;
    const held = new Promise<ReadableStream<Uint8Array>>((resolve) => {
      supply = resolve;
    });
    const readArchive = vi
      .fn(async (path: string) =>
        streamFor(path === first.transport ? first.encoded : second.encoded),
      )
      .mockReturnValueOnce(held);
    const reader = createOriginMemberReader({ readArchive }, indexOf(first, second));
    const a = reader.read("/a");
    const alsoA = reader.read("/also-a");
    const b = reader.read("/b");
    await Promise.resolve();
    expect(readArchive).toHaveBeenCalledExactlyOnceWith(first.transport);
    supply(streamFor(first.encoded));
    expect(await (await a)?.text()).toBe("alpha");
    expect(await (await alsoA)?.text()).toBe("same archive");
    expect(await (await b)?.text()).toBe("beta");
    expect(await (await reader.read("/a"))?.text()).toBe("alpha");
    expect(readArchive.mock.calls).toEqual([
      [first.transport],
      [second.transport],
      [first.transport],
    ]);
  });

  it("fails closed for a known missing archive and allows a later verified retry", async () => {
    const pack = packed({ "/a": "alpha" });
    const readArchive = vi
      .fn<() => Promise<ReadableStream<Uint8Array> | undefined>>()
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(async () => streamFor(pack.encoded));
    const reader = createOriginMemberReader({ readArchive }, indexOf(pack));
    await expect(reader.read("/a")).rejects.toThrow("Missing origin member archive");
    expect(await (await reader.read("/a"))?.text()).toBe("alpha");
  });

  it("cancels an oversized encoded stream without buffering the excess", async () => {
    const pack = packed({ "/a": "alpha" });
    const cancel = vi.fn();
    const readArchive = async () =>
      new ReadableStream<Uint8Array>({
        cancel,
        start(controller) {
          controller.enqueue(new Uint8Array(pack.encoded.byteLength + 1));
        },
      });
    const reader = createOriginMemberReader({ readArchive }, indexOf(pack));
    await expect(reader.read("/a")).rejects.toThrow("exceeds its declared size");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects short or same-size corrupt encoded bytes before decompression", async () => {
    const pack = packed({ "/a": "alpha" });
    const readArchive = vi
      .fn()
      .mockImplementationOnce(async () => streamFor(pack.encoded.subarray(1)))
      .mockImplementationOnce(async () => streamFor(new Uint8Array(pack.encoded.byteLength)));
    const reader = createOriginMemberReader({ readArchive }, indexOf(pack));
    await expect(reader.read("/a")).rejects.toThrow("does not match its declared size");
    await expect(reader.read("/a")).rejects.toThrow("checksum mismatch");
  });

  it.each([
    { body: "a".repeat(512 * 1024), case: "too large", error: "exceeds its declared size" },
    { body: "a", case: "too small", error: "does not match its declared size" },
  ])("rejects a verified gzip archive whose decoded size is $case", async ({ body, error }) => {
    const pack = packed({ "/a": "alpha" }, gzipSync(Buffer.from(body)));
    const reader = createOriginMemberReader(
      { readArchive: async () => streamFor(pack.encoded) },
      indexOf(pack),
    );
    await expect(reader.read("/a")).rejects.toThrow(error);
  });

  it("rejects a bad member digest even when the whole gzip archive checks out", async () => {
    const pack = packed({ "/a": "alpha" });
    const index = indexOf(pack);
    index.members[0]!.sha256 = digest("other");
    const reader = createOriginMemberReader(
      { readArchive: async () => streamFor(pack.encoded) },
      index,
    );
    await expect(reader.read("/a")).rejects.toThrow("Origin member /a checksum mismatch");
  });

  it("serves an empty member from a valid empty gzip archive", async () => {
    const pack = packed({ "/empty": "" });
    const reader = createOriginMemberReader(
      { readArchive: async () => streamFor(pack.encoded) },
      indexOf(pack),
    );
    const response = (await reader.read("/empty"))!;
    expect(response.headers.get("content-length")).toBe("0");
    expect(await response.text()).toBe("");
  });
});
