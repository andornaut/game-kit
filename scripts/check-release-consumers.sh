#!/usr/bin/env bash
# Prove one tarball against immutable offline consumer snapshots; preserve evidence.
# GAME_KIT_DOG_CACHE and GAME_KIT_DUCK_CACHE override populated read-only caches.
set -euo pipefail
[ "$#" = 7 ] || { echo "Usage: $0 <artifact.tgz> <sha256> <source-commit> <Dog repository> <Dog revision> <Duck repository> <Duck revision>" >&2; exit 2; }
kit_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
. "$kit_root/scripts/check-runtime.sh"
artifact=$(realpath -e -- "$1")
expected_hash=$2
source_revision=$(git -C "$kit_root" rev-parse --verify "$3^{commit}")
expected_version=$(git -C "$kit_root" show "$source_revision:package.json" | python3 -c '
import json, re, sys
manifest = json.load(sys.stdin)
if manifest.get("name") != "@andornaut/game-kit":
    raise SystemExit("Source revision is not @andornaut/game-kit")
version = manifest.get("version", "")
if not isinstance(version, str) or not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version):
    raise SystemExit("Source revision has no exact release version")
print(version)
')
dog_repository=$(realpath -e -- "$4")
dog_revision=$(git -C "$dog_repository" rev-parse --verify "$5^{commit}")
duck_repository=$(realpath -e -- "$6")
duck_revision=$(git -C "$duck_repository" rev-parse --verify "$7^{commit}")
[[ "$expected_hash" =~ ^[0-9a-f]{64}$ ]] || { echo 'Expected SHA256 must be 64 lowercase hex digits.' >&2; exit 2; }
[ "$(sha256sum "$artifact" | cut -d ' ' -f 1)" = "$expected_hash" ] || { echo 'Artifact SHA256 mismatch.' >&2; exit 1; }
dog_git=$(git -C "$dog_repository" rev-parse --path-format=absolute --git-common-dir)
duck_git=$(git -C "$duck_repository" rev-parse --path-format=absolute --git-common-dir)
dog_cache=$(realpath -e -- "${GAME_KIT_DOG_CACHE:-$dog_repository/.claude/bus/npm-cache}")
duck_cache=$(realpath -e -- "${GAME_KIT_DUCK_CACHE:-$duck_repository/.claude/bus/npm-cache}")
mkdir -p "$kit_root/.claude"
output=$(mktemp -d "$kit_root/.claude/release-consumers.XXXXXXXX")
# Refuse credential paths rather than fingerprinting secret material.
fingerprint() {
  python3 - "$@" <<'PYTHON'
import hashlib, os, pathlib, subprocess, sys
h = hashlib.sha256()
for root in sys.argv[1:]:
    h.update(os.fsencode(root))
    h.update(subprocess.check_output(['git', '-C', root, 'rev-parse', 'HEAD']))
    status = subprocess.check_output(['git', '-C', root, 'status', '--porcelain=v1', '-z', '--untracked-files=all'])
    h.update(status)
    entries = iter(status.split(b'\0'))
    for entry in entries:
        if not entry:
            continue
        name = os.fsdecode(entry[3:])
        if b'R' in entry[:2] or b'C' in entry[:2]:
            h.update(next(entries))
        path = pathlib.Path(root, name)
        if any(part == '.env' or part.startswith('.env.') or part in ('.ssh', '.private') for part in path.parts):
            raise SystemExit('Refusing credential path in dirty-file fingerprint')
        if path.is_symlink():
            h.update(os.fsencode(os.readlink(path)))
        elif path.is_file():
            h.update(path.read_bytes())
        elif path.exists():
            raise SystemExit('Unsupported dirty path: ' + name)
print(h.hexdigest())
PYTHON
}
before=$(fingerprint "$kit_root" "$dog_repository" "$duck_repository")
printf '%s\n' "$before" >"$output/source.before"
printf 'artifact_sha256=%s\nsource=%s\nversion=%s\ndog=%s\nduck=%s\nharness=%s\n' \
  "$expected_hash" "$source_revision" "$expected_version" "$dog_revision" "$duck_revision" "$(git -C "$kit_root" rev-parse HEAD)" >"$output/revisions.txt"
verify_sources() {
  local result=$?
  trap - EXIT
  local after
  if ! after=$(fingerprint "$kit_root" "$dog_repository" "$duck_repository"); then
    echo 'INVALID: source fingerprint unavailable' >"$output/RESULT"
    exit 1
  fi
  printf '%s\n' "$after" >"$output/source.after"
  if [ "$before" != "$after" ] || [ "$(sha256sum "$artifact" | cut -d ' ' -f 1)" != "$expected_hash" ]; then
    echo 'INVALID: source or artifact changed during proof' >"$output/RESULT"
    result=1
  elif [ "$result" = 0 ]; then
    echo PASS >"$output/RESULT"
  else
    echo FAIL >"$output/RESULT"
  fi
  echo "Release consumer evidence: $output"
  exit "$result"
}
trap verify_sources EXIT
require_load
docker run --rm --read-only --cpus 4 --network none -u "$(id -u):$(id -g)" \
  -v "$kit_root:/harness:ro" -v "$artifact:/assets/release.tgz:ro" \
  -v "$dog_git:/repos/dog.git:ro" -v "$duck_git:/repos/duck.git:ro" \
  -v "$dog_cache:/caches/dog:ro" -v "$duck_cache:/caches/duck:ro" \
  -v "$output:/scratch" --tmpfs "/tmp:exec,uid=$(id -u),gid=$(id -g)" \
  -e npm_config_logs_dir=/scratch/npm-logs -e npm_config_userconfig=/scratch/npm-user-config \
  -e npm_config_globalconfig=/scratch/npm-global-config -e HOME=/scratch/home \
  node:24.21.0 timeout 600s bash /harness/scripts/release-consumer-job.sh \
  "$expected_hash" "$source_revision" "$expected_version" "$dog_revision" "$duck_revision" \
  >"$output/container.log" 2>&1
