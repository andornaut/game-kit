// A record's own keys, typed as its key type: Object.keys types them as string.
export function keysOf<Key extends string>(record: Readonly<Partial<Record<Key, unknown>>>): Key[] {
  return Object.keys(record) as Key[];
}
