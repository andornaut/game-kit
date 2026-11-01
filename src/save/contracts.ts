// Key-value storage for saves. Rejected operations are reported by saveStore as unavailable.
export interface SaveStorage {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
}
