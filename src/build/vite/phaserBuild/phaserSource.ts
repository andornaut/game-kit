import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// Phaser's source folder, phaser/src/, found through its package.json (the package's exports name
// no other path).
export function phaserSourceDir(): string {
  return join(dirname(createRequire(import.meta.url).resolve("phaser/package.json")), "src");
}
