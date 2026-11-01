#!/usr/bin/env bash
# Shared resource policy for the standalone and exact-consumer jobs.
node_check_image() {
  printf 'node:%s\n' "$(cat "$1/.nvmrc")"
}

require_load() {
  if ! LC_ALL=C uptime | awk '
    match($0, /load averages?: /) {
      found = 1
      split(substr($0, RSTART + RLENGTH), values, /[ ,]+/)
      exit !(values[1] ~ /^[0-9]+([.][0-9]+)?$/ && values[1] + 0 < 24)
    }
    END { if (!found) exit 1 }
  '; then
    echo 'One-minute load must be available and below 24 before starting a container.' >&2
    exit 1
  fi
}

