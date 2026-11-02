import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

const scripts = dirname(fileURLToPath(import.meta.url));

it.each([".env", ".env.fixture", ".ssh/key", ".private/key", "git-failure"])(
  "refuses %s before starting the verification containers",
  (name) => {
    const root = mkdtempSync(join(tmpdir(), "kit-fingerprint-"));
    mkdirSync(join(root, "scripts"));
    const bin = join(root, "bin");
    mkdirSync(bin);
    for (const name of ["check.sh", "check-runtime.sh", "source-fingerprint.py"]) {
      if (existsSync(join(scripts, name))) {
        copyFileSync(join(scripts, name), join(root, "scripts", name));
      }
    }
    writeFileSync(join(root, ".nvmrc"), "24.21.0\n");
    // An empty synthetic credential-shaped file, never real credential material.
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), "");
    const listing = name === "git-failure" ? "exit 42" : `printf '${name}\\0'`;
    writeFileSync(
      join(bin, "git"),
      [
        "#!/bin/sh",
        'if [ "$1" = -C ]; then shift 2; fi',
        `case "$1" in rev-parse) echo fixture;; status) :;; ls-files) ${listing};; esac`,
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    writeFileSync(join(bin, "uptime"), '#!/bin/sh\necho "load average: 0.00, 0.00, 0.00"\n', {
      mode: 0o755,
    });
    writeFileSync(join(bin, "docker"), '#!/bin/sh\necho "container started" >&2\nexit 99\n', {
      mode: 0o755,
    });
    const result = spawnSync("bash", [join(root, "scripts/check.sh")], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      name === "git-failure" ? "Cannot read source fingerprint" : "Refusing credential path",
    );
    expect(result.stderr).not.toContain("container started");
  },
);
