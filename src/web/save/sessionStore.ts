// Session storage that never throws: where the storage is missing or throws (private browsing,
// blocked site data), a read finds nothing, a write reports false and a remove does nothing, so
// the caller plays on.
import type { StorageLike } from "./storage.ts";

// The part of a Web Storage object (sessionStorage) a session store uses.
export interface SessionStorageLike extends StorageLike {
  removeItem(key: string): void;
}

export interface SessionStore {
  // null when the storage is unavailable or the key is unset.
  read(key: string): string | null;
  // Removes key; an unavailable storage has nothing to remove.
  remove(key: string): void;
  // Whether the value was stored.
  write(key: string, value: string): boolean;
}

// A session store over the storage lookup returns, looked up inside each operation's guard:
// reading window.sessionStorage itself throws when the browser blocks site data.
export function createSessionStore(lookup: () => SessionStorageLike): SessionStore {
  return {
    read(key) {
      try {
        return lookup().getItem(key);
      } catch {
        return null;
      }
    },
    remove(key) {
      try {
        lookup().removeItem(key);
      } catch {
        // Nothing stored is the same as nothing to remove.
      }
    },
    write(key, value) {
      try {
        lookup().setItem(key, value);
        return true;
      } catch {
        return false;
      }
    },
  };
}
