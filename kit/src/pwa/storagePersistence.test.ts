import { describe, expect, it, vi } from "vitest";

import {
  requestPersistentStorage,
  type StorageManagerLike,
  type StoragePersistence,
} from "./storagePersistence";

const fails = () => Promise.reject(new Error("refused"));
const throws = () => {
  throw new Error("no storage");
};

describe("requestPersistentStorage", () => {
  it.each<[string, boolean, StorageManagerLike | undefined, StoragePersistence]>([
    ["reads no StorageManager as unsupported", true, undefined, "unsupported"],
    [
      "reads a StorageManager without persist as unsupported",
      true,
      { persisted: async () => false },
      "unsupported",
    ],
    [
      "keeps storage the browser grants",
      true,
      { persist: async () => true, persisted: async () => false },
      "persisted",
    ],
    ["reads a refusal as best effort", true, { persist: async () => false }, "bestEffort"],
    ["reads a rejected request as best effort", true, { persist: fails }, "bestEffort"],
    ["reads a throwing request as best effort", true, { persist: throws }, "bestEffort"],
    [
      "asks anyway when persisted fails",
      true,
      { persist: async () => true, persisted: fails },
      "persisted",
    ],
    [
      "reads kept storage in a browser tab",
      false,
      { persist: async () => true, persisted: async () => true },
      "persisted",
    ],
    [
      "reads storage not kept in a browser tab as not asked",
      false,
      { persist: async () => true, persisted: async () => false },
      "browserTab",
    ],
  ])("%s", async (_, installed, manager, expected) => {
    await expect(requestPersistentStorage(installed, manager)).resolves.toBe(expected);
  });

  it.each<[string, boolean, boolean, number]>([
    ["asks the installed app whose storage is not kept", true, false, 1],
    ["does not ask again for storage already kept", true, true, 0],
    ["never asks in a browser tab", false, false, 0],
  ])("%s", async (_, installed, kept, asks) => {
    const persist = vi.fn(async () => true);
    await requestPersistentStorage(installed, { persist, persisted: async () => kept });
    expect(persist).toHaveBeenCalledTimes(asks);
  });
});
