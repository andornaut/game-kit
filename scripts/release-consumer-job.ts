// Container-only implementation. Never run against a live consumer checkout.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { main, nodeImage, ScriptError } from "./runtime.ts";

const ARTIFACT = "/assets/release.tgz";
/** Retained evidence: listings, logs and results. */
const EVIDENCE = "/tmp/scratch";
/** Disposable consumer snapshots, caches and the reference payload. */
const WORK = "/tmp/work";
const GAMES = ["dog", "duck"] as const;
type Game = (typeof GAMES)[number];
/** Each game's focused test of its kit wiring, run against the installed artifact. */
const CALLER_TESTS: Record<Game, { name: string; test: string }> = {
  dog: { name: "Archie", test: "src/home/modalLayout.test.ts" },
  duck: { name: "Chibi", test: "src/rules/behaviourTraversalGoals.test.ts" },
};

/** Archive members must stay under package/ without parent segments. */
export function unsafeArchivePaths(listing: string): string[] {
  return listing
    .split("\n")
    .filter((line) => line !== "")
    .filter((line) => !line.startsWith("package/") || line.split("/").includes(".."));
}

/** Only regular files and directories may be extracted. */
export function unsafeArchiveModes(verboseListing: string): string[] {
  return verboseListing
    .split("\n")
    .filter((line) => line !== "")
    .filter((line) => !["-", "d"].includes(line.charAt(0)));
}

/** The focused caller test for one pinned consumer snapshot. */
export function callerTest(game: Game, work: string): string {
  const { name, test } = CALLER_TESTS[game];
  if (!existsSync(join(work, test))) {
    throw new ScriptError(`The pinned ${name} snapshot has no caller test ${test}`);
  }
  return test;
}

