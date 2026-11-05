// SaveStorage for tests over a Map, with the failures browser storage produces.
import type { SaveStorage } from "../save/storage.ts";

// The failures a StorageFixture produces, checked on each call, so a test may change them between
// calls. unavailable rejects every read and write as storage blocked by the browser does. quota
// is the most characters the keys and values may hold together, as Web Storage counts them, or
// a predicate that is true when a write exceeds it: such a write rejects and changes nothing.
// readThrows and writeThrows, when present, are the rejection of every read or write, ahead of
// the other failures.
export interface StorageFailures {
  quota?: number | ((key: string, value: string) => boolean);
  readThrows?: unknown;
  unavailable?: boolean;
  writeThrows?: unknown;
}

export interface StorageFixture extends SaveStorage {
  // The stored keys and values, for assertions and for seeding.
  readonly entries: Map<string, string>;
  readonly failures: StorageFailures;
}

// An Error named as the DOMException a browser throws, so error.name and error.message read as
// they do from localStorage.
function domError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

function blocked(): Error {
  return domError(
    "SecurityError",
    "Failed to read the 'localStorage' property from 'Window': Access is denied for this document.",
  );
}

function size(entries: ReadonlyMap<string, string>): number {
  let total = 0;
  for (const [key, value] of entries) {
    total += key.length + value.length;
  }
  return total;
}

function exceeds(
  quota: NonNullable<StorageFailures["quota"]>,
  entries: ReadonlyMap<string, string>,
  key: string,
  value: string,
): boolean {
  if (typeof quota === "function") {
    return quota(key, value);
  }
  const previous = entries.get(key);
  const replaced = previous === undefined ? 0 : key.length + previous.length;
  return size(entries) - replaced + key.length + value.length > quota;
}

// SaveStorage over entries that fails as failures say.
export function storageFixture(
  failures: StorageFailures = {},
  entries: Map<string, string> = new Map(),
): StorageFixture {
  return {
    entries,
    failures,
    read: async (key) => {
      if ("readThrows" in failures) {
        throw failures.readThrows;
      }
      if (failures.unavailable === true) {
        throw blocked();
      }
      return entries.get(key) ?? null;
    },
    write: async (key, value) => {
      if ("writeThrows" in failures) {
        throw failures.writeThrows;
      }
      if (failures.unavailable === true) {
        throw blocked();
      }
      if (failures.quota !== undefined && exceeds(failures.quota, entries, key, value)) {
        throw domError(
          "QuotaExceededError",
          `Failed to execute 'setItem' on 'Storage': Setting the value of '${key}' exceeded the quota.`,
        );
      }
      entries.set(key, value);
    },
  };
}
