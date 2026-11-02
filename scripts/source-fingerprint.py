"""Fingerprint source without opening credential-shaped paths or symlink targets."""

import hashlib
import os
from pathlib import Path
import subprocess
import sys


def git(root, *args):
    return subprocess.check_output(
        ["git", "-C", root, *args], stderr=subprocess.DEVNULL
    )


def fingerprint(root):
    head = git(root, "rev-parse", "HEAD")
    status = git(root, "status", "--porcelain=v1", "--untracked-files=all", "-z")
    names = sorted(set(git(root, "ls-files", "--cached", "--others", "--exclude-standard", "-z").split(b"\0")) - {b""})
    paths = [Path(root, os.fsdecode(name)) for name in names]
    # Match the release-consumer harness; preflight every path before reading content.
    for path in paths:
        if any(part == ".env" or part.startswith(".env.") or part in (".ssh", ".private") for part in path.parts):
            raise SystemExit("Refusing credential path in source fingerprint")
    digest = hashlib.sha256(head + status)
    for name, path in zip(names, paths):
        digest.update(name + b"\0")
        if path.is_symlink():
            digest.update(os.fsencode(os.readlink(path)))
        elif path.is_file():
            digest.update(path.read_bytes())
        elif path.exists():
            raise SystemExit("Unsupported source path in fingerprint")
        else:
            digest.update(b"missing\0")
    return digest.hexdigest()


if __name__ == "__main__":
    try:
        print(fingerprint(sys.argv[1]))
    except (OSError, subprocess.CalledProcessError):
        raise SystemExit("Cannot read source fingerprint") from None
