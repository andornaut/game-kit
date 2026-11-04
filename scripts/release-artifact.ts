// Exercise a packed release tarball through native node_modules resolution.
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

interface Manifest {
  exports: Record<string, string | Record<string, string>>;
  license: string;
  peerDependencies: Record<string, string>;
  version: string;
}

const [artifact] = process.argv.slice(2);
if (artifact === undefined) {
  throw new Error("Usage: release-artifact.ts <artifact.tgz>");
}
const sourceCommit = process.env.SOURCE_COMMIT;
if (sourceCommit === undefined || !/^[0-9a-f]{40}$/.test(sourceCommit)) {
  throw new Error("SOURCE_COMMIT must name the full source commit.");
}
const root = process.cwd();
const scratch = mkdtempSync(
  join(process.env.GAME_KIT_ARTIFACT_EVIDENCE ?? tmpdir(), "game-kit-artifact-"),
);
console.log(`Artifact evidence: ${scratch}`);
const consumer = join(scratch, "consumer");
const installed = join(consumer, "node_modules/@andornaut/game-kit");
mkdirSync(installed, { recursive: true });
const files = execFileSync("tar", ["-tzf", artifact], { encoding: "utf8" })
  .split("\n")
  .filter((path) => path !== "");
writeFileSync(join(scratch, "artifact-files.txt"), `${files.join("\n")}\n`);
execFileSync("tar", ["-xzf", artifact, "--strip-components=1", "-C", installed]);
assert.equal(readFileSync(join(installed, "SOURCE_COMMIT"), "utf8"), `${sourceCommit}\n`);
const source = JSON.parse(readFileSync("package.json", "utf8")) as Manifest;
const manifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8")) as Manifest;
assert.equal(manifest.version, source.version);
assert.deepEqual(Object.keys(manifest.exports), Object.keys(source.exports));
for (const entry of Object.values(manifest.exports)) {
  for (const target of typeof entry === "string" ? [entry] : Object.values(entry)) {
    assert.ok(existsSync(resolve(installed, target)), target);
    if (target.endsWith(".css")) {
      assert.ok(readFileSync(resolve(installed, target), "utf8").trim() !== "", target);
    }
  }
}
assert.equal(manifest.license, "MIT");
assert.deepEqual(Object.keys(manifest.peerDependencies), [
  "phaser",
  "typescript",
  "vite",
  "vitest",
]);
assert.deepEqual(manifest.exports["./web/build/vite/buildInfo"], {
  types: "./dist/web/build/vite/buildInfo.d.ts",
});
assert.equal(manifest.exports["./web/crash/dom/crash.css"], "./dist/web/crash/dom/crash.css");
for (const path of files) {
  assert.ok(!path.endsWith(".ts") || path.endsWith(".d.ts"), path);
  assert.ok(!path.includes(".test."), path);
}
writeFileSync(join(consumer, "package.json"), JSON.stringify({ type: "module" }));
// No peers are present during the pure runtime and declaration checks.
writeFileSync(
  join(consumer, "bootstrap.mjs"),
  `
import assert from 'node:assert/strict';
import {
  CelebrationQueue, earnedFormat, earnedStore, judge, newlyEarned, orderByTier,
} from '@andornaut/game-kit/achievements';
import { NOTHING_PREVIEWED, previewAchievements } from '@andornaut/game-kit/achievements/preview';
import { clamp } from '@andornaut/game-kit/numbers';
import { createProgressState } from '@andornaut/game-kit/progressState';
import { memoryStorage } from '@andornaut/game-kit/save/storage';
import * as storageModule from '@andornaut/game-kit/save/storage';
assert.deepEqual(Object.keys(storageModule), ['memoryStorage']);
import { findTraversal } from '@andornaut/game-kit/terrain/traversal';
import { beginCrumblingStep, endCrumblingStep } from '@andornaut/game-kit/terrain/crumbling';
import { renderPolicy } from '@andornaut/game-kit/web/headers/securityHeaders';
import { frameTurnFor } from '@andornaut/game-kit/web/view/frameTurn';
import { buildLabel } from '@andornaut/game-kit/web/build/buildLabel';
import { shortCommit, UNKNOWN_COMMIT } from '@andornaut/game-kit/web/build/buildVersion';
import { replacePhaserFlags } from '@andornaut/game-kit/web/build/phaserBuild';
import { crashGate } from '@andornaut/game-kit/web/crash/crashModel';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
assert.equal(buildLabel('1.0.0', UNKNOWN_COMMIT), 'v1.0.0 · dev');
assert.equal(shortCommit(() => '', {}), UNKNOWN_COMMIT);
assert.equal(replacePhaserFlags({ CANVAS_RENDERER: false }, 'typeof CANVAS_RENDERER'), 'false');
assert.equal(crashGate()({ message: 'boom', source: '', stack: undefined }), true);
const css = import.meta.resolve('@andornaut/game-kit/web/crash/dom/crash.css');
assert.ok(css.endsWith('/dist/web/crash/dom/crash.css'), css);
assert.ok(readFileSync(fileURLToPath(css), 'utf8').includes('.crash {'));
assert.throws(() => import.meta.resolve('@andornaut/game-kit/web/build/vite/buildInfo'), {
  code: 'ERR_PACKAGE_PATH_NOT_EXPORTED'
});
assert.equal(clamp(0,1,2), 1);
assert.equal(renderPolicy({'default-src': ["'self'"]}), "default-src 'self'");
assert.equal(frameTurnFor('landscape', true, 'portrait-secondary'), -90);
for (const sheet of ['frameTurnLandscapeGame.css', 'frameTurnPortraitGame.css']) {
  assert.ok(import.meta.resolve('@andornaut/game-kit/web/view/' + sheet).endsWith('/dist/web/view/' + sheet));
}
assert.equal(typeof findTraversal, 'function');
assert.equal(typeof beginCrumblingStep, 'function');
assert.equal(typeof endCrumblingStep, 'function');
createProgressState().begin().finish();
const badges = orderByTier(['low', 'high'], [
  { conditions: [{ kind: 'flag' }], id: 'b', tier: 'high' },
  { conditions: [{ kind: 'flag' }], id: 'a', tier: 'low' },
]);
const badgeJudge = judge({ flag: { holds: (facts) => facts, scopes: ['end'] } });
assert.deepEqual(newlyEarned(badgeJudge, badges, 'end', true, ['a']), ['b']);
const earned = earnedStore(memoryStorage(), { backup: 'k2', save: 'k' }, earnedFormat(1, ['a', 'b']));
await Promise.all([earned.award(['a', 'b']), earned.announced('a')]);
assert.deepEqual(earned.record(), { earned: ['a', 'b'], unannounced: ['b'] });
const notices = new CelebrationQueue();
notices.push(['b', 'b']);
assert.equal(notices.takeWhen(() => false), 'b');
const look = previewAchievements(String, () => ['a'], NOTHING_PREVIEWED, 1);
assert.deepEqual(look, { earned: ['a'], preview: { key: '1', shown: ['a'] } });
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
  `/// <reference types="@andornaut/game-kit/web/build/vite/buildInfo" />
import { buildLabel } from '@andornaut/game-kit/web/build/buildLabel';
import type { PhaserBuild } from '@andornaut/game-kit/web/build/phaserBuild';
import { crashView, type CrashView } from '@andornaut/game-kit/web/crash/crashModel';
export const label: string = buildLabel(__APP_VERSION__, __COMMIT__);
export const phaser: PhaserBuild = { flags: { CANVAS_RENDERER: false }, omitted: [] };
export const view: CrashView = crashView(
  { body: 'b', reload: 'r', title: 't' }, false, { message: 'm', source: '', stack: undefined },
);
import { memoryStorage, type SaveStorage } from '@andornaut/game-kit/save/storage';
import {
  judge, type AchievementDef, type ConditionKinds, type EarnedStore, earnedStore, earnedFormat,
} from '@andornaut/game-kit/achievements';
import {
  previewAchievements, NOTHING_PREVIEWED, type AchievementPreview,
} from '@andornaut/game-kit/achievements/preview';
type Badge = AchievementDef<'a', { readonly kind: 'flag' }, 'low'>;
export const badge: Badge = { conditions: [{ kind: 'flag' }], id: 'a', tier: 'low' };
const badgeKinds: ConditionKinds<{ readonly kind: 'flag' }, 'end', boolean> = {
  flag: { holds: (facts) => facts, scopes: ['end'] },
};
export const badgeJudged: boolean = judge(badgeKinds).holds('end', true, { kind: 'flag' });
export const badgeStore: EarnedStore<'a'> =
  earnedStore(memoryStorage(), { backup: 'k2', save: 'k' }, earnedFormat(1, ['a'] as const));
export const badgePreview: AchievementPreview<'a'> =
  previewAchievements((n: number) => String(n), () => ['a' as const], NOTHING_PREVIEWED, 1).preview;
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
// The parent owns its Vite configuration, which imports the kit modules and plugins it uses.
symlinkSync(resolve(root, "node_modules/vite"), join(consumer, "node_modules/vite"));
symlinkSync(resolve(root, "node_modules/phaser"), join(consumer, "node_modules/phaser"));
writeFileSync(
  join(consumer, "vite.config.ts"),
  `
import { defineConfig } from 'vite';
import { clamp } from '@andornaut/game-kit/numbers';
import { securityHeadersPlugin } from '@andornaut/game-kit/web/headers/vite/securityHeadersPlugin';
import { phaserBuildPlugin } from '@andornaut/game-kit/web/build/vite/phaserBuildPlugin';
export default defineConfig({
  define: { __KIT_CHECK__: JSON.stringify(clamp(0,1,2)) },
  plugins: [phaserBuildPlugin({ flags: {}, omitted: [] }), securityHeadersPlugin({
    base: {}, fileRules: [], hashedAssetPath: '/assets/*', heading: 'Proof.', pageRules: [],
  })],
});
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
assert.deepEqual(
  loaded.config.plugins.map(({name}) => name), ['game-kit-phaser-build', 'game-kit-security-headers']);
`,
);
execFileSync(process.execPath, ["vite-bootstrap.mjs"], { cwd: consumer, stdio: "inherit" });
console.log("Packed artifact native Node, declarations and parent Vite bootstrap passed.");
