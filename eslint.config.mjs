import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import { createNodeResolver } from "eslint-plugin-import-x/node-resolver";
import noCycle from "eslint-plugin-import-x/rules/no-cycle";
import globals from "globals";
import ts from "typescript-eslint";

import { plugins, sourceRules, toolingRules } from "./eslint.config.base.mjs";

const KIT_FILES = ["src/**/*.ts"];
const PHASER_FILES = ["src/**/phaser/**"];
const VITE_FILES = ["src/**/vite/**"];

// A copy of the kit lives in each game, so it imports nothing from outside src/ and its own
// modules by relative path, which resolve consistently in every client.
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

// Build plugins run in Node at build time, never in the game: only vite/ folders import Vite or
// a vite/ folder.
const VITE = {
  group: ["**/vite", "**/vite/*"],
  message: "Only vite/ folders may import Vite or a vite/ folder.",
};

export default defineConfig(
  {
    ignores: [".claude/", "node_modules/"],
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
    rules: sourceRules,
  },
  // A later no-restricted-imports replaces an earlier one, so each file gets one list.
  {
    files: KIT_FILES,
    ignores: [...PHASER_FILES, ...VITE_FILES],
    rules: { "no-restricted-imports": ["error", { patterns: [OUTSIDE_KIT, PHASER, VITE] }] },
  },
  {
    files: PHASER_FILES,
    rules: { "no-restricted-imports": ["error", { patterns: [OUTSIDE_KIT, VITE] }] },
  },
  {
    files: VITE_FILES,
    rules: { "no-restricted-imports": ["error", { patterns: [OUTSIDE_KIT, PHASER] }] },
  },
  // No import cycles: a module in a cycle can run before what it imports has loaded. Type-only
  // imports are erased at build time, so they never form one.
  {
    files: KIT_FILES,
    plugins: { "import-x": { rules: { "no-cycle": noCycle } } },
    rules: { "import-x/no-cycle": "error" },
    settings: {
      "import-x/extensions": [".ts"],
      "import-x/resolver-next": [createNodeResolver({ extensions: [".ts", ".js"] })],
    },
  },
  // Config files: they produce what ships rather than being it.
  {
    files: ["*.ts", "*.js", "*.mjs", "scripts/**/*.ts", "scripts/**/*.mjs"],
    plugins,
    rules: toolingRules,
  },
);
