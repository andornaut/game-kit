#!/usr/bin/env bash
# Copies the kit, as committed at this repository's HEAD, into a game's vendor/game-kit/, and
# writes the commit to vendor/game-kit/KIT_COMMIT. Files in vendor/game-kit/ that the kit does
# not have are removed; nothing outside vendor/game-kit/ is touched.
#
# Usage: scripts/sync-into.sh [--check] <game repository or worktree>
#
# --check copies nothing: it exits 1 when the game's vendor/game-kit/ differs from the kit at
# the commit its KIT_COMMIT names, or when KIT_COMMIT is missing or names no commit here.
set -euo pipefail

usage() {
  echo "Usage: $0 [--check] <game repository or worktree>" >&2
  exit 2
}

check=false
game=""
for arg in "$@"; do
  case "$arg" in
    --check) check=true ;;
    -*) usage ;;
    *)
      [ -z "$game" ] || usage
      game=$arg
      ;;
  esac
done
[ -n "$game" ] || usage
[ -d "$game" ] || {
  echo "Not a directory: $game" >&2
  exit 2
}

kit_repo=$(cd "$(dirname "$0")/.." && pwd)
vendor="$(cd "$game" && pwd)/vendor/game-kit"
scratch=$(mktemp -d)
trap 'find "$scratch" -depth -delete' EXIT

# Export the package payload, including commits with the nested source layout.
export_kit() {
  mkdir -p "$scratch/kit"
  if git -C "$kit_repo" cat-file -e "$1:kit/package.json" 2>/dev/null; then
    git -C "$kit_repo" archive "$1" kit/ | tar -x --strip-components=1 -C "$scratch/kit"
  else
    git -C "$kit_repo" archive "$1" src/ package.json README.md LICENSE | tar -x -C "$scratch/kit"
  fi
}

if $check; then
  if [ ! -f "$vendor/KIT_COMMIT" ]; then
    echo "No $vendor/KIT_COMMIT" >&2
    exit 1
  fi
  commit=$(cat "$vendor/KIT_COMMIT")
  if ! git -C "$kit_repo" cat-file -e "$commit^{commit}" 2>/dev/null; then
    echo "KIT_COMMIT $commit is not a commit in $kit_repo" >&2
    exit 1
  fi
  export_kit "$commit"
  echo "$commit" >"$scratch/kit/KIT_COMMIT"
  if diff -r "$scratch/kit" "$vendor"; then
    echo "$vendor matches game-kit $commit"
  else
    echo "$vendor differs from game-kit $commit" >&2
    exit 1
  fi
  exit 0
fi

if [ -n "$(git -C "$kit_repo" status --porcelain -- src package.json README.md LICENSE)" ]; then
  echo "The package has uncommitted changes; the sync copies HEAD." >&2
fi
commit=$(git -C "$kit_repo" rev-parse HEAD)
export_kit "$commit"
mkdir -p "$vendor"
# Replace only this package's payload, preserving its revision marker until copying succeeds.
[ ! -L "$vendor" ] || { echo "Refusing a symlink vendor directory: $vendor" >&2; exit 1; }
find "$vendor" -depth -mindepth 1 ! -path "$vendor/KIT_COMMIT" -delete
cp -a "$scratch/kit/." "$vendor/"
echo "$commit" >"$vendor/KIT_COMMIT"
echo "Copied game-kit $commit into $vendor"
