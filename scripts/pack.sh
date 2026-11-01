#!/usr/bin/env bash
# Build a committed npm-compatible release asset without registry publication.
set -euo pipefail
[[ $# = 1 ]] || { echo 'Usage: pack.sh <output-directory>' >&2; exit 2; }
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
. "$root/scripts/check-runtime.sh"
require_load
image=$(node_check_image "$root")
revision=$(git -C "$root" rev-parse HEAD)
source_epoch=$(git -C "$root" show -s --format=%ct "$revision")
mkdir -p "$1" "$root/.claude"
output=$(realpath "$1")
# CLEANUP (added 2026-11-01): retain snapshots until their release artifacts are verified.
scratch=$(mktemp -d "$root/.claude/release.XXXXXXXX")
git -C "$root" archive "$revision" src package.json README.md LICENSE scripts/vendor-manifest.mjs | tar -x -C "$scratch"
printf '%s\n' "$revision" > "$scratch/SOURCE_COMMIT"
docker run --rm --read-only --network none --cpus 4 -u "$(id -u):$(id -g)" \
  --mount "type=bind,source=$scratch,target=/package" \
  --mount "type=bind,source=$output,target=/out" \
  --tmpfs "/tmp:exec,uid=$(id -u),gid=$(id -g)" \
  -e HOME=/tmp -e "SOURCE_DATE_EPOCH=$source_epoch" -e npm_config_cache=/tmp/npm-cache -w /package "$image" sh -ec '
    node scripts/vendor-manifest.mjs package.json
    find src -type f -name "*.test.ts" -delete
    version=$(node -p "JSON.parse(require('\''fs'\'').readFileSync('\''package.json'\'')).version")
    npm pack --offline --ignore-scripts --json --pack-destination /out > /out/pack.json
    mv "/out/andornaut-game-kit-$version.tgz" "/out/game-kit-$version.tgz"
    cp SOURCE_COMMIT /out/SOURCE_COMMIT
    cd /out
    sha256sum "game-kit-$version.tgz" > SHA256SUMS
  '
echo "Release artifacts: $output"
