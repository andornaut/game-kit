#!/usr/bin/env bash
# Shared exact-revision payload operations for sync and compatibility jobs.
export_package_payload() {
  local repository=$1 revision=$2 destination=$3
  mkdir -p "$destination"
  if git -C "$repository" cat-file -e "$revision:kit/package.json" 2>/dev/null; then
    git -C "$repository" archive "$revision" kit/ | tar -x --strip-components=1 -C "$destination"
  else
    git -C "$repository" archive "$revision" src/ package.json README.md LICENSE | tar -x -C "$destination"
    if git -C "$repository" cat-file -e "$revision:scripts/vendor-manifest.mjs" 2>/dev/null; then
      local transform
      transform=$(mktemp)
      git -C "$repository" show "$revision:scripts/vendor-manifest.mjs" >"$transform"
      node --input-type=module - "$destination/package.json" <"$transform"
      find "$transform" -delete
    fi
  fi
}

install_package_payload() (
  set -euo pipefail
  local payload=$1 revision=$2 destination=$3
  [ ! -L "$destination" ] || { echo "Refusing a symlink vendor directory: $destination" >&2; return 1; }
  local stage backup installed=false moved=false
  mkdir -p "$(dirname "$destination")"
  stage=$(mktemp -d "$destination.stage.XXXXXXXX")
  backup=$(mktemp -d "$destination.backup.XXXXXXXX")
  finish_payload() {
    local result=$?
    trap - EXIT
    if $moved && ! $installed; then
      if ! mv -T -- "$backup/payload" "$destination"; then
        echo 'Payload replacement failed; the previous payload is retained in its backup directory.' >&2
        exit 1
      fi
    fi
    if [ -d "$stage" ]; then
      find "$stage" -depth -delete
    fi
    find "$backup" -depth -delete
    exit "$result"
  }
  trap finish_payload EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  cp -a "$payload/." "$stage/"
  printf '%s\n' "$revision" >"$stage/KIT_COMMIT"
  if [ -e "$destination" ]; then
    mv -T -- "$destination" "$backup/payload"
    moved=true
  fi
  mv -T -- "$stage" "$destination"
  installed=true
)
