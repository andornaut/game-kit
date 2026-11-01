#!/usr/bin/env bash
# Shared exact-revision payload operations for sync and compatibility jobs.
export_package_payload() {
  local repository=$1 revision=$2 destination=$3
  mkdir -p "$destination"
  if git -C "$repository" cat-file -e "$revision:kit/package.json" 2>/dev/null; then
    git -C "$repository" archive "$revision" kit/ | tar -x --strip-components=1 -C "$destination"
  else
    git -C "$repository" archive "$revision" src/ package.json README.md LICENSE | tar -x -C "$destination"
  fi
}

install_package_payload() {
  local payload=$1 revision=$2 destination=$3
  [ ! -L "$destination" ] || { echo "Refusing a symlink vendor directory: $destination" >&2; return 1; }
  mkdir -p "$destination"
  find "$destination" -depth -mindepth 1 ! -path "$destination/KIT_COMMIT" -delete
  cp -a "$payload/." "$destination/"
  echo "$revision" >"$destination/KIT_COMMIT"
}
