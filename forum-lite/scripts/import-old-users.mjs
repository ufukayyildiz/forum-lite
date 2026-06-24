#!/usr/bin/env node
import { createReadStream, existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { randomInt } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PLACEHOLDER_PASSWORD_HASH =
  "pbkdf2$100000$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000";

const DEFAULT_OUT = "/private/tmp/forum-users-import.sql";
const DEFAULT_MAP = "/private/tmp/forum-users-map.tsv";

function readArg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  const value = process.argv[i + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function defaultDumpPath() {
  const candidates = [
    resolve(process.cwd(), "OLD/dump.sql"),
    resolve(process.cwd(), "../../../OLD/dump.sql"),
    resolve(__dirname, "../../../../OLD/dump.sql"),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error("Could not find OLD/dump.sql. Pass --dump /path/to/dump.sql");
  }
  return found;
}

function parseCopyHeader(line) {
  const match = line.match(/^COPY public\.([a-zA-Z0-9_]+) \((.+)\) FROM stdin;$/);
  if (!match) return null;
  return {
    table: match[1],
    columns: match[2].split(",").map((col) => col.trim().replace(/^"|"$/g, "")),
  };
}

function parseCopyLine(line) {
  return line.split("\t").map((field) => {
    if (field === "\\N") return null;

    let out = "";
    for (let i = 0; i < field.length; i++) {
      const ch = field[i];
      if (ch !== "\\") {
        out += ch;
        continue;
      }

      const next = field[++i];
      if (next === undefined) {
        out += "\\";
      } else if (next === "n") {
        out += "\n";
      } else if (next === "r") {
        out += "\r";
      } else if (next === "t") {
        out += "\t";
      } else if (next === "b") {
        out += "\b";
      } else if (next === "f") {
        out += "\f";
      } else if (next === "v") {
        out += "\v";
      } else {
        out += next;
      }
    }
    return out;
  });
}

function toObject(columns, line) {
  const values = parseCopyLine(line);
  const row = {};
  for (let i = 0; i < columns.length; i++) row[columns[i]] = values[i] ?? null;
  return row;
}

function truthy(value) {
  return value === "t" || value === "true" || value === "1";
}

function parseIntOrZero(value) {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) ? n : 0;
}

function timestampSeconds(value, fallback = Math.floor(Date.now() / 1000)) {
  if (!value) return fallback;
  const [date, time = "00:00:00"] = value.split(" ");
  const normalizedTime = time.replace(/(\.\d{3})\d+$/, "$1");
  const ms = Date.parse(`${date}T${normalizedTime}Z`);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : fallback;
}

function isFutureTimestamp(value) {
  if (!value) return false;
  return timestampSeconds(value, 0) > Math.floor(Date.now() / 1000);
}

function sqlString(value) {
  const clean = String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  return `'${clean.replace(/'/g, "''")}'`;
}

function trimText(value, maxLength) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1)}...` : trimmed;
}

function safeEmail(email, sourceId) {
  const trimmed = trimText(email, 513);
  if (!trimmed || !trimmed.includes("@")) return `legacy+${sourceId}@import.invalid`;
  return trimmed;
}

function generatePublicId(used) {
  let id;
  do {
    id = String(randomInt(100_000, 1_000_000));
  } while (used.has(id));
  used.add(id);
  return id;
}

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function main() {
  const dumpPath = resolve(readArg("--dump", defaultDumpPath()));
  const outPath = resolve(readArg("--out", DEFAULT_OUT));
  const mapPath = resolve(readArg("--map", DEFAULT_MAP));
  const includeStaged = hasFlag("--include-staged");
  const includeUnapproved = hasFlag("--include-unapproved");

  const users = new Map();
  const emails = new Map();
  const profiles = new Map();
  const stats = new Map();
  const wanted = new Set(["users", "user_emails", "user_profiles", "user_stats"]);

  let active = null;
  const input = createReadStream(dumpPath, { encoding: "utf8" });
  const rl = createInterface({ input, crlfDelay: Infinity });

  for await (const line of rl) {
    if (active) {
      if (line === "\\.") {
        active = null;
        continue;
      }
      if (!wanted.has(active.table)) continue;

      const row = toObject(active.columns, line);
      if (active.table === "users") {
        const id = parseIntOrZero(row.id);
        users.set(id, {
          id,
          username: trimText(row.username, 255),
          createdAt: row.created_at,
          name: trimText(row.name, 255),
          admin: truthy(row.admin),
          moderator: truthy(row.moderator),
          approved: truthy(row.approved),
          active: truthy(row.active),
          staged: truthy(row.staged),
          suspendedTill: row.suspended_till,
          silencedTill: row.silenced_till,
        });
      } else if (active.table === "user_emails") {
        const userId = parseIntOrZero(row.user_id);
        const previous = emails.get(userId);
        const primary = truthy(row.primary);
        if (!previous || primary || !previous.primary) {
          emails.set(userId, { email: row.email, primary });
        }
      } else if (active.table === "user_profiles") {
        const userId = parseIntOrZero(row.user_id);
        profiles.set(userId, trimText(row.bio_raw ?? row.bio_cooked, 4096));
      } else if (active.table === "user_stats") {
        const userId = parseIntOrZero(row.user_id);
        stats.set(userId, {
          postCount: parseIntOrZero(row.post_count),
          threadCount: parseIntOrZero(row.topic_count),
        });
      }
      continue;
    }

    const header = parseCopyHeader(line);
    if (header) active = header;
  }

  const usedPublicIds = new Set();
  const usedUsernames = new Set();
  const usedEmails = new Set();
  const rows = [];
  const summary = {
    sourceUsers: users.size,
    imported: 0,
    skippedSystem: 0,
    skippedNoUsername: 0,
    skippedStaged: 0,
    skippedUnapproved: 0,
    skippedDuplicateUsername: 0,
    emailFallbacks: 0,
    duplicateEmailFallbacks: 0,
    admins: 0,
    moderators: 0,
    banned: 0,
  };

  for (const user of users.values()) {
    if (user.id <= 0) {
      summary.skippedSystem++;
      continue;
    }
    if (!user.username) {
      summary.skippedNoUsername++;
      continue;
    }
    if (!includeStaged && user.staged) {
      summary.skippedStaged++;
      continue;
    }
    if (!includeUnapproved && !user.approved) {
      summary.skippedUnapproved++;
      continue;
    }
    const username = user.username.toLowerCase();
    if (usedUsernames.has(username)) {
      summary.skippedDuplicateUsername++;
      continue;
    }
    usedUsernames.add(username);

    let email = safeEmail(emails.get(user.id)?.email, user.id);
    if (email.endsWith("@import.invalid")) summary.emailFallbacks++;
    const emailKey = email.toLowerCase();
    if (usedEmails.has(emailKey)) {
      email = `legacy+${user.id}@import.invalid`;
      summary.duplicateEmailFallbacks++;
    }
    usedEmails.add(email.toLowerCase());

    const role = user.admin ? "admin" : user.moderator ? "moderator" : "member";
    if (role === "admin") summary.admins++;
    if (role === "moderator") summary.moderators++;

    const banned = isFutureTimestamp(user.suspendedTill) || isFutureTimestamp(user.silencedTill);
    if (banned) summary.banned++;

    const counts = stats.get(user.id) ?? { postCount: 0, threadCount: 0 };
    rows.push({
      sourceId: user.id,
      publicId: generatePublicId(usedPublicIds),
      username,
      email,
      passwordHash: PLACEHOLDER_PASSWORD_HASH,
      displayName: user.name || username,
      bio: profiles.get(user.id) ?? null,
      role,
      banned: banned ? 1 : 0,
      postCount: counts.postCount,
      threadCount: counts.threadCount,
      createdAt: timestampSeconds(user.createdAt),
    });
  }
  summary.imported = rows.length;

  const columns = [
    "public_id",
    "username",
    "email",
    "password_hash",
    "display_name",
    "bio",
    "role",
    "banned",
    "post_count",
    "thread_count",
    "created_at",
  ];
  const sql = [
    "-- Generated by scripts/import-old-users.mjs from OLD/dump.sql.",
    "-- Keeps D1 users.id untouched; D1 assigns it. Old Discourse IDs are in the TSV map only.",
    "-- Imported users receive placeholder password hashes and cannot log in until reset/migrated.",
    "",
    ...chunk(rows, 200).map((batch) => {
      const values = batch
        .map(
          (row) =>
            `  (${[
              sqlString(row.publicId),
              sqlString(row.username),
              sqlString(row.email),
              sqlString(row.passwordHash),
              sqlString(row.displayName),
              row.bio == null ? "NULL" : sqlString(row.bio),
              sqlString(row.role),
              row.banned,
              row.postCount,
              row.threadCount,
              row.createdAt,
            ].join(", ")})`,
        )
        .join(",\n");
      return `INSERT OR IGNORE INTO users (${columns.map((col) => `\`${col}\``).join(", ")})\nVALUES\n${values};`;
    }),
    "",
  ].join("\n");

  const map = [
    "old_user_id\tpublic_id\tusername\temail",
    ...rows.map((row) => [row.sourceId, row.publicId, row.username, row.email].join("\t")),
    "",
  ].join("\n");

  await mkdir(dirname(outPath), { recursive: true });
  await mkdir(dirname(mapPath), { recursive: true });
  await writeFile(outPath, sql, "utf8");
  await writeFile(mapPath, map, "utf8");

  console.log(JSON.stringify({ dumpPath, outPath, mapPath, summary }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
