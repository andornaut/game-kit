// The local file package exposes runtime metadata, not standalone development tooling.
import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2];
const manifest = JSON.parse(readFileSync(file, "utf8"));
delete manifest.devDependencies;
delete manifest.scripts;
writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
