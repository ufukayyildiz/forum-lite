import { copyFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const assetsDir = resolve("dist/client/assets");
const legacyEntryFiles = [
  "index-BSxC7cKI.js",
  "index-8d-KUl01.js",
  "index-jtkaNP9d.js",
  "index-CsRveqls.js",
];

if (!existsSync(assetsDir)) {
  process.exit(0);
}

const entryFiles = readdirSync(assetsDir)
  .filter((name) => /^index-[A-Za-z0-9_-]+\.js$/.test(name))
  .filter((name) => !legacyEntryFiles.includes(name))
  .sort();

const currentEntry = entryFiles.at(-1);
if (!currentEntry) {
  process.exit(0);
}

for (const legacyFile of legacyEntryFiles) {
  if (legacyFile === currentEntry) continue;
  copyFileSync(join(assetsDir, currentEntry), join(assetsDir, legacyFile));
  console.log(`Copied ${currentEntry} to legacy asset ${legacyFile}`);
}
