import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

const runtime = resolve(dirname(fileURLToPath(import.meta.url)), "check-runtime.sh");

it.each([
  { allowed: true, load: "1.23" },
  { allowed: false, load: "24.00" },
  { allowed: false, load: "unknown" },
])("uses one fail-closed load policy for $load", ({ allowed, load }) => {
  const root = mkdtempSync(join(tmpdir(), "kit-resource-"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "uptime"),
    `#!/bin/sh\necho "12:00 up 1 day, load average: ${load}, 0.00, 0.00"\n`,
    { mode: 0o755 },
  );
  const check = () =>
    execFileSync("bash", ["-c", '. "$1"; require_load', "_", runtime], {
      env: { PATH: `${bin}:${process.env.PATH}` },
      stdio: "pipe",
    });
  if (allowed) {
    expect(check).not.toThrow();
  } else {
    expect(check).toThrow();
  }
});

it.each(["24.21.0", "v24.21.0"])(
  "uses root Node version %s for either container job",
  (version) => {
    const root = mkdtempSync(join(tmpdir(), "kit-image-"));
    writeFileSync(join(root, ".nvmrc"), `${version}\n`);
    const result = execFileSync(
      "bash",
      ["-c", '. "$1"; node_check_image "$2"', "_", runtime, root],
      {
        encoding: "utf8",
      },
    );
    expect(result).toBe("node:24.21.0\n");
  },
);
