import { describe, expect, it, vi } from "vitest";

import { type SaveStore, saveStore } from "./saveStore.ts";
import { memoryStorage, type SaveStorage } from "./storage.ts";
import type { SaveFormat } from "./versionedSave.ts";

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

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
  it.each([1.25, Number.MAX_SAFE_INTEGER + 1, Number.MAX_VALUE])(
    "fences future header %s without migration, decoding, backup, encoding or writes",
    async (version) => {
      const raw = JSON.stringify({ version });
      const entries = new Map([[KEYS.save, raw]]);
      const { calls, storage } = faultyStorage(entries, {});
      const decode = vi.fn(FORMAT.decode);
      const encode = vi.fn(FORMAT.encode);
      const migrate = vi.fn(() => ({ version: 1 }));
      const store = saveStore(storage, KEYS, {
        ...FORMAT,
        decode,
        encode,
        migrations: { 0: migrate },
      });
      expect((await store.load()).status).toBe("newer");
      expect((await store.save(2)).status).toBe("unavailable");
      expect(migrate).not.toHaveBeenCalled();
      expect(decode).not.toHaveBeenCalled();
      expect(encode).not.toHaveBeenCalled();
      expect(calls.writes).toBe(0);
      expect([...entries]).toEqual([[KEYS.save, raw]]);
    },
  );

  it("keeps the first external stop reason through loads and skips every later encoder and write", async () => {
    const entries = new Map([[KEYS.save, STORED]]);
    const { calls, storage } = faultyStorage(entries, {});
    const encode = vi.fn(FORMAT.encode);
    const store = saveStore(storage, KEYS, { ...FORMAT, encode });
    store.blockWrites("another store requires an update");
    store.blockWrites("later reason");
    expect(await store.load()).toEqual({ save: 5, status: "loaded" });
    expect(await store.save(3)).toEqual({
      reason: "another store requires an update",
      status: "unavailable",
    });
    entries.set(KEYS.save, NEWER);
    expect((await store.load()).status).toBe("newer");
    expect(await store.save(3)).toEqual({
      reason: "another store requires an update",
      status: "unavailable",
    });
    expect(encode).not.toHaveBeenCalled();
    expect(calls.writes).toBe(0);
    expect(entries.get(KEYS.save)).toBe(NEWER);
  });

  it("latches an empty reason before load without backing up a corrupt save", async () => {
    const entries = new Map([[KEYS.save, "broken"]]);
    const { calls, storage } = faultyStorage(entries, {});
    const store = saveStore(storage, KEYS, FORMAT);
    store.blockWrites("");
    store.blockWrites("later reason");
    expect(await store.load()).toEqual({ reason: "", save: 0, status: "unavailable" });
    expect(await store.save(1)).toEqual({ reason: "", status: "unavailable" });
    expect(calls.writes).toBe(0);
    expect([...entries]).toEqual([[KEYS.save, "broken"]]);
  });

  it("does not enter corrupt backup when blocked during a pending read", async () => {
    const read = deferred<string | null>();
    const write = vi.fn<SaveStorage["write"]>();
    const store = saveStore({ read: () => read.promise, write }, KEYS, FORMAT);
    const load = store.load();
    store.blockWrites("session stopped");
    read.resolve("broken");
    expect(await load).toEqual({ reason: "session stopped", save: 0, status: "unavailable" });
    expect((await store.save(1)).status).toBe("unavailable");
    expect(write).not.toHaveBeenCalled();
  });

  it.each(["valid", "invalid", "throw"] as const)(
    "rechecks the write fence after an encoder blocks and returns %s",
    async (outcome) => {
      const entries = new Map([[KEYS.save, STORED]]);
      const { calls, storage } = faultyStorage(entries, {});
      const encode = vi.fn<SaveFormat<number>["encode"]>(() => {
        store.blockWrites("encoder stopped the session");
        if (outcome === "throw") {
          throw new Error("encoder failed");
        }
        return outcome === "invalid"
          ? { ok: false, reason: "invalid value" }
          : { ok: true, value: { coins: 8 } };
      });
      const store: SaveStore<number> = saveStore(storage, KEYS, { ...FORMAT, encode });
      expect(await store.save(8)).toEqual({
        reason: "encoder stopped the session",
        status: "unavailable",
      });
      expect((await store.save(9)).status).toBe("unavailable");
      expect(encode).toHaveBeenCalledOnce();
      expect(calls.writes).toBe(0);
      expect(entries.get(KEYS.save)).toBe(STORED);
    },
  );

  it("never rearms an internal newer-save fence when a later load succeeds", async () => {
    const entries = new Map([[KEYS.save, NEWER]]);
    const { calls, storage } = faultyStorage(entries, {});
    const store = saveStore(storage, KEYS, FORMAT);
    expect((await store.load()).status).toBe("newer");
    entries.set(KEYS.save, STORED);
    expect((await store.load()).status).toBe("loaded");
    store.blockWrites("later external stop");
    expect(await store.save(1)).toEqual({
      reason: "a newer version of the game wrote the stored save",
      status: "unavailable",
    });
    expect(calls.writes).toBe(0);
  });

  it("reports the actual completion of an already-entered write without admitting another", async () => {
    const pending = deferred<void>();
    const entries = new Map<string, string>();
    const write = vi.fn<SaveStorage["write"]>(async (key, value) => {
      await pending.promise;
      entries.set(key, value);
    });
    const store = saveStore({ read: async () => null, write }, KEYS, FORMAT);
    const save = store.save(5);
    expect(write).toHaveBeenCalledOnce();
    store.blockWrites("session stopped");
    expect(await store.save(7)).toEqual({ reason: "session stopped", status: "unavailable" });
    pending.resolve();
    expect(await save).toEqual({ status: "saved" });
    expect(write).toHaveBeenCalledOnce();
    expect(entries.get(KEYS.save)).toBe(STORED);
  });

  // A save the format refuses, or whose encoding JSON cannot hold, keeps the stored one.
  it.each([
    ["format refusal", "debt"],
    ["bigint", "The save could not be encoded as JSON"],
    ["cycle", "The save could not be encoded as JSON"],
    ["encoder", "The save could not be encoded as JSON"],
  ])("reports %s encoding failure without writing", async (kind, reason) => {
    const entries = new Map([[KEYS.save, STORED]]);
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const format: SaveFormat<number> =
      kind === "format refusal"
        ? FORMAT
        : {
            ...FORMAT,
            encode: () => {
              if (kind === "encoder") {
                throw new Error("private encoder detail");
              }
              return { ok: true, value: kind === "cycle" ? cycle : { value: 1n } };
            },
          };
    const { calls, storage } = faultyStorage(entries, {});
    expect(await saveStore(storage, KEYS, format).save(-1)).toEqual({ reason, status: "invalid" });
    expect(calls.writes).toBe(0);
    expect(entries.get(KEYS.save)).toBe(STORED);
  });
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
      expect((await store.load()).status).toBe("loaded");
      store.blockWrites("later external stop");
      expect(await store.save(1)).toEqual({
        reason: "storage was unavailable at load",
        status: "unavailable",
      });
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
      entries.set(KEYS.save, STORED);
      expect((await store.load()).status).toBe("loaded");
      expect((await store.save(1)).status).toBe("unavailable");
      expect(calls.writes).toBe(1);
      expect(entries.get(KEYS.save)).toBe(STORED);
    });
  });
});