/** Adapt only the disposable manifest to install the exact tarball. */
export function adoptArtifact(artifact: string, work: string): void {
  const path = join(work, "package.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  if (!manifest.dependencies?.["@andornaut/game-kit"]) {
    throw new Error("Consumer must declare game-kit");
  }
  manifest.dependencies["@andornaut/game-kit"] = `file:${artifact}`;
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

// Probes run as consumer-rooted modules so bare imports resolve from the consumer snapshot.
const INSTALLED_ARTIFACT_PROBE = `
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(path.resolve('package.json'));
const installed = path.resolve('node_modules/@andornaut/game-kit');
assert(!fs.lstatSync(installed).isSymbolicLink(), 'Tarball installation must be a directory');
assert.equal(fs.realpathSync(installed), installed);
assert.equal(fs.readFileSync(installed + '/SOURCE_COMMIT', 'utf8').trim(), process.env.EXPECTED_KIT_COMMIT);
const manifest = JSON.parse(fs.readFileSync(installed + '/package.json', 'utf8'));
assert.equal(manifest.name, '@andornaut/game-kit');
assert.equal(manifest.version, process.env.EXPECTED_KIT_VERSION);
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const entry = lock.packages['node_modules/@andornaut/game-kit'];
assert(entry.resolved.startsWith('file:'));
assert.equal(fs.realpathSync(path.resolve(entry.resolved.slice(5))), '${ARTIFACT}');
assert(!entry.link);
const integrity = 'sha512-' + crypto.createHash('sha512').update(fs.readFileSync('${ARTIFACT}')).digest('base64');
assert.equal(entry.integrity, integrity);
function compare(reference, actual) {
  const names = fs.readdirSync(reference).sort();
  assert.deepEqual(fs.readdirSync(actual).sort(), names);
  for (const name of names) {
    const from = path.join(reference, name), to = path.join(actual, name);
    assert(!fs.lstatSync(to).isSymbolicLink());
    if (fs.statSync(from).isDirectory()) compare(from, to);
    else assert(fs.readFileSync(from).equals(fs.readFileSync(to)), 'Payload differs: ' + to);
  }
}
compare('${WORK}/reference/package', installed);
function targets(value) {
  if (typeof value === 'string') return [value];
  return Object.values(value ?? {}).flatMap(targets);
}
for (const target of targets(manifest.exports)) {
  assert(target.startsWith('./') && !target.split('/').includes('..'));
  assert(!/(?<!\\.d)\\.[cm]?tsx?$/.test(target), 'Runtime TypeScript export: ' + target);
  assert(fs.statSync(path.join(installed, target)).isFile(), 'Missing export: ' + target);
}
for (const [subpath, entry] of Object.entries(manifest.exports)) {
  if (typeof entry === 'string' && entry.endsWith('.css')) {
    const resolved = require.resolve('@andornaut/game-kit/' + subpath.slice(2));
    assert(resolved.startsWith(installed + path.sep));
    assert(fs.readFileSync(resolved, 'utf8').trim().length > 0);
  }
}
for (const subpath of ['src/numbers.ts', 'dist/numbers.js', 'SOURCE_COMMIT']) {
  assert.throws(() => require.resolve('@andornaut/game-kit/' + subpath), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
}
console.log(JSON.stringify({ source: process.env.EXPECTED_KIT_COMMIT, package: entry }));
`;

// Ensure TypeScript actually resolves kit imports into the installed tarball.
const TYPESCRIPT_RESOLUTION_PROBE = `
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
    assert(resolved, 'Unresolved kit import: ' + specifier);
    const installed = path.resolve('node_modules/@andornaut/game-kit') + path.sep;
    assert(
      fs.realpathSync(resolved.resolvedFileName).startsWith(installed),
      'Source alias bypasses artifact: ' + specifier,
    );
    imports++;
  }
}
assert(imports > 0, 'Consumer must use kit imports');
console.log('Verified ' + imports + ' TypeScript imports resolve into the installed artifact');
`;

// Native Node imports must work without tsx or source aliases.
const NATIVE_IMPORT_PROBE = `
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
`;

// Load the real consumer config through both entry points without a build or test run.
const CONFIG_BOOTSTRAP_PROBE = `
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
`;

const NPM_OFFLINE = ["--offline", "--ignore-scripts", "--no-audit", "--no-fund"];

function proveGame(
  context: { revision: string; sourceRevision: string; version: string },
  game: Game,
): boolean {
  const work = join(WORK, game);
  const cache = join(WORK, `cache-${game}`);
  const log = openSync(join(EVIDENCE, `${game}.log`), "w");
  const env = {
    ...process.env,
    EXPECTED_KIT_COMMIT: context.sourceRevision,
    EXPECTED_KIT_VERSION: context.version,
    npm_config_cache: cache,
  };
  const run = (command: string, args: string[]) => {
    const result = spawnSync(command, args, { cwd: work, env, stdio: ["ignore", log, log] });
    if (result.status !== 0) {
      throw new Error(`${command} ${args.join(" ")} exited with status ${result.status}`);
    }
  };
  const probe = (source: string) => run(process.execPath, ["--input-type=module", "-e", source]);
  try {
    mkdirSync(work, { recursive: true });
    mkdirSync(cache, { recursive: true });
    // Separate writable cache, populated from the owner's read-only offline store.
    run("cp", ["-a", "--reflink=auto", `/caches/${game}/_cacache`, `${cache}/`]);
    const repository = `/repos/${game}.git`;
    const snapshot = execFileSync(
      "git",
      [
        ...["-c", `safe.directory=${repository}`, "-C", repository],
        ...["archive", context.revision],
      ],
      { maxBuffer: 1 << 30 },
    );
    execFileSync("tar", ["-x", "-C", work], { input: snapshot });
    adoptArtifact(ARTIFACT, work);
    run("npm", ["install", "--package-lock-only", ...NPM_OFFLINE]);
    run("npm", ["ci", ...NPM_OFFLINE]);
    probe(INSTALLED_ARTIFACT_PROBE);
    probe(TYPESCRIPT_RESOLUTION_PROBE);
    run("npm", ["run", "check"]);
    probe(NATIVE_IMPORT_PROBE);
    probe(CONFIG_BOOTSTRAP_PROBE);
    run("node_modules/.bin/vitest", ["run", callerTest(game, work), "--maxWorkers=4"]);
    return true;
  } catch (error) {
    appendFileSync(log, `${error instanceof Error ? error.message : String(error)}\n`);
    return false;
  } finally {
    closeSync(log);
  }
}

export function releaseConsumerJob(args: string[]): void {
  const expectedNode = `v${nodeImage("/harness").slice("node:".length)}`;
  assert.equal(process.version, expectedNode);
  if (args.length !== 5) {
    throw new ScriptError(
      "Usage: release-consumer-job.ts <sha256> <source> <version> <dog> <duck>",
      2,
    );
  }
  const [hash, sourceRevision, version, dogRevision, duckRevision] = args as [
    string,
    string,
    string,
    string,
    string,
  ];
  assert.equal(createHash("sha256").update(readFileSync(ARTIFACT)).digest("hex"), hash);
  const reference = join(WORK, "reference");
  mkdirSync(EVIDENCE, { recursive: true });
  mkdirSync(reference, { recursive: true });
  writeFileSync(join(EVIDENCE, "npm-user-config"), "");
  writeFileSync(join(EVIDENCE, "npm-global-config"), "");
  // Validate archive paths before extraction, including link and special-file refusal.
  const files = execFileSync("tar", ["-tzf", ARTIFACT], { encoding: "utf8" });
  writeFileSync(join(EVIDENCE, "artifact-files.txt"), files);
  assert.deepEqual(unsafeArchivePaths(files), []);
  const modes = execFileSync("tar", ["-tvzf", ARTIFACT], { encoding: "utf8" });
  writeFileSync(join(EVIDENCE, "artifact-modes.txt"), modes);
  assert.deepEqual(unsafeArchiveModes(modes), []);
  execFileSync("tar", ["-xzf", ARTIFACT, "-C", reference, "--no-same-owner"]);
  let failed = false;
  for (const game of GAMES) {
    const revision = game === "dog" ? dogRevision : duckRevision;
    if (proveGame({ revision, sourceRevision, version }, game)) {
      writeFileSync(join(EVIDENCE, `${game}.RESULT`), "PASS\n");
      console.log(`${game} release proof passed at ${revision} with kit ${sourceRevision}`);
    } else {
      writeFileSync(join(EVIDENCE, `${game}.RESULT`), "FAIL\n");
      console.error(`${game} release proof failed at ${revision}; see ${game}.log`);
      failed = true;
    }
  }
  if (failed) {
    throw new ScriptError("Release consumer proof failed.");
  }
}

main(import.meta.url, releaseConsumerJob);
