import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const PLACEHOLDER_RE = /PASTE_|YOUR_|PLACEHOLDER/i;

function configFiles() {
  const expectedName = expectedWorkerName();
  const dist = resolve("dist");
  if (!existsSync(dist)) return [];
  return readdirSync(dist)
    .map((name) => join(dist, name, "wrangler.json"))
    .filter((file) => existsSync(file))
    .filter((file) => {
      if (!expectedName) return true;
      try {
        const config = JSON.parse(readFileSync(file, "utf8"));
        return config.name === expectedName || config.topLevelName === expectedName;
      } catch {
        return false;
      }
    });
}

function expectedWorkerName() {
  for (const file of ["wrangler.local.jsonc", "wrangler.jsonc"]) {
    if (!existsSync(file)) continue;
    try {
      const config = JSON.parse(readFileSync(file, "utf8"));
      if (typeof config.name === "string" && config.name.trim()) return config.name.trim();
    } catch {
      continue;
    }
  }
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

function deploymentDomain(config) {
  const fromEnv =
    process.env.CLOUDFLARE_CUSTOM_DOMAIN?.trim() ||
    process.env.WORKER_CUSTOM_DOMAIN?.trim() ||
    process.env.FORUM_CUSTOM_DOMAIN?.trim();
  if (fromEnv) return fromEnv;

  const existingCustomDomain = (config.routes ?? []).find(
    (route) => route && typeof route === "object" && route.custom_domain === true && typeof route.pattern === "string",
  );
  return existingCustomDomain?.pattern || "fstdesk.com";
}

function publicRoute(domain) {
  return {
    pattern: domain,
    custom_domain: true,
    enabled: true,
    previews_enabled: false,
  };
}

function lockPublicWorkerUrls(config) {
  let changed = false;
  const routes = [publicRoute(deploymentDomain(config))];

  if (config.workers_dev !== false) {
    config.workers_dev = false;
    changed = true;
  }
  if (config.preview_urls !== false) {
    config.preview_urls = false;
    changed = true;
  }
  if (JSON.stringify(config.routes) !== JSON.stringify(routes)) {
    config.routes = routes;
    changed = true;
  }

  return changed;
}

const files = configFiles();
if (!files.length) {
  throw new Error("No dist/*/wrangler.json files found. Run vite build before prepare-deploy-config.");
}

for (const file of files) {
  const config = JSON.parse(readFileSync(file, "utf8"));
  let changed = false;

  if (config.no_bundle === true) {
    delete config.no_bundle;
    changed = true;
  }

  if (Array.isArray(config.rules)) {
    delete config.rules;
    changed = true;
  }

  if (lockPublicWorkerUrls(config)) {
    changed = true;
  }

  for (const db of config.d1_databases ?? []) {
    if (!needsDatabaseId(db.database_id)) continue;

    const resolved =
      databaseIdFromEnv(db.binding, db.database_name) ||
      databaseIdFromWrangler(db.database_name);

    if (!resolved) {
      throw new Error(
        `Could not resolve D1 database_id for "${db.database_name}". ` +
        `Set CLOUDFLARE_D1_DATABASE_ID or ensure wrangler can list the D1 database.`,
      );
    }

    db.database_id = resolved.id;
    changed = true;
    console.log(`Resolved D1 binding ${db.binding} from ${resolved.source}`);
  }

  if (changed) {
    writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
    console.log(`Updated ${file}`);
  }
}
