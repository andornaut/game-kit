// SaveStorage for tests over a Map, with the failures browser storage produces.
import type { SaveStorage } from "../save/storage.ts";
import { checkRead, checkWrite, type StorageFailures } from "./storageFailures.ts";

export type { StorageFailures } from "./storageFailures.ts";

export interface StorageFixture extends SaveStorage {
  // The stored keys and values, for assertions and for seeding.
  readonly entries: Map<string, string>;
  readonly failures: StorageFailures;
}

// SaveStorage over entries that rejects as failures say.
export function storageFixture(
  failures: StorageFailures = {},
  entries: Map<string, string> = new Map(),
): StorageFixture {
  return {
    entries,
    failures,
    read: async (key) => {
      checkRead(failures);
      return entries.get(key) ?? null;
    },
    write: async (key, value) => {
      checkWrite(failures, entries, key, value);
      entries.set(key, value);
    },
  };
}
