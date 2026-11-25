// CLEANUP (added 2026-11-25): remove once the known-violations table is empty and ESLint guards the bands.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import { SOURCE_BANDS, sourceBandProblems, type SourceBands } from "./source-bands.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The violations the migration has yet to fix. Remove each entry as it is fixed: the tree must
// report exactly these, so the table only shrinks.
const KNOWN_VIOLATIONS: readonly string[] = [
  "unplaced: src/web/build/buildLabel.ts",
  "unplaced: src/web/build/buildVersion.ts",
  "unplaced: src/web/build/phaserBuild.ts",
  "unplaced: src/web/build/vite/buildInfo.d.ts",
  "unplaced: src/web/build/vite/contentHash.ts",
  "unplaced: src/web/build/vite/gameConfig.ts",
  "unplaced: src/web/build/vite/gitHead.ts",
  "unplaced: src/web/build/vite/phaserBuildPlugin.ts",
  "unplaced: src/web/build/vite/phaserSource.ts",
  "unplaced: src/web/build/vite/phaserUses.ts",
  "unplaced: src/web/headers/securityHeaders.ts",
  "unplaced: src/web/headers/vite/securityHeadersPlugin.ts",
  "unplaced: src/web/mapLimit.ts",
  "unplaced: src/web/pwa/vite/buildArchiveFiles.ts",
  "unplaced: src/web/pwa/vite/classicWorker.ts",
  "unplaced: src/web/pwa/vite/groupArchive.ts",
  "unplaced: src/web/pwa/vite/hashedIconsPlugin.ts",
  "unplaced: src/web/pwa/vite/originMemberPacks.ts",
  "unplaced: src/web/pwa/vite/precachePlugin.ts",
];

const BANDS: SourceBands = [
  ["Foundation", [["rect.ts"], ["random.ts"]]],
  ["Model", [["model", "rules"]]],
  ["Engine and views", [["view/dom"]]],
  ["Support", [["build/**"]]],
];

function problems(sources: Readonly<Record<string, string>>): string[] {
  return sourceBandProblems({
    bands: BANDS,
    paths: Object.keys(sources),
    readSource: (path) => sources[path]!,
  });
}

it("accepts downward and same-layer imports through entries, and any import from a test", () => {
  expect(
    problems({
      "src/build/vite/plugin.ts": 'import { a } from "../../model/index.ts";',
      "src/model/a.ts": 'import type { R } from "../rect.ts"; export const a = 1;',
      "src/model/a.test.ts": 'import "../view/dom/view.ts";',
      "src/model/index.ts": 'export { a } from "./a.ts"; export type { M } from "./m.ts";',
      "src/model/m.ts": 'import type { R } from "../rules/index.ts"; export type M = R[];',
      "src/rules/index.ts": 'import type { M } from "../model/index.ts"; export type R = M | 1;',
      "src/random.ts": 'import "./rect.ts";',
      "src/rect.ts": "export type R = 1;",
      "src/view/dom/view.ts": 'import { a } from "../../model/index.ts";',
    }),
  ).toEqual([]);
});

it("reports upward, non-entry and support imports and unplaced modules", () => {
  expect(
    problems({
      "src/model/a.ts": 'import type { V } from "../view/dom/view.ts";',
      "src/model/index.ts": "export {};",
      "src/rect.ts": 'import "./random.ts"; import "../scripts/tool.ts";',
      "src/random.ts": "export {};",
      "src/stray.ts": "export {};",
      "src/view/dom/view.ts": 'import "../../model/a.ts";',
      "scripts/tool.ts": "export {};",
    }),
  ).toEqual([
    "non-entry import: src/view/dom/view.ts -> src/model/a.ts",
    "support import: src/rect.ts -> scripts/tool.ts",
    "unplaced: src/stray.ts",
    "upward import: src/model/a.ts -> src/view/dom/view.ts",
    "upward import: src/rect.ts -> src/random.ts",
  ]);
});

it("reports runtime cycles but not type-only ones", () => {
  expect(
    problems({
      "src/model/a.ts": 'import { b } from "./b.ts"; export const a = 1;',
      "src/model/b.ts": 'import { a } from "./a.ts"; export const b = 1;',
      "src/model/c.ts": 'import type { D } from "./d.ts"; export type C = 1;',
      "src/model/d.ts": 'import type { C } from "./c.ts"; export type D = 1;',
      "scripts/x.ts": 'export * from "./y.ts";',
      "scripts/y.ts": 'export { x } from "./x.ts";',
    }),
  ).toEqual(["cycle: scripts/x.ts, scripts/y.ts", "cycle: src/model/a.ts, src/model/b.ts"]);
});

it("reports exactly the known violations in the kit, its scripts and its browser checks", () => {
  const paths = ["src", "scripts", "tests/e2e"].flatMap((directory) =>
    readdirSync(join(root, directory), { recursive: true, encoding: "utf8" })
      .filter((name) => name.endsWith(".ts"))
      .map((name) => `${directory}/${name.replaceAll("\\", "/")}`),
  );
  expect(paths.length).toBeGreaterThan(100);
  expect(
    sourceBandProblems({
      bands: SOURCE_BANDS,
      paths,
      readSource: (path) => readFileSync(join(root, path), "utf8"),
    }),
  ).toEqual(KNOWN_VIOLATIONS);
});
