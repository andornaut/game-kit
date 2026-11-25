// Audit source imports, including erased type edges, from public runtime and build namespaces.
import { builtinModules } from "node:module";
import { posix } from "node:path";

import ts from "typescript";

export type SourceExports = Readonly<Record<string, string | Readonly<Record<string, string>>>>;

function targets(entry: string | Readonly<Record<string, string>>): string[] {
  return typeof entry === "string" ? [entry] : Object.values(entry);
}

// Paths and source text are supplied so fixtures use the real package's graph audit.
export function namespaceBoundaryErrors(context: {
  readonly exports: SourceExports;
  readonly readSource: (path: string) => string | undefined;
}): string[] {
  const clean = (path: string) => posix.normalize(path).replace(/^\.\//, "");
  const sourceModule = (path: string) => /^src\/.*\.(?:tsx?|css)$/.test(path);
  const entries = Object.entries(context.exports);
  const namespaceTargets = (namespace: string) =>
    new Set(
      entries
        .filter(([name]) => name.startsWith(`./${namespace}/`))
        .flatMap(([, entry]) => targets(entry).map(clean)),
    );
  const buildTargets = namespaceTargets("build");
  const testTargets = namespaceTargets("test");
  const runtime = entries.filter(([name]) => name.startsWith("./runtime/"));
  const errors = new Set<string>();
  const visited = new Set<string>();
  const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, "")));
  if (runtime.length === 0) {
    errors.add("No runtime exports declared");
  }

  const visit = (namespace: "runtime" | "build", input: string, chain: readonly string[]): void => {
    const path = clean(input);
    const trail = [...chain, path];
    const diagnostic = (reason: string) => errors.add(`${trail.join(" -> ")}: ${reason}`);
    if (!sourceModule(path)) {
      diagnostic("unresolved source module");
      return;
    }
    const isTest =
      testTargets.has(path) || /(^|\/)(testing|__tests__)(\/|$)|\.test\.[^.]+$/.test(path);
    const isBuild = buildTargets.has(path) || path.startsWith("src/build/");
    if (isTest || (namespace === "runtime" && isBuild)) {
      diagnostic(`${namespace} reaches ${namespace === "runtime" ? "build/test" : "test"} source`);
      return;
    }
    const identity = `${namespace}:${path}`;
    if (visited.has(identity)) {
      return;
    }
    visited.add(identity);
    const source = context.readSource(path);
    if (source === undefined) {
      diagnostic("unresolved source");
      return;
    }
    if (path.endsWith(".css")) {
      return;
    }
    const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.ES2022, true);
    const follow = (specifier: string): void => {
      if (namespace === "runtime" && (specifier.startsWith("node:") || builtins.has(specifier))) {
        diagnostic(`${specifier}: Node builtin`);
      } else if (specifier.startsWith(".")) {
        const relative = clean(posix.join(posix.dirname(path), specifier));
        const candidates = [
          relative,
          relative.replace(/\.js$/, ".ts"),
          `${relative}.ts`,
          `${relative}.d.ts`,
          `${relative}/index.ts`,
        ];
        const resolved = candidates.find(
          (candidate) => sourceModule(candidate) && context.readSource(candidate) !== undefined,
        );
        visit(namespace, resolved ?? relative, trail);
      } else if (specifier.startsWith("@andornaut/game-kit/")) {
        const name = `./${specifier.slice("@andornaut/game-kit/".length)}`;
        const entry = Object.hasOwn(context.exports, name) ? context.exports[name] : undefined;
        if (entry === undefined) {
          diagnostic(`${specifier}: unresolved export`);
        } else {
          for (const target of targets(entry)) {
            visit(namespace, target, trail);
          }
        }
      } else if (namespace === "runtime" && specifier !== "phaser") {
        diagnostic(`${specifier}: tooling or unsupported runtime dependency`);
      }
    };
    const literal = (node: ts.Node | undefined): void => {
      if (node !== undefined && ts.isStringLiteralLike(node)) {
        follow(node.text);
      } else {
        diagnostic("nonliteral module dependency cannot be resolved");
      }
    };
    const walk = (node: ts.Node): void => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
        literal(node.moduleSpecifier);
      } else if (ts.isImportTypeNode(node)) {
        literal(ts.isLiteralTypeNode(node.argument) ? node.argument.literal : undefined);
      } else if (ts.isExternalModuleReference(node)) {
        literal(node.expression);
      } else if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === "require"))
      ) {
        literal(node.arguments[0]);
      }
      ts.forEachChild(node, walk);
    };
    walk(parsed);
  };
  for (const namespace of ["runtime", "build"] as const) {
    for (const [name, entry] of entries.filter(([key]) => key.startsWith(`./${namespace}/`))) {
      for (const target of targets(entry)) {
        visit(namespace, target, [name]);
      }
    }
  }
  return [...errors].sort();
}
