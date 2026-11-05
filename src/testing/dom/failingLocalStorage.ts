// A synchronous Web Storage object for tests over a Map, with the failures browser storage
// produces, to stand in for localStorage or sessionStorage.
import { checkRead, checkWrite, type StorageFailures } from "../storageFailures.ts";

export type { StorageFailures } from "../storageFailures.ts";

export interface FailingLocalStorage extends Storage {
  // The stored keys and values, for assertions and for seeding.
  readonly entries: Map<string, string>;
  readonly failures: StorageFailures;
}

// Storage over entries that throws as failures say: getItem, key and length are reads, and
// setItem, removeItem and clear are writes, of which only setItem is held to the quota. A
// thrown failure changes nothing. Assign it with vi.stubGlobal("localStorage", ...) to test code
// that looks localStorage up, such as web/save/dom/localSaveStorage.
export function failingLocalStorage(
  failures: StorageFailures = {},
  entries: Map<string, string> = new Map(),
): FailingLocalStorage {
  return {
    clear: () => {
      checkWrite(failures, entries, "");
      entries.clear();
    },
    entries,
    failures,
    getItem: (key) => {
      checkRead(failures);
      return entries.get(key) ?? null;
    },
    key: (index) => {
      checkRead(failures);
      return [...entries.keys()][index] ?? null;
    },
    get length() {
      checkRead(failures);
      return entries.size;
    },
    removeItem: (key) => {
      checkWrite(failures, entries, key);
      entries.delete(key);
    },
    setItem: (key, value) => {
      checkWrite(failures, entries, key, String(value));
      entries.set(key, String(value));
    },
  };
}
