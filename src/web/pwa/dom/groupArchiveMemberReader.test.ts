import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

import { describe, expect, it, vi } from "vitest";

import { encodeBuildArchiveIndex } from "../archive/buildArchive.ts";
import {
  buildArchivePartUrl,
  buildGroupUrl,
  buildManifestUrl,
  GROUP_ARCHIVE_IDENTITY,
} from "../buildContract.ts";
import { createGroupArchiveMemberReader } from "./groupArchiveMemberReader.ts";

const digest = (body: Uint8Array) => createHash("sha256").update(body).digest("hex");

function groupOf(files: Readonly<Record<string, readonly [contentType: string, body: string]>>) {
  const prefix = encodeBuildArchiveIndex({
    buildId: GROUP_ARCHIVE_IDENTITY,
    files: Object.entries(files).map(([url, [contentType, body]]) => [
      url,
      Buffer.byteLength(body),
      contentType,
    ]),
    version: GROUP_ARCHIVE_IDENTITY,
  });
  const bytes = new Uint8Array(
    Buffer.concat([prefix, ...Object.values(files).map(([, body]) => Buffer.from(body))]),
  );
  const reference = { byteSize: bytes.byteLength, schema: 1 as const, sha256: digest(bytes) };
  return { bytes, path: buildArchivePartUrl(reference, 0), reference };
}

// The emitted form: the same archive, served as gzip at buildGroupUrl.
function gzipGroupOf(files: Parameters<typeof groupOf>[0]) {
  const { bytes: archive, reference } = groupOf(files);
  const bytes = new Uint8Array(gzipSync(archive, { level: 9 }));
  const gzip = {
    ...reference,
    encodedByteSize: bytes.byteLength,
    encoding: "gzip" as const,
  };
  return { archive, bytes, path: buildGroupUrl(gzip), reference: gzip };
}

type Group = ReturnType<typeof groupOf>;

const pointerOf = (...groups: Group[]) => ({
  buildId: "build",
  groupedFirstInstall: true,
  groups: groups.map(({ reference }) => reference),
  manifest: buildManifestUrl("v1"),
  schema: 1,
  version: "v1",
});

// Delivers the body in small chunks and records how many bytes the reader pulled.
function storage(...groups: Group[]) {
  const pulled = new Map<string, number>();
  const bodies = new Map(groups.map(({ bytes, path }) => [path, bytes]));
  const readArchive = vi.fn(async (path: string) => {
    const bytes = bodies.get(path);
    if (bytes === undefined) {
      return undefined;
    }
    let offset = 0;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        const end = Math.min(offset + 7, bytes.byteLength);
        controller.enqueue(bytes.slice(offset, end));
        pulled.set(path, end);
        offset = end;
        if (offset === bytes.byteLength) {
          controller.close();
        }
      },
    });
  });
  return { bodies, pulled, readArchive };
}

const art = groupOf({
  "/art/a.png": ["image/png", "first image"],
  "/art/b.png": ["image/png", "second image body"],
});
const core = groupOf({
  "/": ["text/html; charset=utf-8", "<p>game</p>"],
  "/app.js": ["text/javascript; charset=utf-8", "boot()"],
});

