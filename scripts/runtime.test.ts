import { spawnSync } from "node:child_process";
import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import { containerOptions, hostLoad, nodeImage, npmCacheVolume, requireLoad } from "./runtime.ts";

it.each([
  { env: { GAME_KIT_LOAD: "0" }, load: 0 },
  { env: { GAME_KIT_LOAD: "busy" }, load: Number.NaN },
])("reads the supplied load $env.GAME_KIT_LOAD", ({ env, load }) => {
  expect(hostLoad(env)).toBe(load);
});

it.each([
  { allowed: true, load: 1.23 },
  { allowed: false, load: 24 },
  { allowed: false, load: Number.NaN },
])("uses one fail-closed load policy for $load", ({ allowed, load }) => {
  if (allowed) {
    expect(() => requireLoad(load)).not.toThrow();
  } else {
    expect(() => requireLoad(load)).toThrow(/below 24/);
  }
});

it.each(["24.21.0", "v24.21.0"])("uses root Node version %s for every container job", (version) => {
  const root = mkdtempSync(join(tmpdir(), "kit-image-"));
  writeFileSync(join(root, ".nvmrc"), `${version}\n`);
  expect(nodeImage(root)).toBe("node:24.21.0");
});

it.each([
  [{}, "game-kit-npm-cache"],
  [{ GAME_KIT_NPM_CACHE: "kit-cache.2" }, "kit-cache.2"],
])("names the npm cache volume from %o", (env, volume) => {
  expect(npmCacheVolume(env)).toBe(volume);
});

it.each(["/home/cache", "cache/sub"])("refuses the host path %s as a cache", (path) => {
  expect(() => npmCacheVolume({ GAME_KIT_NPM_CACHE: path })).toThrow(/Docker volume/);
});

it("runs every container as the dedicated read-only identity with each checkout group", () => {
  const root = mkdtempSync(join(tmpdir(), "kit-identity-"));
  const options = containerOptions(root, root).join(" ");
  expect(options).toContain("--read-only --cpus 4 --user 19001:19001");
  expect(options).toContain(`--user 19001:19001 --group-add ${statSync(root).gid} -e HOME=/tmp`);
  expect(options).toContain("--mount type=volume,dst=/tmp");
});

it("rejects a pack request without one output directory before Docker", () => {
  const pack = join(dirname(fileURLToPath(import.meta.url)), "pack.ts");
  const result = spawnSync(process.execPath, [pack], {
    encoding: "utf8",
    env: { ...process.env, PATH: "/nonexistent" },
  });
  expect(result.status).toBe(2);
  expect(result.stderr).toContain("Usage: pack.ts <output-directory>");
});
