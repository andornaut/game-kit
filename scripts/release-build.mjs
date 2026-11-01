// Derive the distribution interface from the explicit source exports.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const destination = resolve(process.argv[2]);
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
const manifest = JSON.parse(readFileSync("package.json", "utf8"));
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
