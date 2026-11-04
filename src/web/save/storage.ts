// Web Storage shaped key-value objects as the save storage port: a read or write that throws
// (private mode, quota, blocked site data) becomes a rejected promise, which saveStore reports as
// unavailable.
import type { SaveStorage } from "../../save/contracts.ts";

// The part of a Web Storage object (localStorage, sessionStorage) the adapters use.
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

// storage as SaveStorage.
export function browserStorage(storage: StorageLike): SaveStorage {
  return {
    read: async (key) => storage.getItem(key),
    write: async (key, value) => {
      storage.setItem(key, value);
    },
  };
}

// Looks the storage up on each call: reading window.localStorage itself throws when the browser
// blocks site data, and this turns that into a throw from getItem or setItem, which browserStorage
// turns into a rejected promise.
export function lazyStorage(lookup: () => StorageLike): StorageLike {
  return {
    getItem: (key) => lookup().getItem(key),
    setItem: (key, value) => lookup().setItem(key, value),
  };
}
