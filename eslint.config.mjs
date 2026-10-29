import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import { createNodeResolver, importX } from "eslint-plugin-import-x";
import globals from "globals";
import ts from "typescript-eslint";

import { plugins, sourceRules, toolingRules } from "./eslint.config.base.mjs";

const KIT_FILES = ["kit/src/**/*.ts"];
const PHASER_FILES = ["kit/src/**/phaser/**"];

// A copy of the kit lives in each game, so it imports nothing from outside kit/src/ and its own
// modules by relative path, which work without the game's alias.
const OUTSIDE_KIT = {
  group: ["@andornaut/game-kit", "@andornaut/game-kit/*", "**/src", "**/src/*"],
  message: "kit/src/ imports nothing from a game, and its own modules by relative path.",
};

// Pure code runs in unit tests without a renderer: only phaser/ folders import Phaser or a
// phaser/ folder.
const PHASER = {
  group: ["**/phaser", "**/phaser/*"],
  message: "Only phaser/ folders may import Phaser or a phaser/ folder.",
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
    ignores: PHASER_FILES,
    rules: { "no-restricted-imports": ["error", { patterns: [OUTSIDE_KIT, PHASER] }] },
  },
  {
    files: PHASER_FILES,
    rules: { "no-restricted-imports": ["error", { patterns: [OUTSIDE_KIT] }] },
  },
  // No import cycles: a module in a cycle can run before what it imports has loaded. Type-only
  // imports are erased at build time, so they never form one.
  {
    files: KIT_FILES,
    plugins: { "import-x": importX },
    rules: { "import-x/no-cycle": "error" },
    settings: {
      "import-x/extensions": [".ts"],
      "import-x/resolver-next": [createNodeResolver({ extensions: [".ts", ".js"] })],
    },
  },
  // Config files: they produce what ships rather than being it.
  {
    files: ["*.ts", "*.js", "*.mjs"],
    plugins,
    rules: toolingRules,
  },
);
