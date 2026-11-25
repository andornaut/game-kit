import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import { importCycles } from "./import-cycles.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function cycles(sources: Readonly<Record<string, string>>): string[][] {
  return importCycles((path) => sources[path]!, Object.keys(sources));
}

it("finds a cycle formed only by type imports", () => {
  expect(
    cycles({
      "src/a.ts": 'import type { B } from "./b.ts"; export type A = B[];',
      "src/b.ts": 'import { type A } from "./a.ts"; export type B = A | 1;',
      "src/c.ts": 'import type { A } from "./a.ts";',
    }),
  ).toEqual([["src/a.ts", "src/b.ts"]]);
});

it("finds a cycle through re-exports and parent directories", () => {
  expect(
    cycles({
      "src/a/b.ts": 'export * from "../c.ts";',
      "src/c.ts": 'export { b } from "./a/b.ts";',
    }),
  ).toEqual([["src/a/b.ts", "src/c.ts"]]);
});

it("accepts an acyclic graph and ignores packages and unknown files", () => {
  expect(
    cycles({
      "src/a.ts": 'import { b } from "./b.ts"; import "phaser"; import "./missing.ts";',
      "src/b.ts": 'import type { Scene } from "phaser";',
    }),
  ).toEqual([]);
});

it("has no import cycles in the kit, its scripts or its browser checks", () => {
  const paths = ["src", "scripts", "tests/e2e"].flatMap((directory) =>
    readdirSync(join(root, directory), { recursive: true, encoding: "utf8" })
      .filter((name) => name.endsWith(".ts"))
      .map((name) => `${directory}/${name.replaceAll("\\", "/")}`),
  );
  expect(paths.length).toBeGreaterThan(100);
  expect(importCycles((path) => readFileSync(join(root, path), "utf8"), paths)).toEqual([]);
});
