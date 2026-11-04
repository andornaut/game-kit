import { describe, expect, it } from "vitest";

import { browserStorage, lazyStorage, type StorageLike } from "./storage.ts";

function mapStorage(entries: Map<string, string> = new Map()): StorageLike {
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
  };
}

const throwing: StorageLike = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

describe("browserStorage", () => {
  it.each<[string, string | null]>([
    ["stored", "value"],
    ["unset", null],
  ])("reads a %s key", async (key, value) => {
    const storage = browserStorage(mapStorage(new Map([["stored", "value"]])));
    await expect(storage.read(key)).resolves.toBe(value);
  });

  it("writes through to the storage", async () => {
    const entries = new Map<string, string>();
    await browserStorage(mapStorage(entries)).write("key", "value");
    expect([...entries]).toEqual([["key", "value"]]);
  });

  it.each(["read", "write"] as const)("rejects a %s that throws", async (operation) => {
    const storage = browserStorage(throwing);
    const result = operation === "read" ? storage.read("key") : storage.write("key", "value");
    await expect(result).rejects.toThrow(Error);
  });
});

describe("lazyStorage", () => {
  it("looks the storage up on each call", () => {
    const lookups: StorageLike[] = [];
    const storages = [mapStorage(), mapStorage(new Map([["key", "second"]]))];
    const storage = lazyStorage(() => {
      const next = storages[lookups.length] ?? throwing;
      lookups.push(next);
      return next;
    });
    storage.setItem("key", "first");
    expect([storage.getItem("key"), lookups.length]).toEqual(["second", 2]);
  });

  it.each(["read", "write"] as const)(
    "turns a throwing lookup into a rejected %s",
    async (operation) => {
      const storage = browserStorage(
        lazyStorage(() => {
          throw new Error("SecurityError");
        }),
      );
      const result = operation === "read" ? storage.read("key") : storage.write("key", "value");
      await expect(result).rejects.toThrow("SecurityError");
    },
  );
});
