import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

it.each([
  {
    cycle: true,
    label: "reports a runtime dependency cycle",
    a: 'import { b } from "./b.ts"; export const a = () => b();',
    b: 'import { a } from "./a.ts"; export const b = () => a();',
  },
  {
    cycle: true,
    label: "reports a runtime dependency cycle named by .js specifiers",
    a: 'import { b } from "./b.js"; export const a = () => b();',
    b: 'import { a } from "./a.js"; export const b = () => a();',
  },
  {
    cycle: false,
    label: "accepts an acyclic runtime dependency",
    a: 'import { b } from "./b.ts"; export const a = () => b();',
    b: "export const b = () => 1;",
  },
  {
    cycle: false,
    label: "accepts a type-only dependency cycle",
    a: 'import type { B } from "./b.ts"; export interface A { b: B }',
    b: 'import type { A } from "./a.ts"; export interface B { a: A }',
  },
])("$label with the installed selective rule and actual config", async ({ a, b, cycle }) => {
  const cwd = mkdtempSync(join(tmpdir(), "kit-lint-security-"));
  mkdirSync(join(cwd, "src"));
  writeFileSync(join(cwd, "src/a.ts"), a);
  writeFileSync(join(cwd, "src/b.ts"), b);
  const eslint = new ESLint({ cwd, overrideConfigFile: join(root, "eslint.config.mjs") });
  const results = await eslint.lintFiles(["src/a.ts", "src/b.ts"]);
  const cycles = results.flatMap(({ messages }) =>
    messages.filter(({ ruleId }) => ruleId === "import-x/no-cycle"),
  );
  expect(results.some(({ messages }) => messages.some(({ fatal }) => fatal))).toBe(false);
  expect(cycles.length > 0).toBe(cycle);
});

it.each([
  {
    banned: false,
    file: "src/web/ui/dom/controls/probe.ts",
    source: 'import "../../../../ui/layout/slider.ts";',
  },
  { banned: false, file: "src/ui/layout/probe.ts", source: 'import "./slider.ts";' },
  { banned: true, file: "src/rect.ts", source: 'import "./web/pwa/index.ts";' },
  {
    banned: false,
    file: "src/text/probe.ts",
    source: 'import type { V } from "../view/index.ts";',
  },
  { banned: false, file: "src/numbers.ts", source: 'import "./rect.ts";' },
  {
    banned: true,
    file: "src/text/probe.ts",
    source: 'import type { P } from "../web/pwa/index.ts";',
  },
  { banned: true, file: "src/text/probe.ts", source: 'import "../view/pagePoint.ts";' },
  {
    banned: true,
    file: "src/web/ui/dom/dialogs/probe.ts",
    source: 'import "../controls/placedRows.ts";',
  },
  {
    banned: true,
    file: "src/ui/actions/probe.ts",
    source: 'import type { SliderLayout } from "../layout/slider.ts";',
  },
  {
    banned: false,
    file: "src/web/pwa/dom/launch/probe.ts",
    source: 'import "../routing/buildArchiveRouter.ts";',
  },
  {
    banned: true,
    file: "src/web/pwa/dom/launch/probe.ts",
    source: 'import "../routing/serviceWorker.ts";',
  },
  {
    banned: true,
    file: "src/web/pwa/dom/routing/probe.ts",
    source: 'import "../launch/launch.ts";',
  },
  { banned: true, file: "src/numbers.ts", source: 'import "./random.ts";' },
  { banned: true, file: "src/rect.ts", source: 'import "../scripts/runtime.ts";' },
])("guards the source bands: $file, $source", async ({ banned, file, source }) => {
  const eslint = new ESLint({ cwd: root });
  const [result] = await eslint.lintText(source, { filePath: join(root, file) });
  const zones = result!.messages.filter(({ ruleId }) => ruleId === "import-x/no-restricted-paths");
  expect(result!.messages.some(({ fatal }) => fatal)).toBe(false);
  expect(zones.length > 0).toBe(banned);
});

it.each([
  { banned: true, source: 'import { type Rect } from "./rect.ts";' },
  { banned: false, source: 'import type { Rect } from "./rect.ts";' },
  { banned: false, source: 'import { type Rect, rectsOverlap } from "./rect.ts";' },
])(
  "refuses an import whose specifiers are all inline types: $source",
  async ({ banned, source }) => {
    const eslint = new ESLint({ cwd: root });
    const [result] = await eslint.lintText(source, { filePath: join(root, "src/probe.ts") });
    const rule = "@typescript-eslint/no-import-type-side-effects";
    expect(result!.messages.some(({ fatal }) => fatal)).toBe(false);
    expect(result!.messages.some(({ ruleId }) => ruleId === rule)).toBe(banned);
  },
);
