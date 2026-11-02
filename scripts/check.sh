#!/usr/bin/env bash
set -euo pipefail

check_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
. "$check_root/scripts/check-runtime.sh"
check_cache=${GAME_KIT_NPM_CACHE:-$check_root/.claude/npm-cache}
check_uid=$(id -u)
check_gid=$(id -g)
check_image=$(node_check_image "$check_root")
cd -- "$check_root"

fingerprint() {
  python3 "$check_root/scripts/source-fingerprint.py" "$check_root"
}

mkdir -p "$check_root/.claude"
check_before=$(fingerprint)
# CLEANUP (added 2026-11-01): retain artifact evidence until release review accepts it.
check_evidence=$(mktemp -d "$check_root/.claude/artifact-check.XXXXXXXX")
finish() {
  local result=$?
  trap - EXIT
  local after
  if ! after=$(fingerprint); then
    echo 'Cannot verify source fingerprints; discard the gate result.' >&2
    exit 1
  fi
  if [[ "$check_before" != "$after" ]]; then
    echo 'Source changed during verification; discard the gate result.' >&2
    exit 1
  fi
  exit "$result"
}
trap finish EXIT

# Only the npm cache persists; dependencies and temporary files live in container tmpfs.
mkdir -p -- "$check_cache" "$check_root/node_modules"
check_container=(
  docker run --rm --read-only --cpus 4
  -u "$check_uid:$check_gid"
  -e HOME=/tmp -e npm_config_cache=/npmcache
  -e "WORKERS_CI_COMMIT_SHA=$(git rev-parse HEAD)"
  -v "$check_root:/app:ro" -v "$check_cache:/npmcache"
  -v "$check_evidence:/evidence" -e GAME_KIT_ARTIFACT_EVIDENCE=/evidence
  -w /app
  --tmpfs "/tmp:exec,uid=$check_uid,gid=$check_gid"
  --tmpfs "/app/node_modules:exec,uid=$check_uid,gid=$check_gid"
)

require_load
echo 'Populating the project npm cache in a container.'
"${check_container[@]}" "$check_image" npm ci --ignore-scripts --no-audit --no-fund

require_load
echo 'Checking types, lint and tests offline in a fresh container.'
"${check_container[@]}" --network none "$check_image" sh -ec '
  npm ci --offline --ignore-scripts --no-audit --no-fund
  npm run check
  npm run lint
  npm test -- --maxWorkers=4
  node scripts/release-artifact.mjs
'
