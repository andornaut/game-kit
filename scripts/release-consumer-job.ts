// Container-only implementation. Never run against a live consumer checkout.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  closeSync,
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
const GAMES = ["archie", "chibi"] as const;
type Game = (typeof GAMES)[number];
const GAME_NAMES: Record<Game, string> = { archie: "Archie", chibi: "Chibi" };
/** The npm script each game defines to test its kit wiring against the installed artifact. */
export const GAME_KIT_TEST_SCRIPT = "test:game-kit";

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

/** Fail unless the pinned consumer snapshot defines its kit wiring test script. */
export function requireGameKitTest(game: Game, work: string): void {
  const manifest = JSON.parse(readFileSync(join(work, "package.json"), "utf8"));
  if (typeof manifest.scripts?.[GAME_KIT_TEST_SCRIPT] !== "string") {
    throw new ScriptError(
      `The pinned ${GAME_NAMES[game]} snapshot defines no "${GAME_KIT_TEST_SCRIPT}" npm script`,
    );
  }
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
// The gate checks the tarball's exports, native imports and declarations; this probe proves the
// installation holds exactly those bytes.
const INSTALLED_ARTIFACT_PROBE = `
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
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
    requireGameKitTest(game, work);
    adoptArtifact(ARTIFACT, work);
    run("npm", ["install", "--package-lock-only", ...NPM_OFFLINE]);
    run("npm", ["ci", ...NPM_OFFLINE]);
    probe(INSTALLED_ARTIFACT_PROBE);
    probe(TYPESCRIPT_RESOLUTION_PROBE);
    run("npm", ["run", "check"]);
    probe(CONFIG_BOOTSTRAP_PROBE);
    run("npm", ["run", GAME_KIT_TEST_SCRIPT, "--", "--maxWorkers=4"]);
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
  const single = args[0] === "--game";
  if ((single && args.length !== 6) || (!single && args.length !== 5)) {
    throw new ScriptError(
      "Usage: release-consumer-job.ts <sha256> <source> <version> <archie> <chibi> " +
        "or --game <archie|chibi> <sha256> <source> <version> <revision>",
      2,
    );
  }
  const game = args[1];
  if (single && game !== "archie" && game !== "chibi") {
    throw new ScriptError(`Unsupported game selection: ${game}`, 2);
  }
  const [hash, sourceRevision, version] = args.slice(single ? 2 : 0, single ? 5 : 3) as [
    string,
    string,
    string,
  ];
  const selected = single
    ? [{ game: game as Game, revision: args[5]! }]
    : GAMES.map((game, index) => ({ game, revision: args[index + 3]! }));
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
  const scope = single ? "incomplete-release-proof" : "complete-release-proof";
  writeFileSync(
    join(EVIDENCE, "scope.json"),
    `${JSON.stringify({ selectedGames: selected.map(({ game }) => game), scope })}\n`,
  );
  console.log(
    `Consumer proof scope: ${scope}; selected_games=${selected.map(({ game }) => game).join(",")}`,
  );
  let failed = false;
  for (const { game, revision } of selected) {
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
