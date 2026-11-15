import { expect, it } from "vitest";

import { namespaceBoundaryErrors, type SourceExports } from "./namespace-boundary.ts";

function audit(source: Readonly<Record<string, string>>, extra: SourceExports = {}) {
  return namespaceBoundaryErrors({
    exports: { "./runtime/entry": "./src/entry.ts", ...extra },
    readSource: (path) => source[path],
  });
}

it("allows a shared runtime graph and Phaser types while ignoring generated import strings", () => {
  expect(
    audit(
      {
        "src/entry.ts":
          'export * from "./shared.ts";' +
          'import type { Scene } from "phaser"; export const example = \'import("vite")\';',
        "src/shared.ts": "export type Value = { x: number };",
        "src/tool.ts": "export const buildOnly = 1;",
      },
      { "./build/tool": "./src/tool.ts" },
    ),
  ).toEqual([]);
});

it.each([
  [
    'import type { Value } from "./edge.ts";',
    'export type Value = import("node:fs").PathLike;',
    "Node builtin",
  ],
  [
    'export { value } from "./edge.ts";',
    'import "fs/promises"; export const value = 1;',
    "Node builtin",
  ],
  ['export * from "./edge.ts";', 'export * from "typescript";', "tooling"],
  ['void import("./edge.js");', 'import type { Plugin } from "vite";', "tooling"],
  ['import value = require("./edge.ts");', 'import "vitest/config";', "tooling"],
])("follows transitive import syntax %s", (entry, edge, reason) => {
  const result = audit({ "src/entry.ts": entry, "src/edge.ts": edge });
  expect(result).toHaveLength(1);
  expect(result[0]).toContain("src/entry.ts -> src/edge.ts");
  expect(result[0]).toContain(reason);
});

it.each(["build", "test"])("rejects a pure source target owned by %s", (namespace) => {
  expect(
    audit(
      {
        "src/entry.ts": 'export type { Value } from "./tool.ts";',
        "src/tool.ts": "export type Value = number;",
      },
      { [`./${namespace}/tool`]: "./src/tool.ts" },
    )[0],
  ).toContain("runtime reaches build/test source");
});

it("rejects private test helpers, unresolved sources and nonliteral dynamic imports", () => {
  expect(audit({ "src/entry.ts": 'export * from "./testing/private.ts";' })[0]).toContain(
    "runtime reaches build/test source",
  );
  expect(audit({ "src/entry.ts": 'export * from "./missing.ts";' })[0]).toContain(
    "unresolved source",
  );
  expect(audit({ "src/entry.ts": "declare const name: string; void import(name);" })[0]).toContain(
    "nonliteral module dependency",
  );
});

it("follows self-package exports, handles cycles and audits every conditional target", () => {
  expect(
    audit(
      {
        "src/entry.ts": 'export * from "@andornaut/game-kit/runtime/shared";',
        "src/shared.ts": 'export * from "./entry.ts";',
        "src/shared.d.ts": 'export type Value = import("node:fs").PathLike;',
      },
      { "./runtime/shared": { import: "./src/shared.ts", types: "./src/shared.d.ts" } },
    )[0],
  ).toContain("Node builtin");
});

it("classifies private build helpers while retaining the runtime build label exception", () => {
  expect(
    audit({
      "src/entry.ts": 'export * from "./web/build/buildLabel.ts";',
      "src/web/build/buildLabel.ts": 'export const label = "v1";',
    }),
  ).toEqual([]);
  expect(
    audit({
      "src/entry.ts": 'export * from "./web/build/mapLimit.ts";',
      "src/web/build/mapLimit.ts": "export const mapLimit = () => [];",
    })[0],
  ).toContain("runtime reaches build/test source");
});

it("permits build to use runtime but rejects its transitive private test helpers", () => {
  const graph = {
    "src/entry.ts": "export const value = 1;",
    "src/tool.ts": 'import "node:fs"; export { value } from "./entry.ts";',
  };
  const exports = { "./build/tool": "./src/tool.ts" };
  expect(audit(graph, exports)).toEqual([]);
  expect(
    audit({ ...graph, "src/entry.ts": 'export * from "./testing/private.ts";' }, exports).some(
      (error) =>
        error.includes("./build/tool -> src/tool.ts -> src/entry.ts -> src/testing/private.ts") &&
        error.endsWith("build reaches test source"),
    ),
  ).toBe(true);
});
