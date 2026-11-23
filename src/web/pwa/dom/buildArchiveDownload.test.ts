import { expect, it, vi } from "vitest";

import { buildArchivePartUrl, type BuildArchiveReference } from "../buildContract.ts";
import { downloadBuildArchive } from "./buildArchiveDownload.ts";

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
