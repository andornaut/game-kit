import { afterEach, describe, expect, it, vi } from "vitest";

import { saveStore } from "../../save/saveStore.ts";
import type { SaveFormat } from "../../save/versionedSave.ts";
import { localSaveStorage } from "../../web/save/dom/localSaveStorage.ts";
import { failingLocalStorage, type StorageFailures } from "./failingLocalStorage.ts";

const SECURITY = {
  message:
    "Failed to read the 'localStorage' property from 'Window': Access is denied for this document.",
  name: "SecurityError",
};
const QUOTA = {
  message: "Failed to execute 'setItem' on 'Storage': Setting the value of 'k' exceeded the quota.",
  name: "QuotaExceededError",
};
const THROWN = Symbol("thrown");

// "ok" for a call that returns, or what it threw, with an Error as its name and message.
function outcome(call: () => unknown): unknown {
  try {
    call();
    return "ok";
  } catch (error) {
    return error instanceof Error ? { message: error.message, name: error.name } : error;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("failingLocalStorage", () => {
  it("stores as Web Storage does and keeps the given entries", () => {
    const entries = new Map([["seeded", "1"]]);
    const storage = failingLocalStorage({}, entries);
    storage.setItem("k", "v");
    expect(storage.getItem("k")).toBe("v");
    expect(storage.getItem("missing")).toBeNull();
    expect(storage.length).toBe(2);
    expect([storage.key(0), storage.key(1), storage.key(2)]).toEqual(["seeded", "k", null]);
    storage.removeItem("seeded");
    expect(Object.fromEntries(entries)).toEqual({ k: "v" });
    storage.clear();
    expect(storage.length).toBe(0);
    expect(storage.entries).toBe(entries);
  });

  // Each failure, the outcomes of the reads (getItem, key, length), of setItem("k", "v"), of
  // removeItem and clear, and the entries after them over { a: "12" }.
  it.each<[string, StorageFailures, unknown, unknown, unknown, Record<string, string>]>([
    ["unavailable", { unavailable: true }, SECURITY, SECURITY, SECURITY, { a: "12" }],
    ["readThrows", { readThrows: THROWN }, THROWN, "ok", "ok", {}],
    ["writeThrows", { writeThrows: THROWN }, "ok", THROWN, THROWN, { a: "12" }],
    [
      "writeThrows ahead of unavailable",
      { unavailable: true, writeThrows: THROWN },
      SECURITY,
      THROWN,
      THROWN,
      { a: "12" },
    ],
    ["a quota the write fits", { quota: 5 }, "ok", "ok", "ok", {}],
    ["a quota the write exceeds", { quota: 4 }, "ok", QUOTA, "ok", {}],
    ["a quota predicate that refuses", { quota: (key) => key === "k" }, "ok", QUOTA, "ok", {}],
  ])("with %s", (_name, failures, read, write, remove, after) => {
    const storage = failingLocalStorage(failures, new Map([["a", "12"]]));
    expect(outcome(() => storage.getItem("a"))).toEqual(read);
    expect(outcome(() => storage.key(0))).toEqual(read);
    expect(outcome(() => storage.length)).toEqual(read);
    expect(outcome(() => storage.setItem("k", "v"))).toEqual(write);
    const kept = new Map(storage.entries);
    expect(outcome(() => storage.removeItem("k"))).toEqual(remove);
    expect(outcome(() => storage.clear())).toEqual(remove);
    if (remove !== "ok") {
      expect(storage.entries).toEqual(kept);
    }
    expect(Object.fromEntries(storage.entries)).toEqual(after);
  });

  it("applies failures changed between calls", () => {
    const storage = failingLocalStorage();
    storage.setItem("k", "v");
    storage.failures.unavailable = true;
    expect(() => storage.getItem("k")).toThrow(expect.objectContaining({ name: "SecurityError" }));
    delete storage.failures.unavailable;
    expect(storage.getItem("k")).toBe("v");
  });

  // The failure, then saveStore's load and save statuses and the save's reason, through
  // localSaveStorage over the fixture as the page's localStorage.
  it.each<[string, StorageFailures, string, string, string]>([
    ["unavailable", { unavailable: true }, "unavailable", "unavailable", "unavailable at load"],
    ["readThrows", { readThrows: new Error("blocked") }, "unavailable", "unavailable", "at load"],
    ["writeThrows", { writeThrows: new Error("full") }, "new", "unavailable", "full"],
    ["a quota", { quota: 1 }, "new", "unavailable", "exceeded the quota"],
  ])(
    "makes saveStore over localSaveStorage report %s as it does browser storage",
    async (...cases) => {
      const [, failures, load, save, reason] = cases;
      vi.stubGlobal("localStorage", failingLocalStorage(failures));
      const format: SaveFormat<number> = {
        decode: ({ coins }) =>
          typeof coins === "number"
            ? { ok: true, value: coins }
            : { ok: false, reason: "no coins" },
        encode: (coins) => ({ ok: true, value: { coins } }),
        fresh: () => 0,
        migrations: {},
        version: 1,
      };
      const store = saveStore(localSaveStorage(), { backup: "b", save: "s" }, format);
      expect(await store.load()).toMatchObject({ save: 0, status: load });
      const saved = await store.save(1);
      expect(saved).toMatchObject({ status: save });
      expect("reason" in saved && saved.reason).toContain(reason);
    },
  );

  it("saves through localSaveStorage when nothing fails", async () => {
    const storage = failingLocalStorage();
    vi.stubGlobal("localStorage", storage);
    await localSaveStorage().write("k", "v");
    expect(storage.entries.get("k")).toBe("v");
  });
});
