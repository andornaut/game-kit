import { describe, expect, it } from "vitest";

import { saveStore } from "./saveStore";
import { browserStorage, lazyStorage, memoryStorage, type SaveStorage } from "./storage";
import type { SaveFormat } from "./versionedSave";

// A save of a count of coins at version 1, which refuses a negative count.
const FORMAT: SaveFormat<number> = {
  decode: ({ coins }) =>
    typeof coins === "number" ? { ok: true, value: coins } : { ok: false, reason: "no coins" },
  encode: (coins) => (coins >= 0 ? { ok: true, value: { coins } } : { ok: false, reason: "debt" }),
  fresh: () => 0,
  migrations: {},
  version: 1,
};
const KEYS = { backup: "game:save-backup", save: "game:save" };
const STORED = JSON.stringify({ coins: 5, version: 1 });
const NEWER = JSON.stringify({ coins: 5, version: 2 });

// Memory storage that can be told to throw, and that counts its writes.
function faultyStorage(entries: Map<string, string>, faults: { read?: boolean; write?: boolean }) {
  const inner = memoryStorage(entries);
  const calls = { writes: 0 };
  const storage: SaveStorage = {
    read: async (key) => {
      if (faults.read) {
        throw new Error("storage is disabled");
      }
      return inner.read(key);
    },
    write: async (key, value) => {
      calls.writes += 1;
      if (faults.write) {
        throw new Error("quota exceeded");
      }
      return inner.write(key, value);
    },
  };
  return { calls, storage };
}

describe("saveStore", () => {
  it("round-trips a save", async () => {
    const entries = new Map<string, string>();
    const store = saveStore(memoryStorage(entries), KEYS, FORMAT);
    expect(await store.save(5)).toEqual({ status: "saved" });
    expect([...entries]).toEqual([[KEYS.save, STORED]]);
    expect(await saveStore(memoryStorage(entries), KEYS, FORMAT).load()).toEqual({
      save: 5,
      status: "loaded",
    });
  });

  // A corrupt save is backed up and replaced by the next write; a later version's save is
  // neither backed up nor written over for the session.
  it.each<[string, string, "corrupt" | "newer", string | undefined, "saved" | "unavailable"]>([
    ["a corrupt save", "{not json", "corrupt", "{not json", "saved"],
    ["a newer version's save", NEWER, "newer", undefined, "unavailable"],
  ])("starts %s fresh", async (_case, raw, status, backup, written) => {
    const entries = new Map([[KEYS.save, raw]]);
    const store = saveStore(memoryStorage(entries), KEYS, FORMAT);
    expect(await store.load()).toEqual({ reason: expect.any(String), save: 0, status });
    expect(entries.get(KEYS.backup)).toBe(backup);
    expect((await store.save(5)).status).toBe(written);
    expect(entries.get(KEYS.save)).toBe(written === "saved" ? STORED : raw);
  });

  it("refuses to write a save the format cannot encode and keeps the stored one", async () => {
    const entries = new Map([[KEYS.save, STORED]]);
    expect(await saveStore(memoryStorage(entries), KEYS, FORMAT).save(-1)).toEqual({
      reason: "debt",
      status: "invalid",
    });
    expect(entries.get(KEYS.save)).toBe(STORED);
  });

  describe("when storage throws", () => {
    it("reports a failed read as unavailable and plays on with a fresh save", async () => {
      const { storage } = faultyStorage(new Map(), { read: true });
      expect(await saveStore(storage, KEYS, FORMAT).load()).toEqual({
        reason: "storage is disabled",
        save: 0,
        status: "unavailable",
      });
    });

    it("stops writing after a failed read, so an unread save is never overwritten", async () => {
      const entries = new Map([[KEYS.save, STORED]]);
      const faults = { read: true };
      const { calls, storage } = faultyStorage(entries, faults);
      const store = saveStore(storage, KEYS, FORMAT);
      await store.load();
      faults.read = false;
      expect((await store.save(1)).status).toBe("unavailable");
      expect(calls.writes).toBe(0);
      expect(entries.get(KEYS.save)).toBe(STORED);
    });

    it("reports a failed write as unavailable, and a later write can succeed", async () => {
      const entries = new Map<string, string>();
      const faults = { write: true };
      const { storage } = faultyStorage(entries, faults);
      const store = saveStore(storage, KEYS, FORMAT);
      expect(await store.save(5)).toEqual({ reason: "quota exceeded", status: "unavailable" });
      expect(entries.has(KEYS.save)).toBe(false);
      faults.write = false;
      expect(await store.save(5)).toEqual({ status: "saved" });
      expect(entries.get(KEYS.save)).toBe(STORED);
    });

    it("stops writing when a corrupt save cannot be backed up", async () => {
      const entries = new Map([[KEYS.save, "{not json"]]);
      const faults = { write: true };
      const { calls, storage } = faultyStorage(entries, faults);
      const store = saveStore(storage, KEYS, FORMAT);
      expect((await store.load()).status).toBe("unavailable");
      faults.write = false;
      expect((await store.save(1)).status).toBe("unavailable");
      expect(calls.writes).toBe(1);
      expect(entries.get(KEYS.save)).toBe("{not json");
    });
  });
});

describe("browserStorage", () => {
  it("turns a throwing setItem into an unavailable save", async () => {
    const full = browserStorage({
      getItem: () => null,
      setItem: () => {
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      },
    });
    expect(await saveStore(full, KEYS, FORMAT).save(5)).toEqual({
      reason: "The quota has been exceeded.",
      status: "unavailable",
    });
  });
});

describe("lazyStorage", () => {
  it("turns a storage that cannot even be looked up into an unavailable load", async () => {
    const blocked = lazyStorage(() => {
      throw new DOMException("Access is denied for this document.", "SecurityError");
    });
    expect((await saveStore(browserStorage(blocked), KEYS, FORMAT).load()).status).toBe(
      "unavailable",
    );
  });

  it("reads and writes through the Storage-like object it looks up", async () => {
    const entries = new Map<string, string>();
    const local = lazyStorage(() => ({
      getItem: (key) => entries.get(key) ?? null,
      setItem: (key, value) => {
        entries.set(key, value);
      },
    }));
    const store = saveStore(browserStorage(local), KEYS, FORMAT);
    await store.save(5);
    expect(entries.get(KEYS.save)).toBe(STORED);
    expect((await store.load()).save).toBe(5);
  });
});
