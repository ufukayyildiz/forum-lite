import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const rootDir = process.cwd();
const appDir = join(rootDir, "forum-lite");
const appDistDir = join(appDir, "dist");
const rootDeployConfig = join(rootDir, "wrangler.jsonc");
const PLACEHOLDER_RE = /PASTE_|YOUR_|PLACEHOLDER/i;

function generatedWorkerConfigFiles() {
  if (!existsSync(appDistDir)) return [];
  return readdirSync(appDistDir)
    .map((name) => join(appDistDir, name, "wrangler.json"))
    .filter((file) => existsSync(file));
}

function readConfig(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function envCandidates(binding, databaseName) {
  const normalizedName = databaseName.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const normalizedBinding = binding.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  return [
    `${normalizedBinding}_DATABASE_ID`,
    `${normalizedName}_DATABASE_ID`,
    "CLOUDFLARE_D1_DATABASE_ID",
    "D1_DATABASE_ID",
    "FORUM_DB_DATABASE_ID",
  ];
}

function databaseIdFromEnv(binding, databaseName) {
  for (const key of envCandidates(binding, databaseName)) {
    const value = process.env[key]?.trim();
    if (value) return { id: value, source: `$${key}` };
  }
}

let d1List;
function listD1Databases() {
  if (d1List) return d1List;
  const output = execFileSync("npx", ["wrangler", "d1", "list", "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const parsed = JSON.parse(output);
  d1List = Array.isArray(parsed) ? parsed : parsed.result ?? [];
  return d1List;
}

function databaseIdFromWrangler(databaseName) {
  const row = listD1Databases().find((db) => db.name === databaseName || db.database_name === databaseName);
  const id = row?.uuid || row?.id || row?.database_id;
  return id ? { id, source: `wrangler d1 list (${databaseName})` } : undefined;
}

function needsDatabaseId(value) {
  return !value || PLACEHOLDER_RE.test(value);
}

function rootRelative(path) {
  return path.replace(`${rootDir}/`, "");
}

const workerConfigFiles = generatedWorkerConfigFiles();
const workerConfigFile =
  workerConfigFiles.find((file) => {
    const config = readConfig(file);
    return config.name === "forum-lite" || config.topLevelName === "forum-lite";
  }) || workerConfigFiles[0];
if (!workerConfigFile) {
  throw new Error("No forum-lite/dist/*/wrangler.json file found. Run the app build first.");
}

const config = readConfig(workerConfigFile);
const workerDistDir = dirname(workerConfigFile);

delete config.configPath;
delete config.userConfigPath;

config.name = "forum-lite";
config.topLevelName = "forum-lite";
config.main = rootRelative(join(workerDistDir, "index.js"));
config.assets = {
  ...(config.assets ?? {}),
  directory: rootRelative(join(appDistDir, "client")),
};

for (const db of config.d1_databases ?? []) {
  if (!needsDatabaseId(db.database_id)) continue;

  const resolved = databaseIdFromEnv(db.binding, db.database_name) || databaseIdFromWrangler(db.database_name);
  if (!resolved) {
    throw new Error(
      `Could not resolve D1 database_id for "${db.database_name}". ` +
        "Set CLOUDFLARE_D1_DATABASE_ID in the Cloudflare build environment or make sure Wrangler can list D1 databases.",
    );
  }

  db.database_id = resolved.id;
  console.log(`Resolved D1 binding ${db.binding} from ${resolved.source}`);
}

for (const db of config.d1_databases ?? []) {
  if (db.migrations_dir) db.migrations_dir = rootRelative(join(appDir, db.migrations_dir));
}

const customDomain =
  process.env.CLOUDFLARE_CUSTOM_DOMAIN?.trim() ||
  process.env.WORKER_CUSTOM_DOMAIN?.trim() ||
  process.env.FORUM_CUSTOM_DOMAIN?.trim();

if (customDomain) {
  config.routes = [{ pattern: customDomain, custom_domain: true }];
}

writeFileSync(rootDeployConfig, `${JSON.stringify(config, null, 2)}\n`);
console.log(`Prepared root Wrangler deploy config at ${rootRelative(rootDeployConfig)}`);
