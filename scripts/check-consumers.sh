#!/usr/bin/env bash
# Run exact-revision consumer type checks in disposable offline snapshots.
set -euo pipefail
[ "$#" = 4 ] || { echo "Usage: $0 <Dog repository> <Dog revision> <Duck repository> <Duck revision>" >&2; exit 2; }
kit_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
. "$kit_root/scripts/check-runtime.sh"
check_image=$(node_check_image "$kit_root")
kit_revision=$(git -C "$kit_root" rev-parse HEAD)
dog_repository=$1 dog_revision=$(git -C "$1" rev-parse "$2^{commit}")
duck_repository=$3 duck_revision=$(git -C "$3" rev-parse "$4^{commit}")
kit_git=$(git -C "$kit_root" rev-parse --path-format=absolute --git-common-dir)
dog_git=$(git -C "$dog_repository" rev-parse --path-format=absolute --git-common-dir)
duck_git=$(git -C "$duck_repository" rev-parse --path-format=absolute --git-common-dir)
check_cache=${GAME_KIT_NPM_CACHE:-$kit_root/.claude/npm-cache}
mkdir -p "$kit_root/.claude"
check_output=$(mktemp -d "$kit_root/.claude/consumer-check.XXXXXXXX")
mkdir -p "$check_cache"
require_load
printf 'kit=%s\ndog=%s\nduck=%s\n' "$kit_revision" "$dog_revision" "$duck_revision" >"$check_output/revisions.txt"
docker run --rm --read-only --cpus 4 --network none -u "$(id -u):$(id -g)" \
  -v "$kit_root:/kit:ro" -v "$kit_git:/repos/kit.git:ro" \
  -v "$dog_git:/repos/dog.git:ro" -v "$duck_git:/repos/duck.git:ro" \
  -v "$check_cache:/cache:ro" -v "$check_output:/scratch" \
  --tmpfs "/tmp:exec,uid=$(id -u),gid=$(id -g)" \
  -e npm_config_cache=/cache -e npm_config_logs_dir=/scratch/npm-logs \
  "$check_image" bash -ec '
    mkdir -p /scratch/kit
    git -C /repos/kit.git archive "$1" | tar -x -C /scratch/kit
    bash /scratch/kit/scripts/consumer-job.sh "$@"
  ' -- "$kit_revision" "$dog_revision" "$duck_revision"
echo "Compatibility results: $check_output"
