import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { encodeBuildArchiveIndex } from "../../archive/buildArchive.ts";
import type { UpdateGroupRecipeFile, UpdateGroupRecipes } from "../../archive/buildGroupRecipes.ts";
import { buildArchivePartUrl, GROUP_ARCHIVE_IDENTITY } from "../../buildContract.ts";
import { createUpdateGroupArchiveReader } from "./updateGroupArchiveReader.ts";

const digest = (body: Uint8Array) => createHash("sha256").update(body).digest("hex");

function group() {
  const members = new Map([
    ["/app.js", Buffer.from("export const label = 'é';")],
    ["/empty.css", Buffer.alloc(0)],
  ]);
  const files: UpdateGroupRecipeFile[] = [
    [
      "/app.js",
      members.get("/app.js")!.byteLength,
      "text/javascript",
      digest(members.get("/app.js")!),
    ],
    ["/empty.css", 0, "text/css", digest(members.get("/empty.css")!)],
  ];
  // Use the same archive encoder as the producer, independent of the recipe prefix helper.
  const prefix = encodeBuildArchiveIndex({
    buildId: GROUP_ARCHIVE_IDENTITY,
    files: files.map(([url, size, type]) => [url, size, type]),
    version: GROUP_ARCHIVE_IDENTITY,
  });
  const bytes = Buffer.concat([prefix, ...members.values()]);
  const archive = { byteSize: bytes.byteLength, schema: 1 as const, sha256: digest(bytes) };
  const recipe = { archive, files };
  const recipes: UpdateGroupRecipes = { groups: [recipe], schema: 1 };
  return { bytes, members, path: buildArchivePartUrl(archive, 0), recipe, recipes };
}

function stream(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.subarray(0, 2));
      controller.enqueue(bytes.subarray(2));
      controller.close();
    },
  });
}

describe("update group archive reader", () => {
  it("round-trips the producer's bytes, including an empty member, and matches only the exact part path", async () => {
    const { bytes, members, path, recipes } = group();
    const readMember = vi.fn(async (url: string) => stream(members.get(url)!));
    const reader = createUpdateGroupArchiveReader({ readMember }, recipes);

    await expect(reader.read(`${path}?v=1`)).resolves.toBeUndefined();
    await expect(reader.read(path.replace(/-0\.bin$/, "-1.bin"))).resolves.toBeUndefined();
    expect(readMember).not.toHaveBeenCalled();

    const response = (await reader.read(path))!;
    expect(response.status).toBe(200);
    expect([...response.headers]).toEqual([
      ["content-length", String(bytes.byteLength)],
      ["content-type", "application/octet-stream"],
    ]);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    expect(readMember.mock.calls).toEqual([["/app.js"], ["/empty.css"]]);
    expect(Buffer.from(await (await reader.read(path))!.arrayBuffer())).toEqual(bytes);
    expect(readMember).toHaveBeenCalledTimes(4);
  });

  it("serializes requests and cancels an oversized stream before the next reconstruction", async () => {
    const { bytes, members, path, recipes } = group();
    let supply!: (source: ReadableStream<Uint8Array>) => void;
    const held = new Promise<ReadableStream<Uint8Array>>((resolve) => {
      supply = resolve;
    });
    const cancel = vi.fn();
    const readMember = vi
      .fn(async (url: string) => stream(members.get(url)!))
      .mockReturnValueOnce(held);
    const reader = createUpdateGroupArchiveReader({ readMember }, recipes);
    const a = reader.read(path);
    const b = reader.read(path);
    await Promise.resolve();
    expect(readMember).toHaveBeenCalledExactlyOnceWith("/app.js");

    supply(
      new ReadableStream({
        cancel,
        start(controller) {
          controller.enqueue(new Uint8Array(members.get("/app.js")!.byteLength + 1));
        },
      }),
    );
    await expect(a).rejects.toThrow("exceeds its declared size");
    expect(cancel).toHaveBeenCalledOnce();
    expect(Buffer.from(await (await b)!.arrayBuffer())).toEqual(bytes);
    expect(readMember.mock.calls).toEqual([["/app.js"], ["/app.js"], ["/empty.css"]]);
  });

  it("rejects missing, truncated and same-size corrupt known member bodies", async () => {
    const { members, path, recipes } = group();
    const readMember = vi
      .fn<(url: string) => Promise<ReadableStream<Uint8Array> | undefined>>()
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(async () => stream(members.get("/app.js")!.subarray(1)))
      .mockImplementationOnce(async () =>
        stream(new Uint8Array(members.get("/app.js")!.byteLength)),
      );
    const reader = createUpdateGroupArchiveReader({ readMember }, recipes);
    await expect(reader.read(path)).rejects.toThrow("Missing update group member /app.js");
    await expect(reader.read(path)).rejects.toThrow("does not match its declared size");
    await expect(reader.read(path)).rejects.toThrow(
      "Update group member /app.js checksum mismatch",
    );
    expect(readMember.mock.calls).toEqual([["/app.js"], ["/app.js"], ["/app.js"]]);
  });

  it("rejects a wrong archive digest even when every member verifies", async () => {
    const { members, recipe } = group();
    const archive = { ...recipe.archive, sha256: "0".repeat(64) };
    const readMember = vi.fn(async (url: string) => stream(members.get(url)!));
    const reader = createUpdateGroupArchiveReader(
      { readMember },
      { groups: [{ ...recipe, archive }], schema: 1 },
    );
    await expect(reader.read(buildArchivePartUrl(archive, 0))).rejects.toThrow(
      "Update group archive checksum mismatch",
    );
    expect(readMember.mock.calls).toEqual([["/app.js"], ["/empty.css"]]);
  });
});
