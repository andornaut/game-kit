import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createProgressState } from "@andornaut/game-kit/progressState";
import ts from "typescript";
import { expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

it("exposes the root source package through explicit existing module paths", () => {
  const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
    name: string;
    version: string;
    exports: Record<string, string | { types: string }>;
  };
  const lock = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"));
  expect([lock.version, lock.packages[""].version]).toEqual([manifest.version, manifest.version]);
  expect(manifest.name).toBe("@andornaut/game-kit");
  expect(existsSync(resolve(root, "kit/package.json"))).toBe(false);
  expect(Object.keys(manifest.exports)).not.toContain(".");
  for (const [name, target] of Object.entries(manifest.exports)) {
    expect(name).not.toContain("*");
    expect(name).not.toContain(".test");
    expect(name).not.toMatch(/^\.\/src\//);
    const path = typeof target === "string" ? target : target.types;
    expect(existsSync(resolve(root, path)), name).toBe(true);
    if (name !== "./package.json") {
      expect(path).toMatch(/^\.\/src\//);
    }
    if (typeof target !== "string") {
      expect(Object.keys(target)).toEqual(["types"]);
      expect(target.types).toMatch(/\.d\.ts$/);
    }
  }
  const declaration = ts.resolveModuleName(
    "@andornaut/game-kit/build/buildInfo",
    fileURLToPath(import.meta.url),
    { moduleResolution: ts.ModuleResolutionKind.Bundler },
    ts.sys,
  ).resolvedModule;
  expect(declaration?.resolvedFileName).toBe(resolve(root, "src/build/buildInfo.d.ts"));
  const state = createProgressState();
  const snapshots: unknown[] = [];
  const unsubscribe = state.subscribe((snapshot) => snapshots.push(snapshot));
  state.begin().progress(0.5);
  expect(snapshots.at(-1)).toEqual({ active: true, value: 0.5 });
  unsubscribe();
});
