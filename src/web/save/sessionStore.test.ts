import { describe, expect, it } from "vitest";

import { createSessionStore, type SessionStorageLike } from "./sessionStore.ts";

function mapStorage(entries: Map<string, string>): SessionStorageLike {
  return {
    getItem: (key) => entries.get(key) ?? null,
    removeItem: (key) => {
      entries.delete(key);
    },
    setItem: (key, value) => {
      entries.set(key, value);
    },
  };
}

function fail(): never {
  throw new Error("SecurityError");
}

// Storage whose every method throws, as a quota or a blocked site does.
const throwingStorage: SessionStorageLike = { getItem: fail, removeItem: fail, setItem: fail };

describe("createSessionStore", () => {
  it("reads, writes and removes through the storage", () => {
    const entries = new Map<string, string>();
    const store = createSessionStore(() => mapStorage(entries));
    const written = store.write("key", "value");
    const read = store.read("key");
    store.remove("key");
    expect({ read, remaining: [...entries], unset: store.read("key"), written }).toEqual({
      read: "value",
      remaining: [],
      unset: null,
      written: true,
    });
  });

  it.each<[string, () => SessionStorageLike]>([
    ["a lookup that throws", fail],
    ["a missing storage", () => undefined as unknown as SessionStorageLike],
    ["storage methods that throw", () => throwingStorage],
  ])("plays on through %s", (_, lookup) => {
    const store = createSessionStore(lookup);
    expect({
      read: store.read("key"),
      remove: store.remove("key"),
      write: store.write("key", "value"),
    }).toEqual({ read: null, remove: undefined, write: false });
  });
});
