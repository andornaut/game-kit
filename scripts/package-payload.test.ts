import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

const helper = resolve(dirname(fileURLToPath(import.meta.url)), "package-payload.sh");

it.each(["copy", "rename", "success"])("preserves coherent payloads on %s", (failure) => {
  const root = mkdtempSync(join(tmpdir(), "kit-payload-"));
  const bin = join(root, "bin");
  const payload = join(root, "source");
  const destination = join(root, "installed");
  for (const path of [bin, payload, destination]) {
    mkdirSync(path);
  }
  writeFileSync(join(payload, "new.txt"), "new");
  writeFileSync(join(destination, "old.txt"), "old");
  writeFileSync(join(destination, "KIT_COMMIT"), "old-revision\n");
  if (failure === "copy") {
    writeFileSync(join(bin, "cp"), "#!/bin/sh\nexit 42\n", { mode: 0o755 });
  }
  if (failure === "rename") {
    writeFileSync(
      join(bin, "mv"),
      '#!/bin/sh\ncase "$*" in *stage*installed) exit 43;; esac\nexec /bin/mv "$@"\n',
      { mode: 0o755 },
    );
  }
  const result = spawnSync(
    "bash",
    [
      "-ec",
      '. "$1"; install_package_payload "$2" new-revision "$3"',
      "_",
      helper,
      payload,
      destination,
    ],
    {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      encoding: "utf8",
    },
  );
  expect(result.status === 0).toBe(failure === "success");
  expect(readFileSync(join(destination, "KIT_COMMIT"), "utf8")).toBe(
    failure === "success" ? "new-revision\n" : "old-revision\n",
  );
  expect(existsSync(join(destination, "old.txt"))).toBe(failure !== "success");
  expect(existsSync(join(destination, "new.txt"))).toBe(failure === "success");
});
