import { describe, expect, it } from "vitest";

import { saveStore } from "../save/saveStore.ts";
import type { SaveFormat } from "../save/versionedSave.ts";
import { type StorageFailures, storageFixture } from "./storageFixture.ts";

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

describe("storageFixture", () => {
  it("reads what it wrote, null for a missing key, and keeps the given entries", async () => {
    const entries = new Map([["seeded", "1"]]);
    const storage = storageFixture({}, entries);
    await storage.write("k", "v");
    expect(await storage.read("k")).toBe("v");
    expect(await storage.read("seeded")).toBe("1");
    expect(await storage.read("missing")).toBeNull();
    expect(storage.entries).toBe(entries);
    expect([...entries]).toEqual([
      ["seeded", "1"],
      ["k", "v"],
    ]);
  });

  // Each failure, the read's and write's outcomes ("ok" or the rejection) and the entries after
  // writing "k" = "v" over { a: "12" }.
  it.each<[string, StorageFailures, unknown, unknown, Record<string, string>]>([
    ["unavailable", { unavailable: true }, SECURITY, SECURITY, { a: "12" }],
    ["readThrows", { readThrows: THROWN }, THROWN, "ok", { a: "12", k: "v" }],
    ["readThrows undefined", { readThrows: undefined }, undefined, "ok", { a: "12", k: "v" }],
    ["writeThrows", { writeThrows: THROWN }, "ok", THROWN, { a: "12" }],
    [
      "writeThrows ahead of unavailable",
      { unavailable: true, writeThrows: THROWN },
      SECURITY,
      THROWN,
      { a: "12" },
    ],
    ["a quota the write fits", { quota: 5 }, "ok", "ok", { a: "12", k: "v" }],
    ["a quota the write exceeds", { quota: 4 }, "ok", QUOTA, { a: "12" }],
    ["a quota predicate that refuses", { quota: (key) => key === "k" }, "ok", QUOTA, { a: "12" }],
    ["a quota predicate that allows", { quota: () => false }, "ok", "ok", { a: "12", k: "v" }],
  ])("with %s", async (_name, failures, read, write, after) => {
    const storage = storageFixture(failures, new Map([["a", "12"]]));
    const outcome = (promise: Promise<unknown>) =>
      promise.then(
        () => "ok",
        (error: unknown) =>
          error instanceof Error ? { message: error.message, name: error.name } : error,
      );
    expect(await outcome(storage.read("a"))).toEqual(read);
    expect(await outcome(storage.write("k", "v"))).toEqual(write);
    expect(Object.fromEntries(storage.entries)).toEqual(after);
  });

  it("rejects with Error instances, as browsers' DOMExceptions are", async () => {
    await expect(storageFixture({ unavailable: true }).read("k")).rejects.toBeInstanceOf(Error);
    await expect(storageFixture({ quota: 0 }).write("k", "v")).rejects.toBeInstanceOf(Error);
  });

  it("counts a replaced value once against the quota", async () => {
    const storage = storageFixture({ quota: 4 }, new Map([["k", "abc"]]));
    await expect(storage.write("k", "xyz")).resolves.toBeUndefined();
    await expect(storage.write("k", "wxyz")).rejects.toMatchObject({ name: "QuotaExceededError" });
    expect(storage.entries.get("k")).toBe("xyz");
  });

  it("applies failures changed between calls", async () => {
    const storage = storageFixture();
    await storage.write("k", "v");
    storage.failures.unavailable = true;
    await expect(storage.read("k")).rejects.toMatchObject({ name: "SecurityError" });
    delete storage.failures.unavailable;
    expect(await storage.read("k")).toBe("v");
  });

  // The failure, then saveStore's load and save statuses and the save's reason.
  it.each<[string, StorageFailures, string, string, string]>([
    ["unavailable", { unavailable: true }, "unavailable", "unavailable", "unavailable at load"],
    ["readThrows", { readThrows: new Error("blocked") }, "unavailable", "unavailable", "at load"],
    ["writeThrows", { writeThrows: new Error("full") }, "new", "unavailable", "full"],
    ["a quota", { quota: 1 }, "new", "unavailable", "exceeded the quota"],
  ])("makes saveStore report %s as it does browser storage", async (...cases) => {
    const [, failures, load, save, reason] = cases;
    const format: SaveFormat<number> = {
      decode: ({ coins }) =>
        typeof coins === "number" ? { ok: true, value: coins } : { ok: false, reason: "no coins" },
      encode: (coins) => ({ ok: true, value: { coins } }),
      fresh: () => 0,
      migrations: {},
      version: 1,
    };
    const store = saveStore(storageFixture(failures), { backup: "b", save: "s" }, format);
    expect(await store.load()).toMatchObject({ save: 0, status: load });
    const saved = await store.save(1);
    expect(saved).toMatchObject({ status: save });
    expect("reason" in saved && saved.reason).toContain(reason);
  });
});
