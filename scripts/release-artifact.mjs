// Exercise the packed package through native node_modules resolution.
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
for (const dependency of ["vite", "vitest", "typescript", "phaser"]) {
  symlinkSync(
    resolve(root, "node_modules", dependency),
    join(consumer, "node_modules", dependency),
  );
}
const manifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
assert.equal(manifest.version, JSON.parse(readFileSync("package.json", "utf8")).version);
assert.deepEqual(
  Object.keys(manifest.exports),
  Object.keys(JSON.parse(readFileSync("package.json", "utf8")).exports),
);
for (const entry of Object.values(manifest.exports)) {
  for (const target of typeof entry === "string" ? [entry] : Object.values(entry)) {
    assert.ok(existsSync(resolve(installed, target)), target);
  }
}
assert.equal(manifest.license, "MIT");
assert.deepEqual(manifest.exports["./build/buildInfo"], { types: "./dist/build/buildInfo.d.ts" });
for (const file of result[0].files) {
  assert.ok(!file.path.endsWith(".ts") || file.path.endsWith(".d.ts"), file.path);
  assert.ok(!file.path.includes(".test."), file.path);
}
writeFileSync(join(consumer, "package.json"), JSON.stringify({ type: "module", version: "1.2.3" }));
writeFileSync(join(consumer, "modules.ts"), 'export { clamp } from "@andornaut/game-kit/numbers";');
writeFileSync(
  join(consumer, "vite.config.ts"),
  `
import { gameViteConfig } from '@andornaut/game-kit/build/vite/gameConfig';
export default gameViteConfig({repoRoot: import.meta.dirname, configModules:'modules.ts', pages:{},
chunkSizeWarningLimit:500, previewHost:undefined, testTimeout:1000,
plugins:(modules)=>{ if(modules.clamp(0,1,2)!==1) throw Error('runner import failed'); return []; }});
`,
);
writeFileSync(
  join(consumer, "bootstrap.mjs"),
  `
import assert from 'node:assert/strict';
import { createProgressState } from '@andornaut/game-kit/progressState';
import { loadConfigFromFile } from 'vite';
assert.equal(typeof createProgressState, 'function');
assert.ok(import.meta.resolve('@andornaut/game-kit/crash/crash.css').endsWith('/dist/crash/crash.css'));
assert.throws(()=>import.meta.resolve('@andornaut/game-kit/src/numbers.ts'), {code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
assert.throws(()=>import.meta.resolve('@andornaut/game-kit/build/buildInfo'), {code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
const loaded=await loadConfigFromFile(
  {command:'build',mode:'production'}, undefined, process.cwd(), 'silent', undefined, 'native');
assert.ok(loaded);
assert.equal(loaded.config.define.__APP_VERSION__, '"1.2.3"');
`,
);
execFileSync(process.execPath, ["bootstrap.mjs"], {
  cwd: consumer,
  stdio: "inherit",
  env: { ...process.env, WORKERS_CI_COMMIT_SHA: "1234567890123456789012345678901234567890" },
});
console.log("Packed artifact native Node and Vite bootstrap passed.");