describe("group archive member reader", () => {
  it("serves a verified member at its original URL with the archived media type", async () => {
    const store = storage(core, art);
    const reader = createGroupArchiveMemberReader(store, pointerOf(core, art));
    const response = (await reader.read("/art/b.png"))!;
    expect(response.status).toBe(200);
    expect([...response.headers]).toEqual([
      ["content-length", String(Buffer.byteLength("second image body"))],
      ["content-type", "image/png"],
      ["x-content-type-options", "nosniff"],
    ]);
    expect(await response.text()).toBe("second image body");
    expect(await (await reader.read("/art/a.png"))!.text()).toBe("first image");
    expect(await (await reader.read("/app.js"))!.text()).toBe("boot()");
    // Locating reads only each index prefix. The served archives are read once each in full.
    expect(store.readArchive.mock.calls.map(([path]) => path)).toEqual([
      core.path,
      art.path,
      art.path,
      core.path,
    ]);
  });

  it("returns undefined for an unknown path and rejects a known member with invalid bytes", async () => {
    const store = storage(core, art);
    const reader = createGroupArchiveMemberReader(store, pointerOf(core, art));
    await expect(reader.read("/art/c.png")).resolves.toBeUndefined();
    await expect(reader.read("/art/a.png?v=1")).resolves.toBeUndefined();
    expect(store.pulled.get(art.path)).toBeLessThan(art.bytes.byteLength);
    const tampered = art.bytes.slice();
    tampered.set([tampered.at(-1)! ^ 1], tampered.byteLength - 1);
    store.bodies.set(art.path, tampered);
    await expect(reader.read("/art/a.png")).rejects.toThrow("checksum mismatch");
    store.bodies.delete(art.path);
    await expect(reader.read("/art/a.png")).rejects.toThrow("Missing build group archive");
    store.bodies.set(art.path, art.bytes);
    expect(await (await reader.read("/art/a.png"))!.text()).toBe("first image");
  });

  it("retries locating after a failed index read and rejects duplicate members", async () => {
    const store = storage(core);
    const reader = createGroupArchiveMemberReader(store, pointerOf(core, art));
    await expect(reader.read("/app.js")).rejects.toThrow("Missing build group archive");
    store.bodies.set(art.path, art.bytes);
    expect(await (await reader.read("/app.js"))!.text()).toBe("boot()");

    const again = groupOf({ "/app.js": ["text/javascript; charset=utf-8", "other()"] });
    const duplicate = createGroupArchiveMemberReader(storage(core, again), pointerOf(core, again));
    await expect(duplicate.read("/app.js")).rejects.toThrow("Duplicate build group member");
  });

  it("decodes compressed groups and verifies their decoded archive", async () => {
    const level = "tile ".repeat(300);
    const data = gzipGroupOf({ "/data/level.json": ["application/json", level] });
    const store = storage(core, data);
    const reader = createGroupArchiveMemberReader(store, pointerOf(core, data));
    const response = (await reader.read("/data/level.json"))!;
    expect(response.headers.get("content-length")).toBe(String(level.length));
    expect(await response.text()).toBe(level);
    expect(await (await reader.read("/app.js"))!.text()).toBe("boot()");
    expect(store.readArchive.mock.calls.map(([path]) => path)).toEqual([
      core.path,
      data.path,
      data.path,
      core.path,
    ]);
    expect(data.path).toBe(`/.game-kit/group-${data.reference.sha256}.bin`);
  });

  it("rejects a compressed group whose transport or decoded bytes do not match", async () => {
    const data = gzipGroupOf({ "/data/a.json": ["application/json", "[1,2,3]".repeat(40)] });
    for (const [body, message] of [
      [data.bytes.subarray(0, data.bytes.byteLength - 1), "does not match its declared size"],
      [new Uint8Array([...data.bytes, 0]), "exceeds its declared size"],
    ] as const) {
      const store = storage(data);
      // The index prefix still locates the member before the full archive is checked.
      store.bodies.set(data.path, body);
      // eslint-disable-next-line no-await-in-loop
      await expect(
        createGroupArchiveMemberReader(store, pointerOf(data)).read("/data/a.json"),
      ).rejects.toThrow(message);
    }
    // A valid gzip of another archive of the same size, at this group's path.
    const other = gzipGroupOf({ "/data/a.json": ["application/json", "[3,2,1]".repeat(40)] });
    const forged = {
      ...other,
      path: data.path,
      reference: { ...other.reference, sha256: data.reference.sha256 },
    };
    const reader = createGroupArchiveMemberReader(storage(forged), pointerOf(forged));
    await expect(reader.read("/data/a.json")).rejects.toThrow("checksum mismatch");
  });

  it("requires a grouped build pointer", () => {
    const plain = { buildId: "build", manifest: buildManifestUrl("v1"), schema: 1, version: "v1" };
    expect(() => createGroupArchiveMemberReader(storage(), plain)).toThrow("no groups");
  });
});
