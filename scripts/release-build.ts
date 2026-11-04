// Derive the distribution interface from the explicit source exports.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

// Source exports are module paths or types-only entries; built exports may add an import.
interface Manifest {
  devDependencies?: unknown;
  exports: Record<string, string | { import?: string; types: string }>;
  files: string[];
  scripts?: unknown;
}

const [output] = process.argv.slice(2);
if (output === undefined) {
  throw new Error("Usage: release-build.ts <destination>");
}
const destination = resolve(output);
execFileSync(
  process.execPath,
  [
    "node_modules/typescript/bin/tsc",
    "-p",
    "tsconfig.release.json",
    "--outDir",
    `${destination}/dist`,
  ],
  { stdio: "inherit" },
);
const manifest = JSON.parse(readFileSync("package.json", "utf8")) as Manifest;
for (const [name, entry] of Object.entries(manifest.exports)) {
  if (name === "./package.json") {
    continue;
  }
  if (typeof entry === "object") {
    const target = entry.types.replace("./src/", "./dist/");
    mkdirSync(dirname(resolve(destination, target)), { recursive: true });
    copyFileSync(entry.types, resolve(destination, target));
    manifest.exports[name] = { types: target };
  } else if (entry.endsWith(".css")) {
    const target = entry.replace("./src/", "./dist/");
    mkdirSync(dirname(resolve(destination, target)), { recursive: true });
    copyFileSync(entry, resolve(destination, target));
    manifest.exports[name] = target;
  } else {
    const target = entry.replace("./src/", "./dist/").replace(/\.ts$/, ".js");
    manifest.exports[name] = { types: target.replace(/\.js$/, ".d.ts"), import: target };
  }
}
delete manifest.devDependencies;
delete manifest.scripts;
manifest.files = ["dist", "README.md", "LICENSE", "SOURCE_COMMIT"];
writeFileSync(`${destination}/package.json`, `${JSON.stringify(manifest, null, 2)}\n`);
for (const file of ["README.md", "LICENSE"]) {
  copyFileSync(file, `${destination}/${file}`);
}
