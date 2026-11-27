import { readdirSync } from "node:fs";
import { posix } from "node:path";

import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import { createNodeResolver } from "eslint-plugin-import-x/node-resolver";
import noCycle from "eslint-plugin-import-x/rules/no-cycle";
import noRestrictedPaths from "eslint-plugin-import-x/rules/no-restricted-paths";
import globals from "globals";
import ts from "typescript-eslint";

import { plugins, sourceRules, toolingRules } from "./eslint.config.base.mjs";

const KIT_FILES = ["src/**/*.ts"];
const TEST_FILES = ["src/**/*.test.ts", "scripts/**/*.test.ts"];
const TOOLING_FILES = ["*.ts", "*.js", "*.mjs", "scripts/**/*.ts", "tests/**/*.ts"];
// Each environment directory: phaser/ (Phaser and the browser), dom/ (the browser without
// Phaser) and vite/ (Node and Vite at build time). Everything else is pure.
const PHASER_FILES = ["src/**/phaser/**"];
const DOM_FILES = ["src/**/dom/**"];
const VITE_FILES = ["src/**/vite/**"];

// Source modules import their own modules by relative path and never import a game.
const OUTSIDE_KIT = {
  group: ["@andornaut/game-kit", "@andornaut/game-kit/*", "**/src", "**/src/*"],
  message: "src/ imports nothing from a game, and its own modules by relative path.",
};

// Pure code runs in unit tests without a renderer: only phaser/ folders import Phaser or a
// phaser/ folder.
const PHASER = {
  group: ["**/phaser", "**/phaser/*"],
  message: "Only phaser/ folders may import Phaser or a phaser/ folder.",
};

const DOM = {
  group: ["**/dom", "**/dom/*"],
  message: "Only dom/ and phaser/ folders may import a dom/ folder.",
};

// Vite runs only at build time, so no runtime module may load it. The type environments reject
// Node imports outside vite/.
const VITE = {
  group: ["**/vite", "**/vite/*"],
  message: "Only vite/ folders may import Vite or a vite/ folder.",
};

// The source bands (docs/design/packaging.md), lowest first, each a list of layers lowest first.
// An area is a file (`rect.ts`), the files directly in a directory (`ui`) or a whole tree
// (`build/**`), relative to src/.
const SOURCE_BANDS = [
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
      ["ui/actions"],
      ["ui/layout"],
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
      ["web/ui/dom", "web/view/phaser", "web/pwa/dom", "web/pwa/dom/storage"],
      ["web/ui/dom/controls", "web/ui/dom/layout", "web/pwa/dom/transfer"],
      ["web/ui/dom/dialogs", "web/pwa/dom/routing"],
      ["web/crash/dom", "web/progress/dom"],
      ["web/pwa/dom/launch"],
    ],
  ],
  ["Support", [["build/**", "testing/**"]]],
];

const LAYERS = SOURCE_BANDS.flatMap(([, layers]) => layers);
const isFile = (area) => area.endsWith(".ts");
const isTree = (area) => area.endsWith("/**");
const areaGlob = (area) => (isFile(area) || isTree(area) ? `src/${area}` : `src/${area}/*.ts`);

// Grouped areas name the modules that other areas can import directly. Other directory
// areas retain their existing index.ts boundary.
const DIRECT_MODULES = {
  ui: ["controlPresentation", "focusKeys", "projection", "uiTheme"],
  "ui/actions": ["actionGroup", "buttonLayout", "hitAreas", "hudDisc", "pager"],
  "ui/layout": ["formRow", "layoutTree", "modalFrame", "slider"],
  "web/ui/dom": [
    "domPress",
    "focusModality",
    "foregroundInput",
    "layoutProperties",
    "nativeButton",
    "refusalCue",
    "sheetFrames",
    "viewUnits",
  ],
  "web/ui/dom/controls": ["actionGroup"],
  "web/ui/dom/dialogs": [],
  "web/ui/dom/layout": [],
  "web/pwa/dom": ["visibility"],
  "web/pwa/dom/storage": ["buildArchiveStore", "buildGroupStore", "buildStore"],
  "web/pwa/dom/transfer": [
    "buildArchiveDownload",
    "buildInstaller",
    "sha256",
    "verifiedJsonSource",
  ],
  "web/pwa/dom/routing": ["buildArchiveRouter"],
  "web/pwa/dom/launch": [],
};

function privateModules(area) {
  const exposed = DIRECT_MODULES[area] ?? ["index"];
  return exposed.length === 0 ? areaGlob(area) : `src/${area}/!(${exposed.join("|")}).ts`;
}

