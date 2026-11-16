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
assert.deepEqual(
  manifest.exports["./build/buildInfo"],
  manifest.exports["./web/build/vite/buildInfo"],
);
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
} from '@andornaut/game-kit/runtime/achievements';
import { NOTHING_PREVIEWED, previewAchievements } from '@andornaut/game-kit/runtime/achievements/preview';
import { clamp } from '@andornaut/game-kit/runtime/numbers';
import { splitBalancedGraphemes } from '@andornaut/game-kit/runtime/lines';
assert.deepEqual(splitBalancedGraphemes(text=>text.length,'abcdef'),['abc','def']);
assert.deepEqual(splitBalancedGraphemes(text=>text.length,'a\u0301b'),['a\u0301','b']);
import { createProgressState } from '@andornaut/game-kit/runtime/progressState';
import { memoryStorage } from '@andornaut/game-kit/runtime/save/storage';
import * as storageModule from '@andornaut/game-kit/runtime/save/storage';
assert.deepEqual(Object.keys(storageModule), ['memoryStorage']);
import { findTraversal } from '@andornaut/game-kit/runtime/terrain/traversal';
import { beginCrumblingStep, endCrumblingStep } from '@andornaut/game-kit/runtime/terrain/crumbling';
import { renderPolicy } from '@andornaut/game-kit/build/securityHeaders';
import { frameTurnFor } from '@andornaut/game-kit/runtime/web/view/frameTurn';
import { buildLabel } from '@andornaut/game-kit/runtime/web/buildLabel';
import { shortCommit, UNKNOWN_COMMIT } from '@andornaut/game-kit/build/buildVersion';
import { replacePhaserFlags } from '@andornaut/game-kit/build/phaserBuild';
import { crashGate } from '@andornaut/game-kit/runtime/web/crash/crashModel';
import { isBuildId } from '@andornaut/game-kit/runtime/web/pwa/buildIdentity';
import { createAssetGroups } from '@andornaut/game-kit/runtime/web/pwa/dom/assetGroups';
for (const mode of [undefined, 'inactivity']) {
  const buildId = 'a'.repeat(40);
  let requests = 0;
  const groups = createAssetGroups({
    buildId, requestTimeoutMs:1000,
    ...(mode === undefined ? {} : {timeoutMode:mode}),
    container:{getRegistration:async()=>undefined,controller:{postMessage(message, transfer){
      requests++;
      assert.equal(message.activity, mode === 'inactivity' ? true : undefined);
      const port = transfer[0];
      if (mode === 'inactivity') port.postMessage({type:'activity',buildId,
        version:'artifact-proof',operationId:'artifact-work',sequence:1});
      port.postMessage({type:'result',result:{status:'available',version:'artifact-proof',readyGroups:[]}});
      port.close();
    }}},
  });
  try {
    assert.deepEqual(await groups.readState(),{status:'available',version:'artifact-proof',readyGroups:[]});
    assert.equal(requests,1);
  } finally { groups.dispose(); }
}
import { runServiceWorker } from '@andornaut/game-kit/runtime/web/pwa/dom/serviceWorker';
const previousSelf = globalThis.self;
try {
  for (const input of [{contentHashes:{},sounds:{},urls:[],version:'legacy-proof'},
    [1,'0123456789abcdef',null,[],[],[],null,[],null,null]]) {
    const listeners = [];
    globalThis.self = {location:{href:'https://fixture.invalid/sw.js',origin:'https://fixture.invalid'},
      addEventListener(type){listeners.push(type);}};
    runServiceWorker({cacheNamePrefix:'proof-',hashedAssetPrefix:'/assets/'},input);
    assert.deepEqual(listeners,['install','activate','message','fetch']);
  }
} finally {
  if (previousSelf === undefined) delete globalThis.self; else globalThis.self = previousSelf;
}
import { precacheFingerprint } from '@andornaut/game-kit/build/precacheList';
import { createHash } from 'node:crypto';
const jsonBody = '{}';
const verifiedFamily = {
  byteSize: 2, sha256: createHash('sha256').update(jsonBody).digest('hex'),
  urls: ['/left.json', '/right.json'],
};
const bodyHashes = new Map(verifiedFamily.urls.map((url) => [url,
  createHash('sha256').update(jsonBody).digest('base64url').slice(0, 8)]));
