#!/usr/bin/env bash
# Container-only implementation. Never run against a live consumer checkout.
set -euo pipefail
[ "$(node --version)" = v24.21.0 ]
[ "$#" = 5 ]
expected_hash=$1 source_revision=$2 expected_version=$3 dog_revision=$4 duck_revision=$5
[ "$(sha256sum /assets/release.tgz | cut -d ' ' -f 1)" = "$expected_hash" ]
mkdir -p /scratch/reference /scratch/home
touch /scratch/npm-user-config /scratch/npm-global-config
# Validate archive paths before extraction, including link and special-file refusal.
tar -tzf /assets/release.tgz > /scratch/artifact-files.txt
awk '$0 !~ /^package\// || $0 ~ /(^|\/)\.\.(\/|$)/ { bad=1 } END { exit bad }' /scratch/artifact-files.txt
tar -tvzf /assets/release.tgz > /scratch/artifact-modes.txt
awk 'substr($0,1,1) != "-" && substr($0,1,1) != "d" { bad=1 } END { exit bad }' /scratch/artifact-modes.txt
tar -xzf /assets/release.tgz -C /scratch/reference --no-same-owner
export EXPECTED_KIT_COMMIT=$source_revision EXPECTED_KIT_VERSION=$expected_version
failed=0
for game in dog duck; do
  if [ "$game" = dog ]; then revision=$dog_revision; else revision=$duck_revision; fi
  work=/scratch/$game
  mkdir -p "$work" "/scratch/cache-$game"
  # Separate writable cache, populated from the owner's read-only offline store.
  cp -a --reflink=auto "/caches/$game/_cacache" "/scratch/cache-$game/"
  git -c safe.directory="/repos/$game.git" -C "/repos/$game.git" archive "$revision" | tar -x -C "$work"
  set +e
  (
    set -e
    cd "$work"
    export npm_config_cache="/scratch/cache-$game"
    # Only the disposable manifest and lockfile are adapted to the exact tarball.
    node --input-type=module <<'JS'
import fs from 'node:fs';
const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
if (!p.dependencies?.['@andornaut/game-kit']) throw new Error('Consumer must declare game-kit');
p.dependencies['@andornaut/game-kit'] = 'file:/assets/release.tgz';
fs.writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n');
JS
    npm install --package-lock-only --offline --ignore-scripts --no-audit --no-fund
    npm ci --offline --ignore-scripts --no-audit --no-fund
    node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(path.resolve('package.json'));
const installed = path.resolve('node_modules/@andornaut/game-kit');
assert(!fs.lstatSync(installed).isSymbolicLink(), 'Tarball installation must be a directory');
assert.equal(fs.realpathSync(installed), installed);
assert.equal(fs.readFileSync(`${installed}/SOURCE_COMMIT`, 'utf8').trim(), process.env.EXPECTED_KIT_COMMIT);
const manifest = JSON.parse(fs.readFileSync(`${installed}/package.json`, 'utf8'));
assert.equal(manifest.name, '@andornaut/game-kit');
assert.equal(manifest.version, process.env.EXPECTED_KIT_VERSION);
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const entry = lock.packages['node_modules/@andornaut/game-kit'];
assert(entry.resolved.startsWith('file:'));
assert.equal(fs.realpathSync(path.resolve(entry.resolved.slice(5))), '/assets/release.tgz');
assert(!entry.link);
const integrity = `sha512-${crypto.createHash('sha512').update(fs.readFileSync('/assets/release.tgz')).digest('base64')}`;
assert.equal(entry.integrity, integrity);
function compare(reference, actual) {
  const names = fs.readdirSync(reference).sort();
  assert.deepEqual(fs.readdirSync(actual).sort(), names);
  for (const name of names) {
    const from = path.join(reference, name), to = path.join(actual, name);
    assert(!fs.lstatSync(to).isSymbolicLink());
    if (fs.statSync(from).isDirectory()) compare(from, to);
    else assert(fs.readFileSync(from).equals(fs.readFileSync(to)), `Payload differs: ${to}`);
  }
}
compare('/scratch/reference/package', installed);
function targets(value) {
  if (typeof value === 'string') return [value];
  return Object.values(value ?? {}).flatMap(targets);
}
for (const target of targets(manifest.exports)) {
  assert(target.startsWith('./') && !target.split('/').includes('..'));
  assert(!/(?<!\.d)\.[cm]?tsx?$/.test(target), `Runtime TypeScript export: ${target}`);
  assert(fs.statSync(path.join(installed, target)).isFile(), `Missing export: ${target}`);
}
for (const [subpath, entry] of Object.entries(manifest.exports)) {
  if (typeof entry === 'string' && entry.endsWith('.css')) {
    const resolved = require.resolve(`@andornaut/game-kit/${subpath.slice(2)}`);
    assert(resolved.startsWith(installed + path.sep));
    assert(fs.readFileSync(resolved, 'utf8').trim().length > 0);
  }
}
for (const subpath of ['src/numbers.ts', 'dist/numbers.js', 'SOURCE_COMMIT']) {
  assert.throws(() => require.resolve(`@andornaut/game-kit/${subpath}`), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
}
console.log(JSON.stringify({ source: process.env.EXPECTED_KIT_COMMIT, package: entry }));
JS
    # Ensure TypeScript actually resolves kit imports into the installed tarball.
    node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
assert(!config.error);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());
assert.equal(parsed.errors.length, 0);
let imports = 0;
for (const file of parsed.fileNames) {
  if (file.includes('/vendor/')) continue;
  const source = ts.preProcessFile(fs.readFileSync(file, 'utf8'), true, true);
  for (const { fileName: specifier } of source.importedFiles) {
    if (!specifier.startsWith('@andornaut/game-kit/')) continue;
    if (specifier.endsWith('.css')) continue;
    const resolved = ts.resolveModuleName(specifier, file, parsed.options, ts.sys).resolvedModule;
    assert(resolved, `Unresolved kit import: ${specifier}`);
    assert(fs.realpathSync(resolved.resolvedFileName).startsWith(path.resolve('node_modules/@andornaut/game-kit') + path.sep), `Source alias bypasses artifact: ${specifier}`);
    imports++;
  }
}
assert(imports > 0, 'Consumer must use kit imports');
console.log(`Verified ${imports} TypeScript imports resolve into the installed artifact`);
JS
    npm run check
    # Native Node imports must work without tsx or source aliases.
    node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { clamp, lerp } from '@andornaut/game-kit/numbers';
import { advanceWidth } from '@andornaut/game-kit/text/bitmapFont';
import { createProgressState } from '@andornaut/game-kit/progressState';
import { memoryStorage } from '@andornaut/game-kit/save/storage';
const storage = memoryStorage();
await storage.write('proof', 'value');
assert.equal(await storage.read('proof'), 'value');
assert.equal(clamp(0, 1, 2), 1);
assert.equal(lerp(2, 6, 2), 10);
assert.equal(typeof advanceWidth, 'function');
createProgressState().begin().finish();
JS
    # Load the real consumer config through both entry points without a build or test run.
    node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfigFromFile } from 'vite';
import { createVitest } from 'vitest/node';
const viteConfig = path.resolve('vite.config.ts');
assert(fs.existsSync(viteConfig));
assert(await loadConfigFromFile({ command: 'build', mode: 'test' }, viteConfig));
const testConfig = fs.existsSync('vitest.config.ts') ? path.resolve('vitest.config.ts') : viteConfig;
const ctx = await createVitest('test', { config: testConfig, watch: false, maxWorkers: 4 });
await ctx.close();
console.log('Native Node, Vite and Vitest config bootstrap passed');
JS
    if [ "$game" = dog ]; then
      node_modules/.bin/vitest run src/home/modalLayout.test.ts --maxWorkers=4
    else
      node_modules/.bin/vitest run src/view/mapMarks.test.ts --maxWorkers=4
    fi
  ) >"/scratch/$game.log" 2>&1
  result=$?
  set -e
  if [ "$result" = 0 ]; then
    echo PASS >"/scratch/$game.RESULT"
    echo "$game release proof passed at $revision with kit $source_revision"
  else
    echo FAIL >"/scratch/$game.RESULT"
    echo "$game release proof failed at $revision; see $game.log" >&2
    failed=1
  fi
done
exit "$failed"