function holds(area, module) {
  if (isTree(area)) {
    return module.startsWith(area.slice(0, -2));
  }
  return isFile(area) ? module === area : posix.dirname(module) === area;
}

// Every shipped module is in exactly one area, so none escapes the zones below.
const misplaced = readdirSync(new URL("src", import.meta.url), {
  encoding: "utf8",
  recursive: true,
})
  .map((name) => name.replaceAll("\\", "/"))
  .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
  .filter((name) => LAYERS.flat().filter((area) => holds(area, name)).length !== 1);
if (misplaced.length > 0) {
  throw new Error(`Place each src/ module in one SOURCE_BANDS area: ${misplaced.join(", ")}`);
}

const BAND_MESSAGE =
  "src/ imports its own layer or a lower one in the source bands (docs/design/packaging.md), " +
  "another directory area only through its exposed modules, and never scripts/ or tests/.";

// What each area may not import, type-only imports and re-exports included: a later layer, a
// private module of another directory area in its own or an earlier layer, and
// scripts/ and tests/. A zone takes either globs or plain paths, so the file areas of later layers
// get a zone of their own.
const BAND_ZONES = LAYERS.flatMap((areas, layer) =>
  areas.flatMap((area) => {
    const target = areaGlob(area);
    const later = LAYERS.slice(layer + 1).flat();
    const globs = [
      ...later.filter((other) => !isFile(other)).map(areaGlob),
      ...LAYERS.slice(0, layer + 1)
        .flat()
        .filter((other) => other !== area && !isFile(other) && !isTree(other))
        .map(privateModules),
      "scripts/**",
      "tests/**",
    ];
    const files = later.filter(isFile).map(areaGlob);
    return [
      { from: globs, message: BAND_MESSAGE, target },
      ...(files.length > 0 ? [{ from: files, message: BAND_MESSAGE, target }] : []),
    ];
  }),
);

const IMPORT_X = {
  plugins: {
    "import-x": { rules: { "no-cycle": noCycle, "no-restricted-paths": noRestrictedPaths } },
  },
  settings: {
    "import-x/extensions": [".ts"],
    // A .js specifier names its .ts source, as TypeScript emits it, so it resolves either way.
    "import-x/resolver-next": [
      createNodeResolver({ extensionAlias: { ".js": [".ts", ".js"] }, extensions: [".ts", ".js"] }),
    ],
  },
};

export default defineConfig(
  {
    ignores: [".claude/", ".worktrees/", "dist/", "node_modules/"],
  },
  js.configs.recommended,
  ts.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    files: KIT_FILES,
    plugins,
    rules: {
      ...sourceRules,
      "no-restricted-syntax": ["error", "WithStatement", "ImportExpression"],
    },
  },
  // A later no-restricted-imports replaces an earlier one, so each file gets one list.
  {
    files: KIT_FILES,
    ignores: [...PHASER_FILES, ...DOM_FILES, ...VITE_FILES],
    rules: { "no-restricted-imports": ["error", { patterns: [OUTSIDE_KIT, PHASER, DOM, VITE] }] },
  },
  {
    files: PHASER_FILES,
    rules: { "no-restricted-imports": ["error", { patterns: [OUTSIDE_KIT, VITE] }] },
  },
  {
    files: DOM_FILES,
    rules: { "no-restricted-imports": ["error", { patterns: [OUTSIDE_KIT, PHASER, VITE] }] },
  },
  {
    files: VITE_FILES,
    rules: { "no-restricted-imports": ["error", { patterns: [OUTSIDE_KIT, PHASER, DOM] }] },
  },
  // The source bands; tests may import any module.
  {
    ...IMPORT_X,
    files: KIT_FILES,
    ignores: TEST_FILES,
    rules: {
      "import-x/no-restricted-paths": [
        "error",
        { basePath: import.meta.dirname, zones: BAND_ZONES },
      ],
    },
  },
  // No import cycles: a module in a cycle can run before what it imports has loaded. `import type`
  // is erased at build time, so it never forms one. Under verbatimModuleSyntax an import whose
  // specifiers are all inline types still loads its module, and no-cycle does not see that edge,
  // so such imports must be written as `import type`.
  {
    ...IMPORT_X,
    files: [...KIT_FILES, ...TOOLING_FILES],
    rules: {
      "@typescript-eslint/no-import-type-side-effects": "error",
      "import-x/no-cycle": "error",
    },
  },
  // Tests and tooling: they verify or produce what ships rather than being it.
  {
    files: [...TEST_FILES, ...TOOLING_FILES],
    plugins,
    rules: toolingRules,
  },
);
