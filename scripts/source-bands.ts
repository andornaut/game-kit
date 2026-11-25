// CLEANUP (added 2026-11-25): remove once the known-violations table is empty and ESLint guards the bands.
//
// The source-band migration check (game-coordinator gc-0029): places every shipped src/ module in
// a band and reports runtime import cycles, imports that do not point down the band table, imports
// into another area past its entry, shipped imports of scripts/ or tests/, and unplaced modules.
import { posix } from "node:path";

import ts from "typescript";

// Bands lowest first, each a list of layers lowest first. An area is a file (`rect.ts`), the
// files directly in a directory (`ui`) or a whole directory tree (`build/**`), relative to src/.
// A module imports only areas in its own layer or an earlier one, type-only imports included, and
// a directory area only through its index.ts. Runtime imports never form a cycle.
export type SourceBands = readonly (readonly [
  band: string,
  layers: readonly (readonly string[])[],
])[];

export const SOURCE_BANDS: SourceBands = [
  [
    "Foundation",
    [
      [
        "arrays.ts",
        "assertNever.ts",
        "lines.ts",
        "mapLimit.ts",
        "maps.ts",
        "numbers.ts",
        "opaqueBounds.ts",
        "records.ts",
        "rect.ts",
        "rgba.ts",
        "units.ts",
      ],
      ["random.ts"],
    ],
  ],
  ["Model", [["ai", "clock", "terrain"]]],
  ["Saving", [["save"], ["achievements.ts", "achievements", "web/save"]]],
  [
    "Presentation",
    [
      ["art", "input", "modalLayout.ts", "motion.ts", "progress.ts", "text", "view"],
      ["ui", "web/view"],
    ],
  ],
  [
    "Platform",
    [
      ["load", "progressState.ts", "web/buildLabel.ts", "web/crash", "web/pwa"],
      ["web/pwa/archive"],
    ],
  ],
  [
    "Engine and views",
    [
      [
        "clock/phaser",
        "input/phaser",
        "load/phaser",
        "progress/phaser",
        "text/phaser",
        "view/phaser",
        "web/input/dom",
        "web/save/dom",
        "web/view/dom",
      ],
      ["web/ui/dom", "web/view/phaser"],
      ["web/crash/dom", "web/progress/dom"],
      ["web/pwa/dom"],
    ],
  ],
  ["Support", [["build/**", "testing/**"]]],
];

interface Placement {
  readonly area: string;
  // The area's layer counted across every band, lowest first.
  readonly layer: number;
  readonly entry: string;
}

function contains(area: string, module: string): boolean {
  if (area.endsWith("/**")) {
    return module.startsWith(area.slice(0, -2));
  }
  return area.endsWith(".ts") ? module === area : posix.dirname(module) === area;
}

/** Every area of `bands` that holds `path`, a module path relative to the repository. */
function placements(bands: SourceBands, path: string): Placement[] {
  const module = path.slice("src/".length);
  let layer = 0;
  const found: Placement[] = [];
  for (const [, layers] of bands) {
    for (const areas of layers) {
      for (const area of areas) {
        if (contains(area, module)) {
          const directory = area.replace(/\/\*\*$/, "");
          const entry = area.endsWith(".ts") ? area : `${directory}/index.ts`;
          found.push({ area, entry: `src/${entry}`, layer });
        }
      }
      layer += 1;
    }
  }
  return found;
}

/** Each relative import of the module at `path`, resolved, and whether it loads at run time. */
export function importEdges(path: string, source: string): { target: string; runtime: boolean }[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.ES2022, false);
  return file.statements.flatMap((statement) => {
    if (
      !(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) ||
      statement.moduleSpecifier === undefined ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !statement.moduleSpecifier.text.startsWith(".")
    ) {
      return [];
    }
    const typeOnly = ts.isImportDeclaration(statement)
      ? statement.importClause?.isTypeOnly === true
      : statement.isTypeOnly;
    const target = posix.normalize(posix.join(posix.dirname(path), statement.moduleSpecifier.text));
    return [{ runtime: !typeOnly, target }];
  });
}

// Tarjan's strongly connected components; each component of two or more modules is a cycle.
function cycles(edges: ReadonlyMap<string, readonly string[]>): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const found: string[][] = [];
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
        found.push(component.sort());
      }
    }
  };
  for (const path of edges.keys()) {
    if (!index.has(path)) {
      visit(path);
    }
  }
  return found;
}

/** The problems among `paths`, sorted: modules in src/, scripts/ and tests/ read by `readSource`. */
export function sourceBandProblems(context: {
  readonly bands: SourceBands;
  readonly paths: readonly string[];
  readonly readSource: (path: string) => string;
}): string[] {
  const known = new Set(context.paths);
  const shipped = (path: string) => path.startsWith("src/") && !path.endsWith(".test.ts");
  const problems = new Set<string>();
  const placed = new Map<string, Placement>();
  for (const path of context.paths.filter(shipped)) {
    const found = placements(context.bands, path);
    if (found.length === 0) {
      problems.add(`unplaced: ${path}`);
    } else if (found.length > 1) {
      problems.add(`placed twice: ${path} in ${found.map(({ area }) => area).join(", ")}`);
    } else {
      placed.set(path, found[0]!);
    }
  }
  const runtime = new Map<string, string[]>();
  for (const path of context.paths) {
    const edges = importEdges(path, context.readSource(path)).filter(({ target }) =>
      known.has(target),
    );
    runtime.set(
      path,
      edges.filter((edge) => edge.runtime).map(({ target }) => target),
    );
    const from = placed.get(path);
    if (!shipped(path)) {
      continue;
    }
    for (const { target } of edges) {
      const to = placed.get(target);
      if (!target.startsWith("src/")) {
        problems.add(`support import: ${path} -> ${target}`);
      } else if (from === undefined || to === undefined || from.area === to.area) {
        continue;
      } else if (to.layer > from.layer) {
        problems.add(`upward import: ${path} -> ${target}`);
      } else if (target !== to.entry) {
        problems.add(`non-entry import: ${path} -> ${target}`);
      }
    }
  }
  for (const cycle of cycles(runtime)) {
    problems.add(`cycle: ${cycle.join(", ")}`);
  }
  return [...problems].sort();
}
