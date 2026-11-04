// The game save storage port and its in-memory implementation.

// Key-value storage for saves. Rejected operations are reported by saveStore as unavailable.
export interface SaveStorage {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
}

// Storage held in entries, for tests.
export function memoryStorage(entries: Map<string, string> = new Map()): SaveStorage {
  return {
    read: async (key) => entries.get(key) ?? null,
    write: async (key, value) => {
      entries.set(key, value);
    },
  };
}
