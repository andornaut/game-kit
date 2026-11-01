import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runnerImport } from "vite";
import { expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

it.each([false, true])(
  "loads an isolated source-package client with PNG peer installed=%s",
  async (png) => {
    const client = mkdtempSync(join(tmpdir(), "kit-minimal-"));
    const kit = join(client, "vendor/game-kit");
    mkdirSync(join(client, "node_modules/@andornaut"), { recursive: true });
    mkdirSync(kit, { recursive: true });
    cpSync(join(root, "src"), join(kit, "src"), { recursive: true });
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    delete manifest.devDependencies;
    writeFileSync(join(kit, "package.json"), JSON.stringify(manifest));
    writeFileSync(join(client, "package.json"), '{"type":"module"}');
    symlinkSync("../../vendor/game-kit", join(client, "node_modules/@andornaut/game-kit"));
    if (png) {
      cpSync(join(root, "node_modules/pngjs"), join(client, "node_modules/pngjs"), {
        recursive: true,
      });
    }
    const source = png
      ? 'import { decodePng } from "@andornaut/game-kit/art/png"; export const loaded = typeof decodePng;'
      : 'import { seededRandom } from "@andornaut/game-kit/random"; export const loaded = typeof seededRandom;';
    const entry = join(client, "entry.ts");
    writeFileSync(entry, source);
    const { module } = await runnerImport<{ loaded: string }>(entry, {
      configFile: false,
      root: client,
    });
    expect(module.loaded).toBe("function");
    expect(existsSync(join(client, "node_modules/phaser"))).toBe(false);
    const require = createRequire(join(client, "package.json"));
    expect(require.resolve("@andornaut/game-kit/view/frameTurnPortraitGame.css")).toBe(
      join(kit, "src/view/frameTurnPortraitGame.css"),
    );
    expect(() => require.resolve("@andornaut/game-kit/src/random.ts")).toThrow();
    expect(() => require.resolve("@andornaut/game-kit/build/buildInfo")).toThrow();
    if (!png) {
      const missing = join(client, "missing-peer.ts");
      writeFileSync(missing, 'export { decodePng } from "@andornaut/game-kit/art/png";');
      await expect(runnerImport(missing, { configFile: false, root: client })).rejects.toThrow();
    }
  },
);
