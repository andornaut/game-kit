import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

const scripts = dirname(fileURLToPath(import.meta.url));

/** Run npm-cache.ts against a Docker stand-in that records each container's arguments. */
function run(...args: string[]) {
  const root = mkdtempSync(join(tmpdir(), "kit-npm-cache-"));
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "bin"));
  mkdirSync(join(root, "cache"));
  writeFileSync(join(root, "cache/index"), "");
  for (const file of ["npm-cache.ts", "runtime.ts"]) {
    copyFileSync(join(scripts, file), join(root, "scripts", file));
  }
  writeFileSync(join(root, ".nvmrc"), "24.21.0\n");
  const capture = join(root, "captured");
  writeFileSync(
    join(root, "bin/docker"),
    '#!/bin/sh\nif [ "$1" = create ]; then printf "%s\\n" "$@" > "$CAPTURE"; echo fixture; fi\n',
    { mode: 0o755 },
  );
  const result = spawnSync(process.execPath, [join(root, "scripts/npm-cache.ts"), ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      CAPTURE: capture,
      // The fake Docker runs nothing heavy, so the result must not depend on host load.
      GAME_KIT_LOAD: "0",
      GAME_KIT_NPM_CACHE: "kit-cache",
      PATH: `${root}/bin:${process.env.PATH}`,
    },
  });
  const created = () => readFileSync(capture, "utf8").trim().split("\n");
  return { created, result };
}

it.each([[], ["load"], ["copy", "cache"], ["save", "cache", "extra"]])(
  "refuses the arguments %j",
  (...args: string[]) => {
    const { result } = run(...args);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Usage: npm-cache.ts load|save <directory>");
  },
);

it.each([
  { action: "load", mount: "type=volume,source=kit-cache,target=/var/tmp" },
  { action: "save", mount: "type=volume,source=kit-cache,target=/var/tmp,readonly" },
])("$action uses the named volume without network or host mounts", ({ action, mount }) => {
  const { created, result } = run(action, "cache");
  expect(result.status).toBe(0);
  const args = created();
  expect(args).toContain(mount);
  expect(args.join(" ")).toContain("--network none");
  expect(args.join(" ")).toContain("--user 19001:19001");
  expect(args.some((arg) => arg.startsWith("type=bind"))).toBe(false);
});
