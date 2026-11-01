import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

import { createProgressState } from "@andornaut/game-kit/progressState";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

it("exposes the root source package through explicit existing module paths", () => {
  const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  expect(manifest.name).toBe("@andornaut/game-kit");
  expect(existsSync(resolve(root, "kit/package.json"))).toBe(false);
  expect(Object.keys(manifest.exports)).not.toContain(".");
  for (const [name, target] of Object.entries(manifest.exports)) {
    expect(name).not.toContain("*");
    expect(name).not.toContain(".test");
    expect(existsSync(resolve(root, target as string)), name).toBe(true);
  }
  const state = createProgressState();
  const snapshots: unknown[] = [];
  const unsubscribe = state.subscribe((snapshot) => snapshots.push(snapshot));
  state.begin().progress(0.5);
  expect(snapshots.at(-1)).toEqual({ active: true, value: 0.5 });
  unsubscribe();
});
