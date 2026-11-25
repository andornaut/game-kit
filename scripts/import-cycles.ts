// Find import cycles among TypeScript modules, counting type-only edges, which ESLint's no-cycle
// skips. A type cycle still couples two modules' interfaces, so neither can be read or moved alone.
import { posix } from "node:path";

import ts from "typescript";

/** Each cycle among `paths` as its modules in path order, with relative imports read by `readSource`. */
export function importCycles(
  readSource: (path: string) => string,
  paths: readonly string[],
): string[][] {
  const known = new Set(paths);
  const edges = new Map(
    paths.map((path) => [
      path,
      ts
        .preProcessFile(readSource(path), true, true)
        .importedFiles.map(({ fileName }) => fileName)
        .filter((specifier) => specifier.startsWith("."))
        .map((specifier) => posix.normalize(posix.join(posix.dirname(path), specifier)))
        .filter((target) => known.has(target)),
    ]),
  );
  // Tarjan's strongly connected components; each component of two or more modules is a cycle.
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cycles: string[][] = [];
  const visit = (path: string): void => {
    index.set(path, index.size);
    low.set(path, index.get(path)!);
    stack.push(path);
    onStack.add(path);
    for (const target of edges.get(path)!) {
      if (!index.has(target)) {
        visit(target);
        low.set(path, Math.min(low.get(path)!, low.get(target)!));
      } else if (onStack.has(target)) {
        low.set(path, Math.min(low.get(path)!, index.get(target)!));
      }
    }
    if (low.get(path) === index.get(path)) {
      const component: string[] = [];
      let member: string;
      do {
        member = stack.pop()!;
        onStack.delete(member);
        component.push(member);
      } while (member !== path);
      if (component.length > 1 || edges.get(path)!.includes(path)) {
        cycles.push(component.sort());
      }
    }
  };
  for (const path of paths) {
    if (!index.has(path)) {
      visit(path);
    }
  }
  return cycles;
}
