import { expect, it, vi } from "vitest";

import { buildArchivePartUrl, type BuildArchiveReference } from "../buildContract.ts";
import { downloadBuildArchive } from "./buildArchiveDownload.ts";

const archive: BuildArchiveReference = {
  byteSize: 3,
  schema: 1,
  sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
};

it("verifies the whole archive and measures the bytes it reads", async () => {
  const fetch = vi.fn(async () => new Response("abc"));
  const signal = new AbortController().signal;
  const onBytes = vi.fn();
  const result = await downloadBuildArchive({ fetch, onBytes, signal }, archive);
  expect(await result.text()).toBe("abc");
  expect(fetch).toHaveBeenCalledExactlyOnceWith(buildArchivePartUrl(archive, 0), {
    cache: "no-store",
    redirect: "error",
    signal,
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
      downloadBuildArchive({ fetch: async () => new Response(body), signal }, archive),
    ).rejects.toThrow(message);
  }
});
