import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { expect, it } from "vitest";

import { ENVIRONMENTS } from "./typecheck.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

type Environment = (typeof ENVIRONMENTS)[number];

/** The compiler's messages for `source`, compiled in `environment` alongside its files. */
function diagnostics(environment: Environment, source: string): string[] {
  const configPath = join(root, `tsconfig.${environment}.json`);
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  // A virtual module inside the source tree, so bare imports resolve as the kit's own do.
  const file = join(root, "src/environment-probe.ts");
  const host = ts.createCompilerHost(parsed.options);
  const { fileExists, getSourceFile, readFile } = host;
  host.fileExists = (name) => name === file || fileExists(name);
  host.readFile = (name) => (name === file ? source : readFile(name));
  host.getSourceFile = (name, ...rest) =>
    name === file
      ? ts.createSourceFile(name, source, ts.ScriptTarget.ES2022, true)
      : getSourceFile(name, ...rest);
  const program = ts.createProgram([...parsed.fileNames, file], parsed.options, host);
  return ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.file?.fileName === file)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, " "));
}

function files(environment: Environment): string[] {
  return JSON.parse(readFileSync(join(root, `tsconfig.${environment}.json`), "utf8")).files;
}

it.each<[Environment, string[]]>([
  ["pure", ["document", "window", "process", "Buffer", "crypto", "TextEncoder"]],
  ["phaser", ["process", "Buffer"]],
  ["dom", ["process", "Buffer", "Phaser"]],
  ["vite", ["document", "window", "Phaser"]],
])("rejects foreign ambient globals in the %s source environment", (environment, globals) => {
  const source = `export {};\n${globals.map((name) => `${name};`).join("\n")}`;
  const messages = diagnostics(environment, source);
  for (const name of globals) {
    expect(
      messages.some((message) => message.includes(`'${name}'`)),
      name,
    ).toBe(true);
  }
});

it.each<[Environment, string]>([
  ["pure", "export const value = Math.max(1, 2);"],
  ["dom", "export const title: string = document.title;"],
  [
    "vite",
    'import type { Plugin } from "vite";\nexport const plugin: Plugin = { name: process.cwd() };',
  ],
])("accepts the globals and imports of the %s source environment", (environment, source) => {
  expect(diagnostics(environment, source)).toEqual([]);
});

// The directory segment that marks a module's environment; pure modules have none of them.
const MARKERS: Record<Environment, string | undefined> = {
  dom: "dom",
  phaser: "phaser",
  pure: undefined,
  vite: "vite",
};

it.each(ENVIRONMENTS)("places every %s source module in its environment's directory", (name) => {
  const marker = MARKERS[name];
  for (const file of files(name)) {
    const segments = file.split("/").slice(0, -1);
    const found = Object.values(MARKERS).filter(
      (candidate) => candidate !== undefined && segments.includes(candidate),
    );
    expect(found, file).toEqual(marker === undefined ? [] : [marker]);
  }
});

it("assigns every public TypeScript source module to exactly one explicit environment", () => {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const declared = ENVIRONMENTS.flatMap(files);
  expect(new Set(declared).size).toBe(declared.length);
  for (const entry of Object.values(manifest.exports) as (string | { types: string })[]) {
    const target = typeof entry === "string" ? entry : entry.types;
    if (target.endsWith(".ts")) {
      expect(declared, target).toContain(target.replace(/^\.\//, ""));
    }
  }
});
