// Checks a game against its build's Phaser (phaserBuild.ts): a test calls phaserBuildProblems with
// the game's PhaserBuild and its shipped modules, and expects []. Node only, for tests.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import ts from "typescript";

import {
  PHASER_ESM_FLAGS,
  type PhaserBuild,
  type PhaserExports,
  phaserExports,
  phaserFlags,
  phaserSourceDir,
} from "./phaserBuild";

// What a game's code may reach that the build's Phaser lacks, by how the code reaches it.
export interface LackingNames {
  // Game object factories and creators, reached as this.add.<name> and this.make.<name>.
  readonly factories: ReadonlySet<string>;
  // Game object classes, reached as GameObjects.<name>.
  readonly gameObjects: ReadonlySet<string>;
  // Values imported from "phaser": namespaces and constants.
  readonly imports: ReadonlySet<string>;
  // Loader file types, reached as load.<name>.
  readonly loaders: ReadonlySet<string>;
  // Scene plugins, reached on scene receivers or in a Phaser game config. `physics` is the
  // name a scene reaches its default physics system by.
  readonly plugins: ReadonlySet<string>;
  // Game systems, reached as <name> on this, a game, a scene or a scene's sys: this.sound,
  // game.sound.
  readonly systems: ReadonlySet<string>;
}

// What a feature flag set false takes from the build's Phaser beyond what its `typeof <FLAG>`
// blocks register (flagGatedNames): the constant that asks for the renderer it removes, and for
// FEATURE_SOUND the sound manager (game.sound, a scene's sound) and the loader file types that
// decode through it. A flag with no row removes nothing a game reaches.
export const FLAG_FEATURES: Readonly<
  Record<string, Pick<LackingNames, "imports" | "loaders" | "systems">>
> = {
  CANVAS_RENDERER: { imports: new Set(["CANVAS"]), loaders: new Set(), systems: new Set() },
  FEATURE_SOUND: {
    imports: new Set(),
    loaders: new Set(["audio", "audioSprite"]),
    systems: new Set(["sound"]),
  },
  WEBGL_RENDERER: { imports: new Set(["WEBGL"]), loaders: new Set(), systems: new Set() },
};

