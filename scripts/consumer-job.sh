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
    node_modules/.bin/vitest run vendor/game-kit/src/build/vite/gameConfig.test.ts --maxWorkers=4
    node_modules/.bin/tsx --eval 'import {seededRandom} from "@andornaut/game-kit/random"; import {createProgressState} from "@andornaut/game-kit/progressState"; createProgressState().begin().finish(); if(typeof seededRandom(1)()!=="number")throw new Error("Native tsx import failed");'
    node -e 'const r=require("node:module").createRequire(process.cwd()+"/package.json");r.resolve("@andornaut/game-kit/view/frameTurnPortraitGame.css");try{r.resolve("@andornaut/game-kit/src/random.ts");throw new Error("Private source exposed")}catch(e){if(e.code!=="ERR_PACKAGE_PATH_NOT_EXPORTED")throw e}'
  ) >"/scratch/$game.log" 2>&1
  echo "$game type/package checks passed at $revision with kit $kit_revision"
done
