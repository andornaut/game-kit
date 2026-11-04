import { afterEach, expect, it, vi } from "vitest";

import { sessionRead, sessionRemove, sessionWrite } from "./pageSessionStore.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("reads, writes and removes the page's sessionStorage, looked up on each call", () => {
  const entries = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => entries.get(key) ?? null,
    removeItem: (key: string) => entries.delete(key),
    setItem: (key: string, value: string) => entries.set(key, value),
  });
  const written = sessionWrite("key", "value");
  const read = sessionRead("key");
  sessionRemove("key");
  expect({ read, unset: sessionRead("key"), written }).toEqual({
    read: "value",
    unset: null,
    written: true,
  });
});

it("plays on without sessionStorage", () => {
  vi.stubGlobal("sessionStorage", undefined);
  expect({
    read: sessionRead("key"),
    remove: sessionRemove("key"),
    write: sessionWrite("key", "value"),
  }).toEqual({ read: null, remove: undefined, write: false });
});
