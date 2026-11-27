import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

import { describe, expect, it, vi } from "vitest";

import {
  BUILD_ARCHIVE_PART_BYTES,
  buildArchivePartUrl,
  type BuildArchiveReference,
  type BuildGroupReference,
  buildGroupUrl,
} from "../../buildContract.ts";
import { downloadBuildArchive, downloadBuildGroup } from "./buildArchiveDownload.ts";

const archive: BuildArchiveReference = {
  byteSize: 3,
  schema: 1,
  sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
};
const timing = {
  clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  inactivityMs: 10_000,
  now: Date.now,
  setTimeout,
};

it("verifies the whole archive and measures the bytes it reads", async () => {
  const fetch = vi.fn(async () => new Response("abc"));
  const signal = new AbortController().signal;
  const onBytes = vi.fn();
  const result = await downloadBuildArchive({ ...timing, fetch, onBytes, signal }, archive);
  expect(await result.text()).toBe("abc");
  expect(fetch).toHaveBeenCalledExactlyOnceWith(buildArchivePartUrl(archive, 0), {
    cache: "no-store",
    redirect: "error",
    signal: expect.any(AbortSignal),
  });
  expect(onBytes).toHaveBeenLastCalledWith(3, 3);
});

it("rejects shorter, longer and same-size corrupt downloads", async () => {
  const signal = new AbortController().signal;
  for (const [body, message] of [
    ["ab", "Incomplete"],
    ["abcd", "exceeds"],
    ["abd", "checksum mismatch"],
  ]) {
    // eslint-disable-next-line no-await-in-loop
    await expect(
      downloadBuildArchive({ ...timing, fetch: async () => new Response(body), signal }, archive),
    ).rejects.toThrow(message);
  }
});

it("joins two hosting-sized parts under one checksum", async () => {
  const first = new Uint8Array(BUILD_ARCHIVE_PART_BYTES);
  first[first.length - 1] = 7;
  const second = new Uint8Array([9, 3]);
  const reference = {
    byteSize: first.length + second.length,
    schema: 1,
    sha256: createHash("sha256").update(first).update(second).digest("hex"),
  } as const;
  const fetch = vi.fn();
  fetch.mockResolvedValueOnce(new Response(first)).mockResolvedValueOnce(new Response(second));
  const result = await downloadBuildArchive(
    { ...timing, fetch, signal: new AbortController().signal },
    reference,
  );
  expect(result.size).toBe(reference.byteSize);
  expect([...new Uint8Array(await result.slice(first.length - 1).arrayBuffer())]).toEqual([
    7, 9, 3,
  ]);
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([
    buildArchivePartUrl(reference, 0),
    buildArchivePartUrl(reference, 1),
  ]);
});

it("fails a stalled transport without waiting for a response body", async () => {
  let timeout: (() => void) | undefined;
  let elapsed = 0;
  const fetch = vi.fn(
    () =>
      new Promise<Response>(() => {
        // The transport stalls before receiving headers.
      }),
  );
  const result = downloadBuildArchive(
    {
      ...timing,
      fetch,
      now: () => elapsed,
      setTimeout: (callback) => {
        timeout = callback;
        return undefined;
      },
      signal: new AbortController().signal,
    },
    archive,
  );
  elapsed = timing.inactivityMs;
  timeout?.();
  await expect(result).rejects.toThrow("stopped progressing");
});

describe("downloadBuildGroup", () => {
  const decoded = new TextEncoder().encode("member ".repeat(500));
  const encoded = new Uint8Array(gzipSync(decoded, { level: 9 }));
  const group: BuildGroupReference = {
    byteSize: decoded.byteLength,
    encodedByteSize: encoded.byteLength,
    encoding: "gzip",
    schema: 1,
    sha256: createHash("sha256").update(decoded).digest("hex"),
  };
  const signal = new AbortController().signal;

  it("decodes the gzip transport, verifies the archive and reports wire bytes", async () => {
    const fetch = vi.fn(async () => new Response(encoded));
    const onBytes = vi.fn();
    const result = await downloadBuildGroup({ ...timing, fetch, onBytes, signal }, group);
    expect(new Uint8Array(await result.arrayBuffer())).toEqual(decoded);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(buildGroupUrl(group), {
      cache: "no-store",
      redirect: "error",
      signal: expect.any(AbortSignal),
    });
    expect(buildGroupUrl(group)).toBe(`/.game-kit/group-${group.sha256}.bin`);
    expect(onBytes).toHaveBeenLastCalledWith(encoded.byteLength, encoded.byteLength);
    expect(encoded.byteLength).toBeLessThan(decoded.byteLength / 10);
  });

  it("reads a group without an encoding from its decoded archive", async () => {
    const plain = { byteSize: 3, schema: 1, sha256: archive.sha256 } as const;
    const fetch = vi.fn<(url: string) => Promise<Response>>(async () => new Response("abc"));
    expect(await (await downloadBuildGroup({ ...timing, fetch, signal }, plain)).text()).toBe(
      "abc",
    );
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([buildArchivePartUrl(plain, 0)]);
  });

  it("rejects transports and decoded archives that do not match the pointer", async () => {
    const other = gzipSync(new TextEncoder().encode("MEMBER ".repeat(500)), { level: 9 });
    for (const [reference, body, message] of [
      [group, encoded.subarray(1), "Incomplete"],
      [group, new Uint8Array([...encoded, 0]), "exceeds"],
      [{ ...group, byteSize: group.byteSize - 1 }, encoded, "exceeds its declared size"],
      [{ ...group, byteSize: group.byteSize + 1 }, encoded, "does not match its declared size"],
      [{ ...group, encodedByteSize: other.byteLength }, other, "checksum mismatch"],
    ] as const) {
      // eslint-disable-next-line no-await-in-loop
      await expect(
        downloadBuildGroup(
          { ...timing, fetch: async () => new Response(new Uint8Array(body)), signal },
          reference,
        ),
      ).rejects.toThrow(message);
    }
  });

  it("refuses a compressed group before fetching without a gzip decoder", async () => {
    vi.stubGlobal("DecompressionStream", undefined);
    try {
      const fetch = vi.fn();
      await expect(downloadBuildGroup({ ...timing, fetch, signal }, group)).rejects.toThrow(
        "cannot decode compressed build groups",
      );
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
