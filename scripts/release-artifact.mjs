// Exercise the compiled package through native node_modules resolution.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = process.cwd();
const scratch = mkdtempSync(
  join(process.env.GAME_KIT_ARTIFACT_EVIDENCE ?? tmpdir(), "game-kit-artifact-"),
);
console.log(`Artifact evidence: ${scratch}`);
const payload = join(scratch, "payload");
mkdirSync(payload);
execFileSync(process.execPath, ["scripts/release-build.mjs", payload], { stdio: "inherit" });
writeFileSync(join(payload, "SOURCE_COMMIT"), `${process.env.WORKERS_CI_COMMIT_SHA}\n`);
const result = JSON.parse(
  execFileSync(
    "npm",
    ["pack", payload, "--offline", "--ignore-scripts", "--json", "--pack-destination", scratch],
    { encoding: "utf8" },
  ),
);
const consumer = join(scratch, "consumer");
const installed = join(consumer, "node_modules/@andornaut/game-kit");
mkdirSync(installed, { recursive: true });
execFileSync("tar", [
  "-xzf",
  join(scratch, result[0].filename),
  "--strip-components=1",
  "-C",
  installed,
]);
const source = JSON.parse(readFileSync("package.json", "utf8"));
const manifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
assert.equal(manifest.version, source.version);
assert.deepEqual(Object.keys(manifest.exports), Object.keys(source.exports));
for (const entry of Object.values(manifest.exports)) {
  for (const target of typeof entry === "string" ? [entry] : Object.values(entry)) {
    assert.ok(existsSync(resolve(installed, target)), target);
  }
}
assert.equal(manifest.license, "MIT");
assert.deepEqual(Object.keys(manifest.peerDependencies), ["phaser"]);
for (const file of result[0].files) {
  assert.ok(!file.path.endsWith(".ts") || file.path.endsWith(".d.ts"), file.path);
  assert.ok(!file.path.includes(".test."), file.path);
}
writeFileSync(join(consumer, "package.json"), JSON.stringify({ type: "module" }));
// No peers are present during the pure runtime and declaration checks.
writeFileSync(
  join(consumer, "bootstrap.mjs"),
  `
import assert from 'node:assert/strict';
import { clamp } from '@andornaut/game-kit/numbers';
import { createProgressState } from '@andornaut/game-kit/progressState';
import { memoryStorage } from '@andornaut/game-kit/save/storage';
import * as storageModule from '@andornaut/game-kit/save/storage';
assert.deepEqual(Object.keys(storageModule), ['memoryStorage']);
import { findTraversal } from '@andornaut/game-kit/terrain/traversal';
import { beginCrumblingStep, endCrumblingStep } from '@andornaut/game-kit/terrain/crumbling';
assert.equal(clamp(0,1,2), 1);
assert.equal(typeof findTraversal, 'function');
assert.equal(typeof beginCrumblingStep, 'function');
assert.equal(typeof endCrumblingStep, 'function');
createProgressState().begin().finish();
const storage = memoryStorage();
await storage.write('proof', 'value');
assert.equal(await storage.read('proof'), 'value');
for (const path of ['src/numbers.ts', 'dist/numbers.js', 'SOURCE_COMMIT']) {
  assert.throws(()=>import.meta.resolve('@andornaut/game-kit/' + path), {code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
}
`,
);
execFileSync(process.execPath, ["bootstrap.mjs"], { cwd: consumer, stdio: "inherit" });
writeFileSync(
  join(consumer, "types.mts"),
  `
import { memoryStorage, type SaveStorage } from '@andornaut/game-kit/save/storage';
import {
  stepTraversal, findTraversal, type TraversalContext,
  type WorldTraversalContext, type WorldTraversalState,
  type WorldTraversalStepResult, type WorldTraversalResult,
} from '@andornaut/game-kit/terrain/traversal';
import { beginCrumblingStep, endCrumblingStep, type CrumblingWorld } from '@andornaut/game-kit/terrain/crumbling';
type World = CrumblingWorld<string, string>;
declare const context: WorldTraversalContext<string, World>;
declare const state: WorldTraversalState<string, World>;
const next: WorldTraversalStepResult<string, World> = stepTraversal(
  context, {move: 0, jump: false, timeSeconds: 0}, state,
);
const found: WorldTraversalResult<string, World> = findTraversal(context, {
  start: state, timeSeconds: 0, goal: {x: 0, y: 0, width: 1, height: 1},
  horizonSteps: 1, maxStates: 2, maxSteps: 1,
});
void next; void found; void beginCrumblingStep; void endCrumblingStep;
const storage: SaveStorage = memoryStorage();
void storage; void stepTraversal;
export type Context = TraversalContext<string>;
`,
);
execFileSync(
  process.execPath,
  [
    resolve("node_modules/typescript/bin/tsc"),
    "--module",
    "NodeNext",
    "--target",
    "ES2022",
    "--strict",
    "--skipLibCheck",
    "--noEmit",
    "types.mts",
  ],
  { cwd: consumer, stdio: "inherit" },
);
// The parent owns its Vite configuration, which imports only the game mechanisms it uses.
symlinkSync(resolve(root, "node_modules/vite"), join(consumer, "node_modules/vite"));
writeFileSync(
  join(consumer, "vite.config.ts"),
  `
import { defineConfig } from 'vite';
import { clamp } from '@andornaut/game-kit/numbers';
export default defineConfig({ define: { __KIT_CHECK__: JSON.stringify(clamp(0,1,2)) } });
`,
);
writeFileSync(
  join(consumer, "vite-bootstrap.mjs"),
  `
import assert from 'node:assert/strict';
import { loadConfigFromFile } from 'vite';
const loaded = await loadConfigFromFile(
  {command:'build',mode:'production'}, undefined, process.cwd(), 'silent', undefined, 'native');
assert.ok(loaded);
assert.equal(loaded.config.define.__KIT_CHECK__, '1');
`,
);
execFileSync(process.execPath, ["vite-bootstrap.mjs"], { cwd: consumer, stdio: "inherit" });
console.log("Packed artifact native Node, declarations and parent Vite bootstrap passed.");
