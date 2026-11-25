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
  { banned: false, file: "src/web/ui/dom/probe.ts", source: 'import "../../../ui/index.ts";' },
  { banned: false, file: "src/ui/probe.ts", source: 'import "./slider.ts";' },
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
  { banned: true, file: "src/web/ui/dom/probe.ts", source: 'import "../../../ui/slider.ts";' },
  { banned: true, file: "src/numbers.ts", source: 'import "./random.ts";' },
  { banned: true, file: "src/rect.ts", source: 'import "../scripts/runtime.ts";' },
])("guards the source bands: $file, $source", async ({ banned, file, source }) => {
  const eslint = new ESLint({ cwd: root });
  const [result] = await eslint.lintText(source, { filePath: join(root, file) });
  const zones = result!.messages.filter(({ ruleId }) => ruleId === "import-x/no-restricted-paths");
  expect(result!.messages.some(({ fatal }) => fatal)).toBe(false);
  expect(zones.length > 0).toBe(banned);
});
