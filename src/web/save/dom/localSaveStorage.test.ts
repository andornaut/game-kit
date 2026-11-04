import { afterEach, expect, it, vi } from "vitest";

import { localSaveStorage } from "./localSaveStorage.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("reads and writes the page's localStorage, looked up on each call", async () => {
  const storage = localSaveStorage();
  const entries = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
  });
  await storage.write("key", "value");
  await expect(storage.read("key")).resolves.toBe("value");
});

it.each(["read", "write"] as const)("rejects a %s without localStorage", async (operation) => {
  vi.stubGlobal("localStorage", undefined);
  const storage = localSaveStorage();
  const result = operation === "read" ? storage.read("key") : storage.write("key", "value");
  await expect(result).rejects.toThrow(TypeError);
});