const FACTORY = /GameObject(?:Factory|Creator)\.register\('(\w+)'/g;
const PLUGIN = /PluginCache\.register\('\w+',\s*\w+,\s*'(\w+)'/g;
const GAME_OBJECT = /GameObjects\.(\w+) = require/g;
const REQUIRE = /require\('(\.[^']+)'\)/g;

// Phaser's source files under dir, a folder under phaser/src/.
function phaserFiles(sourceDir: string, dir: string): string[] {
  return (readdirSync(join(sourceDir, dir), { recursive: true }) as string[])
    .filter((path) => path.endsWith(".js"))
    .map((path) => join(sourceDir, dir, path));
}

function matches(pattern: RegExp, text: string): string[] {
  return [...text.matchAll(pattern)].map(([, name]) => name ?? "");
}

// The text of each block `if (typeof <flag>...) { ... }` opens in text.
export function flagBlocks(flag: string, text: string): string[] {
  return [...text.matchAll(new RegExp(`if \\(typeof ${flag}\\b[^)]*\\)\\s*\\{`, "g"))].map(
    (match) => {
      const open = (match.index ?? 0) + match[0].length;
      let depth = 1;
      let at = open;
      while (at < text.length && depth > 0) {
        depth += text[at] === "{" ? 1 : text[at] === "}" ? -1 : 0;
        at += 1;
      }
      return text.slice(open, at - 1);
    },
  );
}

// The factories and game object classes that Phaser's source registers only inside its
// `typeof <flag>` blocks, directly or in a module a block requires.
export function flagGatedNames(
  sourceDir: string,
  flag: string,
): Pick<LackingNames, "factories" | "gameObjects"> {
  const factories = new Set<string>();
  const gameObjects = new Set<string>();
  for (const file of phaserFiles(sourceDir, ".")) {
    for (const block of flagBlocks(flag, readFileSync(file, "utf8"))) {
      const required = matches(REQUIRE, block).map((module) => {
        const path = join(dirname(file), module);
        return path.endsWith(".js") ? path : `${path}.js`;
      });
      const texts = [
        block,
        ...required.filter(existsSync).map((path) => readFileSync(path, "utf8")),
      ];
      texts.flatMap((text) => matches(FACTORY, text)).forEach((name) => factories.add(name));
      matches(GAME_OBJECT, block).forEach((name) => gameObjects.add(name));
    }
  }
  return { factories, gameObjects };
}

// What the build's Phaser lacks: the omitted namespaces, what only their folders register, and
// what each feature flag the build sets false takes out (FLAG_FEATURES, flagGatedNames).
export function lackingNames(
  sourceDir: string,
  exports: PhaserExports,
  build: PhaserBuild,
): LackingNames {
  const folders = build.omitted.flatMap((name) => {
    const module = exports.namespaces.get(name) ?? "";
    return module.split("/").length === 2 ? [module] : [];
  });
  const texts = folders
    .flatMap((folder) => phaserFiles(sourceDir, folder))
    .map((file) => readFileSync(file, "utf8"));
  const offFlags = Object.entries(phaserFlags(build))
    .filter(([flag, on]) => !on && flag in FLAG_FEATURES)
    .map(([flag]) => flag);
  const gated = offFlags.map((flag) => flagGatedNames(sourceDir, flag));
  const features = offFlags.flatMap((flag) => FLAG_FEATURES[flag] ?? []);
  return {
    factories: new Set([
      ...texts.flatMap((text) => matches(FACTORY, text)),
      ...gated.flatMap(({ factories }) => [...factories]),
    ]),
    gameObjects: new Set(gated.flatMap(({ gameObjects }) => [...gameObjects])),
    imports: new Set([...build.omitted, ...features.flatMap(({ imports }) => [...imports])]),
    loaders: new Set(features.flatMap(({ loaders }) => [...loaders])),
    plugins: new Set(["physics", ...texts.flatMap((text) => matches(PLUGIN, text))]),
    systems: new Set(features.flatMap(({ systems }) => [...systems])),
  };
}

const SYSTEM_HOLDERS: ReadonlySet<string> = new Set(["game", "scene", "sys"]);

// Each use in a module's text of something names lacks, as the code reaches it: an import from
// "phaser" by its name ("*" for a default, namespace or dynamic import or a re-export, which the
// scan cannot follow), add.<factory> or make.<factory>, a plugin's name, a system's name,
// load.<file type> and GameObjects.<class>.
export function phaserUses(names: LackingNames, text: string): string[] {
  const source = ts.createSourceFile("module.ts", text, ts.ScriptTarget.Latest, true);
  const uses: string[] = [];
  const isPhaser = (node: ts.Node | undefined) =>
    node !== undefined && ts.isStringLiteral(node) && node.text === "phaser";
  // The name an expression ends in: an identifier's, or a property access's last name.
  const nameOf = (node: ts.Expression) =>
    ts.isIdentifier(node) ? node.text : ts.isPropertyAccessExpression(node) ? node.name.text : "";
  const named = (node: ts.Expression, wanted: ReadonlySet<string>) => wanted.has(nameOf(node));
  // Bounded local receiver recognition, without resolving the game's imports or dependencies.
  const sceneTypes = new Set(["Scene"]);
  const gameTypes = new Set(["Game"]);
  const sceneReceivers = new Set(["scene", "sys"]);
  const classes: ts.ClassLikeDeclaration[] = [];
  const declarations: (
    ts.ParameterDeclaration | ts.VariableDeclaration | ts.PropertyDeclaration
  )[] = [];
  const collect = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && isPhaser(node.moduleSpecifier)) {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          const name = (element.propertyName ?? element.name).text;
          if (name === "Scene") {
            sceneTypes.add(element.name.text);
          }
          if (name === "Game") {
            gameTypes.add(element.name.text);
          }
        }
      }
    }
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      classes.push(node);
    }
    if (ts.isParameter(node) || ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) {
      declarations.push(node);
    }
    ts.forEachChild(node, collect);
  };
  collect(source);
  const extendsScene = (node: ts.ClassLikeDeclaration) =>
    node.heritageClauses?.some(
      (clause) =>
        clause.token === ts.SyntaxKind.ExtendsKeyword &&
        clause.types.some(({ expression }) => named(expression, sceneTypes)),
    ) ?? false;
  for (let pass = 0; pass < classes.length; pass++) {
    for (const node of classes) {
      if (node.name && extendsScene(node)) {
        sceneTypes.add(node.name.text);
      }
    }
  }
  const typeName = (node: ts.TypeNode | undefined): string =>
    node && ts.isTypeReferenceNode(node)
      ? ts.isIdentifier(node.typeName)
        ? node.typeName.text
        : node.typeName.right.text
      : "";
  for (const node of declarations) {
    if (ts.isIdentifier(node.name) && sceneTypes.has(typeName(node.type))) {
      sceneReceivers.add(node.name.text);
    }
  }
  const sceneHolder = (node: ts.Expression): boolean => {
    if (ts.isParenthesizedExpression(node)) {
      return sceneHolder(node.expression);
    }
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
      return sceneTypes.has(typeName(node.type));
    }
    if (node.kind === ts.SyntaxKind.ThisKeyword) {
      for (let parent: ts.Node | undefined = node.parent; parent; parent = parent.parent) {
        if (ts.isClassDeclaration(parent) || ts.isClassExpression(parent)) {
          return extendsScene(parent);
        }
      }
      return true;
    }
    return named(node, sceneReceivers);
  };
  const gameConfigs = new Set<string>();
  const collectConfigs = (node: ts.Node): void => {
    if (ts.isNewExpression(node) && named(node.expression, gameTypes)) {
      for (const argument of node.arguments ?? []) {
        if (ts.isIdentifier(argument)) {
          gameConfigs.add(argument.text);
        }
      }
    }
    ts.forEachChild(node, collectConfigs);
  };
  collectConfigs(source);
  const gameConfig = (object: ts.ObjectLiteralExpression): boolean => {
    let node: ts.Node = object;
    while (node.parent) {
      const parent = node.parent;
      if (ts.isParenthesizedExpression(parent)) {
        node = parent;
      } else if (ts.isAsExpression(parent) || ts.isSatisfiesExpression(parent)) {
        if (typeName(parent.type) === "GameConfig") {
          return true;
        }
        node = parent;
      } else {
        return (
          (ts.isNewExpression(parent) && named(parent.expression, gameTypes)) ||
          ((ts.isVariableDeclaration(parent) || ts.isPropertyDeclaration(parent)) &&
            (typeName(parent.type) === "GameConfig" ||
              (ts.isIdentifier(parent.name) && gameConfigs.has(parent.name.text))))
        );
      }
    }
    return false;
  };
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
            const name = (element.propertyName ?? element.name).text;
            if (names.imports.has(name)) {
              uses.push(name);
            }
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
    } else if (ts.isPropertyAccessExpression(node)) {
      const name = node.name.text;
      const holder = node.expression;
      if (names.factories.has(name) && named(holder, new Set(["add", "make"]))) {
        uses.push(`${nameOf(holder)}.${name}`);
      } else if (names.loaders.has(name) && named(holder, new Set(["load"]))) {
        uses.push(`load.${name}`);
      } else if (names.gameObjects.has(name) && named(holder, new Set(["GameObjects"]))) {
        uses.push(`GameObjects.${name}`);
      } else if (
        names.systems.has(name) &&
        (holder.kind === ts.SyntaxKind.ThisKeyword || named(holder, SYSTEM_HOLDERS))
      ) {
        uses.push(name);
      } else if (names.plugins.has(name) && sceneHolder(holder)) {
        uses.push(name);
      }
    } else if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      names.plugins.has(node.name.text) &&
      ts.isObjectLiteralExpression(node.parent) &&
      gameConfig(node.parent)
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
  const names = lackingNames(sourceDir, exports, build);
  return [
    ...build.omitted
      .filter((name) => !exports.namespaces.has(name))
      .map((name) => `Phaser exports no namespace ${name}`),
    ...Object.keys(build.flags)
      .filter((flag) => !(flag in PHASER_ESM_FLAGS))
      .map((flag) => `Phaser has no feature flag ${flag}`),
    ...files.flatMap((file) =>
      phaserUses(names, readFileSync(file, "utf8")).map((use) => `${relative(root, file)}: ${use}`),
    ),
  ];
}
