import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

it.each([
  ["pure", ["document", "process", "Buffer"]],
  ["browser", ["process", "Buffer"]],
  ["worker", ["document", "process"]],
  ["phaser", ["process", "Buffer"]],
  ["node", ["document", "window"]],
] as const)(
  "rejects foreign ambient globals in the %s source environment",
  (environment, globals) => {
    const configPath = join(root, `tsconfig.${environment}.json`);
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
    const file = join(mkdtempSync(join(tmpdir(), "kit-environment-")), "foreign.ts");
    writeFileSync(file, `export {};\n${globals.map((name) => `${name};`).join("\n")}`);
    const program = ts.createProgram([...parsed.fileNames, file], parsed.options);
    const messages = ts
      .getPreEmitDiagnostics(program)
      .filter((diagnostic) => diagnostic.file?.fileName === file);
    for (const name of globals) {
      expect(
        messages.some((diagnostic) =>
          ts.flattenDiagnosticMessageText(diagnostic.messageText, " ").includes(`'${name}'`),
        ),
        name,
      ).toBe(true);
    }
  },
);

it("assigns every public TypeScript source module to an explicit environment", () => {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const declared = new Set(
    ["pure", "browser", "worker", "phaser", "node"].flatMap(
      (name) => JSON.parse(readFileSync(join(root, `tsconfig.${name}.json`), "utf8")).files,
    ),
  );
  for (const entry of Object.values(manifest.exports) as (string | { types: string })[]) {
    const target = typeof entry === "string" ? entry : entry.types;
    if (target.endsWith(".ts")) {
      expect(declared.has(target.replace(/^\.\//, "")), target).toBe(true);
    }
  }
});
