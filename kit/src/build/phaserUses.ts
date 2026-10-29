// Checks a game against its build's Phaser (phaserBuild.ts): a test calls phaserBuildProblems with
// the game's PhaserBuild and its shipped modules, and expects []. Node only, for tests.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import ts from "typescript";

import {
  PHASER_ESM_FLAGS,
  type PhaserBuild,
  type PhaserExports,
  phaserExports,
  phaserSourceDir,
} from "./phaserBuild";

// What only the omitted namespaces' folders register: game object factories and creators,
// which a scene reaches as this.add.<name> and this.make.<name>, and scene plugins, reached as
// this.<name>. `physics` is the name a scene reaches its default physics system by.
export interface SceneNames {
  factories: ReadonlySet<string>;
  plugins: ReadonlySet<string>;
}

// Phaser's source files under dir, a folder under phaser/src/.
function phaserFiles(sourceDir: string, dir: string): string[] {
  return (readdirSync(join(sourceDir, dir), { recursive: true }) as string[])
    .filter((path) => path.endsWith(".js"))
    .map((path) => join(sourceDir, dir, path));
}

// The factories, creators and scene plugins that only omitted's folders register.
export function omittedSceneNames(
  sourceDir: string,
  exports: PhaserExports,
  omitted: readonly string[],
): SceneNames {
  const factory = /GameObject(?:Factory|Creator)\.register\('(\w+)'/g;
  const plugin = /PluginCache\.register\('\w+',\s*\w+,\s*'(\w+)'/g;
  const folders = omitted.flatMap((name) => {
    const module = exports.namespaces.get(name) ?? "";
    return module.split("/").length === 2 ? [module] : [];
  });
  const texts = folders
    .flatMap((folder) => phaserFiles(sourceDir, folder))
    .map((file) => readFileSync(file, "utf8"));
  const names = (pattern: RegExp) =>
    texts.flatMap((text) => [...text.matchAll(pattern)].map(([, name]) => name ?? ""));
  return {
    factories: new Set(names(factory)),
    plugins: new Set(["physics", ...names(plugin)]),
  };
}

// What a module's text uses of Phaser that the build's Phaser may lack: each value it imports
// from "phaser" ("*" for a default, namespace or dynamic import, which the scan cannot follow)
// and each of names it reaches: a factory through add or make, or a plugin by any property.
export function phaserUses(names: SceneNames, text: string): string[] {
  const source = ts.createSourceFile("module.ts", text, ts.ScriptTarget.Latest, true);
  const uses: string[] = [];
  const isPhaser = (node: ts.Node | undefined) =>
    node !== undefined && ts.isStringLiteral(node) && node.text === "phaser";
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && isPhaser(node.moduleSpecifier)) {
      const clause = node.importClause;
      if (clause !== undefined && !clause.isTypeOnly) {
        const bindings = clause.namedBindings;
        if (clause.name !== undefined || (bindings && ts.isNamespaceImport(bindings))) {
          uses.push("*");
        }
        if (bindings && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements.filter(({ isTypeOnly }) => !isTypeOnly)) {
            uses.push((element.propertyName ?? element.name).text);
          }
        }
      }
    } else if (ts.isExportDeclaration(node) && isPhaser(node.moduleSpecifier)) {
      uses.push("*");
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      isPhaser(node.arguments[0])
    ) {
      uses.push("*");
    } else if (
      ts.isPropertyAccessExpression(node) &&
      names.factories.has(node.name.text) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ["add", "make"].includes(node.expression.name.text)
    ) {
      uses.push(node.name.text);
    } else if (
      (ts.isPropertyAccessExpression(node) || ts.isPropertyAssignment(node)) &&
      ts.isIdentifier(node.name) &&
      names.plugins.has(node.name.text)
    ) {
      uses.push(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return uses;
}

// Every TypeScript module under each of dirs (relative to root) but the tests: what a game ships.
export function shippedModules(root: string, dirs: readonly string[]): string[] {
  return dirs.flatMap((dir) =>
    (readdirSync(join(root, dir), { recursive: true }) as string[])
      .filter((path) => path.endsWith(".ts") && !path.endsWith(".test.ts"))
      .map((path) => join(root, dir, path)),
  );
}

// What is wrong with build for a game whose shipped modules are files (absolute paths, reported
// relative to root): an omitted namespace or a flag Phaser does not have, and each use of
// something the build leaves out, as "<file>: <use>". [] when the build serves the game.
export function phaserBuildProblems(
  build: PhaserBuild,
  root: string,
  files: readonly string[],
): string[] {
  const sourceDir = phaserSourceDir();
  const exports = phaserExports(readFileSync(join(sourceDir, "phaser-esm.js"), "utf8"));
  const names = omittedSceneNames(sourceDir, exports, build.omitted);
  const lacking = new Set([...build.omitted, ...names.factories, ...names.plugins, "*"]);
  return [
    ...build.omitted
      .filter((name) => !exports.namespaces.has(name))
      .map((name) => `Phaser exports no namespace ${name}`),
    ...Object.keys(build.flags)
      .filter((flag) => !(flag in PHASER_ESM_FLAGS))
      .map((flag) => `Phaser has no feature flag ${flag}`),
    ...files.flatMap((file) =>
      phaserUses(names, readFileSync(file, "utf8"))
        .filter((use) => lacking.has(use))
        .map((use) => `${relative(root, file)}: ${use}`),
    ),
  ];
}