const bodySizes = new Map(verifiedFamily.urls.map((url) => [url, 2]));
const bodyPolicy = {cacheNamePrefix:'proof-',hashedAssetPrefix:'/assets/'};
const legacyFingerprint = precacheFingerprint(bodyPolicy, bodyHashes, bodySizes);
assert.equal(precacheFingerprint(bodyPolicy, bodyHashes, bodySizes, undefined, undefined), legacyFingerprint);
assert.notEqual(precacheFingerprint(bodyPolicy, bodyHashes, bodySizes, undefined, [verifiedFamily]), legacyFingerprint);
for (const privateHelper of ['runtime/web/pwa/verifiedJsonBody', 'web/pwa/verifiedJsonBody',
  'runtime/web/pwa/precacheWire', 'web/pwa/precacheWire']) {
  assert.throws(() => import.meta.resolve('@andornaut/game-kit/' + privateHelper), {
    code: 'ERR_PACKAGE_PATH_NOT_EXPORTED'
  });
}
import { validateLayoutTree } from '@andornaut/game-kit/runtime/ui/layoutTree';
import { mountLoadingFailure } from '@andornaut/game-kit/runtime/web/progress/dom/loadingFailure';
validateLayoutTree({}, {kind:'columns',key:'columns',gap:0,padding:0,sizing:{mode:'equal'},children:[]});
assert.equal(typeof mountLoadingFailure, 'function');
import * as imageTypes from '@andornaut/game-kit/runtime/art/rgbaImage';
assert.deepEqual(Object.keys(imageTypes), []);
assert.equal(isBuildId('a'.repeat(40)), true);
assert.equal(isBuildId('a'.repeat(40) + String.fromCharCode(10)), false);
for (const [canonical, legacy] of [
  ['runtime/numbers', 'numbers'],
  ['runtime/save/storage', 'save/storage'],
  ['runtime/web/buildLabel', 'web/build/buildLabel'],
  ['build/buildVersion', 'web/build/buildVersion'],
  ['build/phaserBuild', 'web/build/phaserBuild'],
  ['build/securityHeaders', 'web/headers/securityHeaders'],
  ['build/precacheList', 'web/pwa/precacheList'],
  ['build/rgbaImage', 'art/rgbaImage'],
  ['test/storageFixture', 'testing/storageFixture'],
  ['test/dom/failingLocalStorage', 'testing/dom/failingLocalStorage'],
  ['test/phaser/sceneStub', 'testing/phaser/sceneStub'],
]) {
  assert.strictEqual(await import('@andornaut/game-kit/' + canonical),
    await import('@andornaut/game-kit/' + legacy), canonical);
}
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
assert.equal(buildLabel('1.0.0', UNKNOWN_COMMIT), 'v1.0.0 · dev');
assert.equal(shortCommit(() => '', {}), UNKNOWN_COMMIT);
assert.equal(replacePhaserFlags({ CANVAS_RENDERER: false }, 'typeof CANVAS_RENDERER'), 'false');
assert.equal(crashGate()({ message: 'boom', source: '', stack: undefined }), true);
const css = import.meta.resolve('@andornaut/game-kit/runtime/web/crash/dom/crash.css');
assert.ok(css.endsWith('/dist/web/crash/dom/crash.css'), css);
assert.ok(readFileSync(fileURLToPath(css), 'utf8').includes('.crash {'));
assert.throws(() => import.meta.resolve('@andornaut/game-kit/build/buildInfo'), {
  code: 'ERR_PACKAGE_PATH_NOT_EXPORTED'
});
assert.throws(() => import.meta.resolve('@andornaut/game-kit/web/build/vite/buildInfo'), {
  code: 'ERR_PACKAGE_PATH_NOT_EXPORTED'
});
assert.equal(clamp(0,1,2), 1);
assert.equal(renderPolicy({'default-src': ["'self'"]}), "default-src 'self'");
assert.equal(frameTurnFor('landscape', true, 'portrait-secondary'), -90);
for (const sheet of ['frameTurnLandscapeGame.css', 'frameTurnPortraitGame.css']) {
  assert.ok(import.meta.resolve('@andornaut/game-kit/runtime/web/view/' + sheet).endsWith('/dist/web/view/' + sheet));
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
  `/// <reference types="@andornaut/game-kit/build/buildInfo" />
import { buildLabel } from '@andornaut/game-kit/runtime/web/buildLabel';
import type { PhaserBuild } from '@andornaut/game-kit/build/phaserBuild';
import { splitBalancedGraphemes } from '@andornaut/game-kit/runtime/lines';
export const balancedText: readonly [string,string] | undefined = splitBalancedGraphemes(text=>text.length,'abcde');
import {
  bindHoldActions, type HoldAction, type HoldActionBinding, type HoldActionsBinding,
  type PointerReleaseHoldActionsOptions,
} from '@andornaut/game-kit/runtime/web/input/dom/holdActions';
import type { PressGuard } from '@andornaut/game-kit/runtime/web/ui/dom/domPress';
import type { CrashScreenOptions } from '@andornaut/game-kit/runtime/web/crash/dom/crashScreen';
import type { LoadingFailureContext } from '@andornaut/game-kit/runtime/web/progress/dom/loadingFailure';
export function bindPointerAction(
  guard: PressGuard, action: HoldAction, root: HTMLElement,
): HoldActionsBinding {
  const options: PointerReleaseHoldActionsOptions = {
    activation:'pointer-release',guard,pointerTarget:root.ownerDocument,
    resolve:()=>action,resolvePointer:()=>action,
  };
  const binding = bindHoldActions(options,root);
  binding.cancel();
  return binding;
}
export function factoryActionPorts(bind: HoldActionBinding): [
  Pick<LoadingFailureContext,'bindHoldAction'>,Pick<CrashScreenOptions,'bindHoldAction'>,
] { return [{bindHoldAction:bind},{bindHoldAction:bind}]; }
import type { RgbaImage } from '@andornaut/game-kit/runtime/art/rgbaImage';
import type { PrecacheManifest } from '@andornaut/game-kit/runtime/web/pwa/precacheManifest';
import { runServiceWorker } from '@andornaut/game-kit/runtime/web/pwa/dom/serviceWorker';
import type { PrecacheManifest as LegacyManifest } from '@andornaut/game-kit/web/pwa/precacheList';
import type { PrecachePluginOptions } from '@andornaut/game-kit/build/precachePlugin';
import type { AssetGroupsOptions } from '@andornaut/game-kit/runtime/web/pwa/dom/assetGroups';
export const groupTiming: Pick<AssetGroupsOptions, 'timeoutMode' | 'requestTimeoutMs'> = {
  timeoutMode:'inactivity',requestTimeoutMs:1000,
};
type VerifiedFamily = NonNullable<PrecacheManifest['verifiedJsonBodies']>[number];
export const verifiedFamily: VerifiedFamily = {
  byteSize: 2, sha256: '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
  urls: ['/left.json', '/right.json'],
};
export const bodyOptions: Pick<PrecachePluginOptions, 'verifiedJsonBodies'> = {
  verifiedJsonBodies: () => [verifiedFamily.urls],
};
import { storageFixture } from '@andornaut/game-kit/test/storageFixture';
export const image: RgbaImage = { data: new Uint8Array(4), height: 1, width: 1 };
export const manifest: PrecacheManifest = { contentHashes: {}, sounds: {}, urls: [], version: 'proof' };
export function bootWorker(policy: Parameters<typeof runServiceWorker>[0]):void { runServiceWorker(policy,manifest); }
export const legacyManifest: LegacyManifest = { ...manifest, verifiedJsonBodies: [verifiedFamily] };
export const fixture = storageFixture();
import type { LayoutColumnSizing, LayoutColumnTrack, LayoutNode } from '@andornaut/game-kit/runtime/ui/layoutTree';
import {
  mountLoadingFailure, type LoadingFailureLayout,
  type LoadingFailureActionTextStyle,
  type LoadingFailurePresentation, type LoadingFailurePresentationView,
} from '@andornaut/game-kit/runtime/web/progress/dom/loadingFailure';
import type {
  InstallationIdentity, InstallationState, OfflinePlay, OfflinePlayOptions,
} from '@andornaut/game-kit/runtime/web/pwa/dom/offlinePlay';
export const installationIdentity: InstallationIdentity = {attempt:1,operationId:undefined,version:undefined};
export const installation: InstallationState = {
  ...installationIdentity,kind:'failed',stage:'installation',error:new Error('failed'),
};
export function mountInstallationFailure(
  offline: OfflinePlay, parent: HTMLElement,
): OfflinePlayOptions['onInstallationState'] {
  const failure = mountLoadingFailure({onRetry:async () => { await offline.retryInstallation(); }},parent);
  return state => failure.update(state);
}
export function configuredFailure(
  presentation: LoadingFailurePresentation, parent: HTMLElement,
): LoadingFailurePresentationView {
  const view = mountLoadingFailure({presentation,onRetry(){}},parent);
  view.setPresentation(presentation);
  return view;
}
export const failureAction: LoadingFailureActionTextStyle = {
  sizePx:18,weight:700,lineHeight:1.2,synthesis:'weight',
};
export function actionSynthesisFailure(
  presentation: LoadingFailurePresentation, parent: HTMLElement,
): LoadingFailurePresentationView {
  const configured = {...presentation,text:{...presentation.text,action:failureAction}};
  const view = mountLoadingFailure({presentation:configured,onRetry(){}},parent);
  view.setPresentation({...configured,text:{...configured.text,action:{...failureAction,synthesis:'none'}}});
  view.setPresentation(presentation);
  return view;
}
export const tracks: readonly LayoutColumnTrack[] = [{kind:'fraction'},{kind:'intrinsic'},{kind:'fixed',size:3}];
export const columnSizing: LayoutColumnSizing = {mode:'tracks',tracks};
export const columns: LayoutNode<{text:{props:{label:string};slots:never}}> = {
  kind:'columns',key:'columns',gap:0,padding:0,sizing:{mode:'equal'},children:[],
};
export const failureLayout: LoadingFailureLayout = {actionAlign:'end',gapPx:8,minActionSizePx:48,paddingPx:12};
export function mountFailure(parent: HTMLElement): void {
  mountLoadingFailure({layout:failureLayout,onRetry(){}},parent);
}
import { crashView, type CrashView } from '@andornaut/game-kit/runtime/web/crash/crashModel';
export const label: string = buildLabel(__APP_VERSION__, __COMMIT__);
export const phaser: PhaserBuild = { flags: { CANVAS_RENDERER: false }, omitted: [] };
export const view: CrashView = crashView(
  { body: 'b', reload: 'r', title: 't' }, false, { message: 'm', source: '', stack: undefined },
);
import { memoryStorage, type SaveStorage } from '@andornaut/game-kit/runtime/save/storage';
import {
  judge, type AchievementDef, type ConditionKinds, type EarnedStore, earnedStore, earnedFormat,
} from '@andornaut/game-kit/runtime/achievements';
import {
  previewAchievements, NOTHING_PREVIEWED, type AchievementPreview,
} from '@andornaut/game-kit/runtime/achievements/preview';
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
} from '@andornaut/game-kit/runtime/terrain/traversal';
import {
  beginCrumblingStep, endCrumblingStep, type CrumblingWorld,
} from '@andornaut/game-kit/runtime/terrain/crumbling';
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
import { clamp } from '@andornaut/game-kit/runtime/numbers';
import { securityHeadersPlugin } from '@andornaut/game-kit/build/securityHeadersPlugin';
import { phaserBuildPlugin } from '@andornaut/game-kit/build/phaserBuildPlugin';
import { phaserBuildPlugin as legacyPhaserPlugin } from '@andornaut/game-kit/web/build/vite/phaserBuildPlugin';
import {
  securityHeadersPlugin as legacyHeadersPlugin,
} from '@andornaut/game-kit/web/headers/vite/securityHeadersPlugin';
if (phaserBuildPlugin !== legacyPhaserPlugin || securityHeadersPlugin !== legacyHeadersPlugin) {
  throw new Error('Canonical build aliases changed module identity');
}
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
// A pending retry owns disabled state while the registry truthfully remains failed.
symlinkSync(resolve(root, "node_modules/happy-dom"), join(consumer, "node_modules/happy-dom"));
writeFileSync(
  join(consumer, "loading-failure.mjs"),
  `
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { createRequiredLoading } from '@andornaut/game-kit/runtime/load/loadingAttempts';
import { mountLoadingFailure } from '@andornaut/game-kit/runtime/web/progress/dom/loadingFailure';
const window = new Window();
let finish;
const pending = new Promise(resolve => { finish = resolve; });
let retries = 0;
let activations = 0;
let flight;
const registry = createRequiredLoading([{
  status: () => 'failed',
  retry: () => { retries += 1; return pending; },
}]);
const view = mountLoadingFailure({onRetry: () => {
  activations += 1;
  return flight = registry.retry();
}}, window.document.body);
const stop = registry.subscribe(state => view.update(state));
const leakedKeys = [];
const keyTypes = ['keydown', 'keypress', 'keyup'];
const onKey = event => leakedKeys.push(event.key);
for (const type of keyTypes) window.addEventListener(type, onKey);
try {
  const button = view.element.querySelector('button');
  assert.ok(button);
  button.focus();
  const down = new window.KeyboardEvent('keydown', {key:'Enter',bubbles:true,cancelable:true});
  button.dispatchEvent(down);
  assert.equal(down.defaultPrevented, false);
  assert.deepEqual(leakedKeys, []);
  button.click();
  button.blur();
  for (const type of ['keydown', 'keypress', 'keyup']) {
    const event = new window.KeyboardEvent(type, {key:'Enter',repeat:true,bubbles:true,cancelable:true});
    window.document.body.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false);
  }
  assert.deepEqual(leakedKeys, []);
  window.document.body.dispatchEvent(new window.KeyboardEvent('keydown', {key:'ArrowDown',bubbles:true}));
  assert.deepEqual(leakedKeys, ['ArrowDown']);
  assert.equal(registry.state.kind, 'failed');
  assert.equal(button.disabled, true);
  view.update(registry.state);
  button.click();
  assert.equal(button.disabled, true);
  assert.equal(retries, 1);
  assert.equal(activations, 1);
  finish();
  await flight;
  await Promise.resolve();
  assert.equal(registry.state.kind, 'failed');
  assert.equal(button.disabled, false);
} finally {
  stop();
  view.dispose();
  registry.dispose();
  finish();
  await flight;
  for (const type of keyTypes) window.removeEventListener(type, onKey);
  window.close();
}
`,
);
execFileSync(process.execPath, ["loading-failure.mjs"], { cwd: consumer, stdio: "inherit" });
writeFileSync(
  join(consumer, "hold-actions.mjs"),
  `
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { createModalInputGate } from '@andornaut/game-kit/runtime/input/modalInput';
import { bindHoldActions } from '@andornaut/game-kit/runtime/web/input/dom/holdActions';
import { mountLoadingFailure } from '@andornaut/game-kit/runtime/web/progress/dom/loadingFailure';
const window = new Window();
const {document} = window;
const root = document.createElement('div');
const control = document.createElement('button');
const canvas = document.createElement('canvas');
root.append(control);
document.body.append(root,canvas);
const gate = createModalInputGate();
let binding, unsubscribe, failure, modal;
let activations=0, canvasUps=0, nativeClicks=0, visual=null;
let duration=100000;
const activate=()=>{activations++;};
let action={element:control,identity:{},rule:{holdMs:duration,slopPx:10},available:()=>true,activate};
const pointer=(type,target)=>{
  const event=new window.PointerEvent(type,{
    bubbles:true,cancelable:true,isPrimary:true,button:0,pointerId:4,clientX:5,clientY:5,
  });
  target.dispatchEvent(event);
  assert.equal(event.defaultPrevented,false);
};
const click=(detail=1)=>{
  const event=new window.PointerEvent('click',{bubbles:true,cancelable:true,detail,pointerId:4});
  control.dispatchEvent(event);
  return event;
};
canvas.addEventListener('pointerup',()=>canvasUps++);
control.addEventListener('click',()=>nativeClicks++);
try {
  binding=bindHoldActions({activation:'pointer-release',guard:{gate},pointerTarget:document,
    resolve:target=>target===control?action:null,resolvePointer:()=>action,
    onPressChange:value=>{visual=value;},
  },root);
  unsubscribe=gate.subscribe(binding.cancel);
  pointer('pointerdown',canvas);
  pointer('pointerup',canvas);
  assert.equal(activations,1);
  assert.equal(canvasUps,1);
  assert.equal(click().defaultPrevented,true);
  assert.equal(nativeClicks,0);
  assert.equal(click(0).defaultPrevented,false);
  assert.equal(nativeClicks,1);
  action={...action,rule:{holdMs:0,slopPx:10},activate:()=>{activations++;modal=gate.open();}};
  pointer('pointerdown',control);
  await new Promise(resolve=>window.setTimeout(resolve,0));
  assert.equal(activations,2);
  assert.equal(visual,null);
  pointer('pointerup',control);
  assert.equal(click().defaultPrevented,true);
  assert.equal(activations,2);
  modal.close();
  binding();
  unsubscribe();
  let retries=0, semantic;
  failure=mountLoadingFailure({onRetry:()=>{retries++;},bindHoldAction:value=>{
    semantic=value;
    return ()=>{semantic=null;};
  }},document.body);
  failure.update({kind:'failed',attempt:1,error:new Error('fixture')});
  assert.equal(semantic.available(),true);
  semantic.activate();
  assert.equal(retries,1);
  assert.equal(semantic.available(),false);
  failure.dispose();
  assert.equal(semantic,null);
} finally {
  binding?.();
  unsubscribe?.();
  failure?.dispose();
  window.close();
}
`,
);
execFileSync(process.execPath, ["hold-actions.mjs"], { cwd: consumer, stdio: "inherit" });
writeFileSync(
  join(consumer, "loading-presentation.mjs"),
  `
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { mountLoadingFailure } from '@andornaut/game-kit/runtime/web/progress/dom/loadingFailure';
const window = new Window();
const frame = window.document.createElement('div');
frame.style.width = '360px';
frame.style.height = '560px';
frame.style.setProperty('font-synthesis','none');
window.document.body.append(frame);
const presentation = {
  panel: {maxWidthPx:328,safeInsetPx:16,paddingTopPx:24,paddingXPx:16,paddingBottomPx:16,
    titleBodyGapPx:16,bodyActionGapPx:24,borderWidthPx:1,lipHeightPx:4,shadowOffsetPx:4},
  text: {title:{sizePx:24,weight:700,lineHeight:1.2},body:{sizePx:18,weight:400,lineHeight:1.45},
    action:{sizePx:18,weight:900,lineHeight:1.2,synthesis:'weight'}},
  action: {widthPx:80,heightPx:30,paddingXPx:7.5,paddingBottomPx:2.5,borderWidthPx:1,
    highlightHeightPx:1,shadeHeightPx:2.5},
  palette: {panel:'#ead4aa',text:'#3e2731',action:'#63c74d',actionText:'#181425',border:'#181425',
    lip:'#e4a672',shadow:'#181425',highlight:'#fee761',shade:'#265c42'},
};
let finish;
const pending = new Promise(resolve => { finish = resolve; });
let retries = 0;
const view = mountLoadingFailure({presentation,onRetry:()=>{retries += 1; return pending;}},frame);
const leaked = [];
const onKey = event => leaked.push(event.key);
window.addEventListener('keyup',onKey);
try {
  view.update({attempt:1,kind:'failed',error:undefined});
  const button = view.element.querySelector('button');
  assert.ok(button);
  assert.equal(view.element.querySelector('h2').style.fontSize,'24px');
  assert.equal(view.element.querySelector('p').style.fontSize,'18px');
  assert.equal(button.style.fontSize,'18px');
  assert.equal(button.style.height,'30px');
  assert.equal(button.style.getPropertyValue('font-synthesis'),'weight');
  assert.equal(button.style.getPropertyPriority('font-synthesis'),'important');
  for (const node of view.element.querySelectorAll('h2, p')) {
    assert.equal(node.style.backgroundColor,'transparent');
    assert.equal(node.style.getPropertyPriority('background-color'),'important');
  }
  button.focus();
  button.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  button.click();
  assert.equal(button.disabled,true);
  const resized = {...presentation,panel:{...presentation.panel,maxWidthPx:300},
    action:{...presentation.action,widthPx:64,heightPx:24}};
  view.setPresentation(resized);
  assert.equal(view.element.querySelector('button'),button);
  assert.equal(button.disabled,true);
  assert.equal(button.style.height,'24px');
  assert.equal(button.style.width,'64px');
  assert.equal(button.style.fontSize,'18px');
  assert.equal(retries,1);
  const geometry = [button.style.width,button.style.height,button.style.fontSize,button.style.fontFamily];
  const acceptedText = [...view.element.querySelectorAll('h2, p')].map(node=>node.style.cssText);
  view.setPresentation({...resized,text:{...resized.text,action:{...resized.text.action,synthesis:'none'}}});
  assert.equal(button.style.getPropertyValue('font-synthesis'),'none');
  assert.equal(button.style.getPropertyPriority('font-synthesis'),'important');
  const inheritedAction = {sizePx:resized.text.action.sizePx,weight:resized.text.action.weight,
    lineHeight:resized.text.action.lineHeight};
  view.setPresentation({...resized,text:{...resized.text,action:inheritedAction}});
  assert.equal(button.style.getPropertyValue('font-synthesis'),'');
  assert.equal(button.style.getPropertyPriority('font-synthesis'),'');
  assert.equal(frame.style.getPropertyValue('font-synthesis'),'none');
  assert.equal(view.element.querySelector('button'),button);
  assert.equal(button.disabled,true);
  assert.equal(retries,1);
  assert.deepEqual([button.style.width,button.style.height,button.style.fontSize,button.style.fontFamily],geometry);
  assert.deepEqual([...view.element.querySelectorAll('h2, p')].map(node=>node.style.cssText),acceptedText);
  for (const node of view.element.querySelectorAll('h2, p')) {
    assert.equal(node.style.backgroundColor,'transparent');
    assert.equal(node.style.getPropertyPriority('background-color'),'important');
  }
  const before = view.element.getAttribute('style');
  assert.throws(()=>view.setPresentation({...resized,panel:{...resized.panel,maxWidthPx:NaN}}),RangeError);
  assert.equal(view.element.getAttribute('style'),before);
  button.blur();
  window.document.body.dispatchEvent(new window.KeyboardEvent('keyup',{key:'Enter',bubbles:true}));
  assert.deepEqual(leaked,[]);
  finish();
  await pending;
  await Promise.resolve();
  assert.equal(button.disabled,false);
} finally {
  finish();
  await pending;
  view.dispose();
  window.removeEventListener('keyup',onKey);
  window.close();
}
`,
);
execFileSync(process.execPath, ["loading-presentation.mjs"], { cwd: consumer, stdio: "inherit" });
console.log(
  "Packed artifact native Node, declarations, parent Vite, retry and presentation passed.",
);
