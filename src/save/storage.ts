// In-memory implementation of the game save storage port.
import type { SaveStorage } from "./contracts.ts";

export type { SaveStorage } from "./contracts.ts";

// Storage held in entries, for tests.
export function memoryStorage(entries: Map<string, string> = new Map()): SaveStorage {
  return {
    read: async (key) => entries.get(key) ?? null,
    write: async (key, value) => {
      entries.set(key, value);
    },
  };
}
