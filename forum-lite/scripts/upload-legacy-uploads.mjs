#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

function readArg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  const value = process.argv[i + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function readNumberArg(name, fallback) {
  const raw = readArg(name, String(fallback));
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 1) throw new Error(`${name} must be a positive number`);
  return value;
}

function runWrangler(row, bucket, config) {
  return new Promise((resolvePromise, reject) => {
    const args = [
      "exec",
      "wrangler",
      "--",
      "r2",
      "object",
      "put",
      `${bucket}/${row.key}`,
      "--file",
      row.localPath,
      "--content-type",
      row.contentType,
      "--remote",
      "--force",
      "--config",
      config,
    ];
    const child = spawn("npm", args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(new Error(`upload failed for ${row.key}\n${output.trim()}`));
      }
    });
  });
}

async function main() {
  const manifest = resolve(readArg("--manifest", "/private/tmp/forum-legacy-uploads.tsv"));
  const bucket = readArg("--bucket", "fstdesk");
  const config = resolve(readArg("--config", "dist/bigboard/wrangler.json"));
  const concurrency = readNumberArg("--concurrency", 4);

  const text = await readFile(manifest, "utf8");
  const rows = text
    .split(/\r?\n/)
    .slice(1)
    .filter((line) => line.trim())
    .map((line, index) => {
      const [localPath, key, contentType, size, uploadId, legacyUrl, filename] = line.split("\t");
      if (!localPath || !key || !contentType) throw new Error(`bad manifest line ${index + 2}`);
      if (!existsSync(localPath)) throw new Error(`missing local file: ${localPath}`);
      return { localPath, key, contentType, size, uploadId, legacyUrl, filename };
    });

  let next = 0;
  let done = 0;
  const failures = [];

  async function worker() {
    while (next < rows.length) {
      const row = rows[next++];
      try {
        await runWrangler(row, bucket, config);
        done++;
        if (done === rows.length || done % 25 === 0) {
          console.log(`uploaded ${done}/${rows.length}`);
        }
      } catch (error) {
        failures.push(error);
        console.error(error.message);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, worker));
  if (failures.length) {
    throw new Error(`${failures.length} upload(s) failed`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
