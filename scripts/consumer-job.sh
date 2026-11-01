#!/usr/bin/env bash
# Called only by the isolated two-consumer job.
set -euo pipefail
job_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
. "$job_root/scripts/package-payload.sh"
kit_revision=$1
export_package_payload /repos/kit.git "$kit_revision" /scratch/payload
for game in dog duck; do
  if [ "$game" = dog ]; then revision=$2; else revision=$3; fi
  work=/scratch/$game
  mkdir -p "$work"
  git -C "/repos/$game.git" archive "$revision" | tar -x -C "$work"
  install_package_payload /scratch/payload "$kit_revision" "$work/vendor/game-kit"
  (
    cd "$work"
    # The supplied revisions must use the local package, not a source alias.
    node --input-type=module -e 'import fs from "node:fs";const p=JSON.parse(fs.readFileSync("package.json"));if(p.dependencies?.["@andornaut/game-kit"]!=="file:vendor/game-kit")throw new Error("Consumer revision must declare file:vendor/game-kit");'
    npm install --package-lock-only --offline --ignore-scripts --no-audit --no-fund
    npm ci --offline --ignore-scripts --no-audit --no-fund
    npm run check
    # Bootstrap the real client configuration without executing library tests in the game.
    node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadConfigFromFile } from 'vite';
const loaded = await loadConfigFromFile(
  { command: 'build', mode: 'test' }, undefined, process.cwd(), 'silent', undefined, 'native');
assert(loaded, 'Client Vite configuration did not load');
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
assert.equal(loaded.config.define?.__APP_VERSION__, JSON.stringify(version));
JS
    node_modules/.bin/tsx --eval 'import "@andornaut/game-kit/random"; import "@andornaut/game-kit/progressState";'
    node -e 'const r=require("node:module").createRequire(process.cwd()+"/package.json");r.resolve("@andornaut/game-kit/view/frameTurnPortraitGame.css");try{r.resolve("@andornaut/game-kit/src/random.ts");throw new Error("Private source exposed")}catch(e){if(e.code!=="ERR_PACKAGE_PATH_NOT_EXPORTED")throw e}'
  ) >"/scratch/$game.log" 2>&1
  echo "$game type/package checks passed at $revision with kit $kit_revision"
done
