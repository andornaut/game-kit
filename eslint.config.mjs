import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import { createNodeResolver } from "eslint-plugin-import-x/node-resolver";
import noCycle from "eslint-plugin-import-x/rules/no-cycle";
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
  // No import cycles: a module in a cycle can run before what it imports has loaded. Type-only
  // imports are erased at build time, so this rule skips them; scripts/import-cycles.test.ts
  // rejects type cycles too.
  {
    files: [...KIT_FILES, ...TOOLING_FILES],
    plugins: { "import-x": { rules: { "no-cycle": noCycle } } },
    rules: { "import-x/no-cycle": "error" },
    settings: {
      "import-x/extensions": [".ts"],
      "import-x/resolver-next": [createNodeResolver({ extensions: [".ts", ".js"] })],
    },
  },
  // Tests and tooling: they verify or produce what ships rather than being it.
  {
    files: [...TEST_FILES, ...TOOLING_FILES],
    plugins,
    rules: toolingRules,
  },
);
