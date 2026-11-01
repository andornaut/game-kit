// A Map or WeakMap, as getOrInsertComputed uses it.
interface KeyedStore<Key, Value> {
  get(key: Key): Value | undefined;
  set(key: Key, value: Value): unknown;
}

// The value store holds for key, made by create and stored the first time it is asked for.
export function getOrInsertComputed<Key, Value>(
  key: Key,
  create: () => Value,
  store: KeyedStore<Key, Value>,
): Value {
  let value = store.get(key);
  if (value === undefined) {
    value = create();
    store.set(key, value);
  }
  return value;
}
