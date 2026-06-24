#!/usr/bin/env node
import { createReadStream, existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_OUT = "/private/tmp/forum-tags-import.sql";
const MAX_STATEMENT_CHARS = 80_000;

function readArg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  const value = process.argv[i + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function defaultDumpPath() {
  const candidates = [
    resolve(process.cwd(), "OLD/dump.sql"),
    resolve(process.cwd(), "../../../OLD/dump.sql"),
    resolve(__dirname, "../../../../OLD/dump.sql"),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error("Could not find OLD/dump.sql. Pass --dump /path/to/dump.sql");
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
      if (next === undefined) out += "\\";
      else if (next === "n") out += "\n";
      else if (next === "r") out += "\r";
      else if (next === "t") out += "\t";
      else if (next === "b") out += "\b";
      else if (next === "f") out += "\f";
      else if (next === "v") out += "\v";
      else out += next;
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

function intValue(value, fallback = 0) {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
}

function timestampSeconds(value, fallback = Math.floor(Date.now() / 1000)) {
  if (!value) return fallback;
  const [date, time = "00:00:00"] = String(value).split(" ");
  const normalizedTime = time.replace(/(\.\d{3})\d+$/, "$1");
  const ms = Date.parse(`${date}T${normalizedTime}Z`);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : fallback;
}

function sqlString(value) {
  const clean = String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  return `'${clean.replace(/'/g, "''")}'`;
}

function textValue(value, maxLength) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function topicPublicId(oldId) {
  return String(100_000 + ((oldId * 48271 + 12345) % 900_000)).padStart(6, "0");
}

function slugValue(value, fallback) {
  const map = {
    ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u",
    Ç: "c", Ğ: "g", İ: "i", Ö: "o", Ş: "s", Ü: "u",
  };
  const raw = String(value ?? fallback)
    .split("")
    .map((ch) => map[ch] ?? ch)
    .join("")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return raw || fallback;
}

function sizedChunks(rows, maxRows = 150, maxChars = MAX_STATEMENT_CHARS) {
  const chunks = [];
  let current = [];
  let chars = 0;
  for (const row of rows) {
    const rowChars = row.length + 2;
    if (current.length && (current.length >= maxRows || chars + rowChars > maxChars)) {
      chunks.push(current);
      current = [];
      chars = 0;
    }
    current.push(row);
    chars += rowChars;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

async function main() {
  const dumpPath = resolve(readArg("--dump", defaultDumpPath()));
  const outPath = resolve(readArg("--out", DEFAULT_OUT));
  const tags = new Map();
  const topicTags = [];
  const wanted = new Set(["tags", "topic_tags"]);

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

      if (active.table === "tags") {
        const id = intValue(row.id);
        if (!id) continue;
        tags.set(id, {
          id,
          name: textValue(row.name, 80) ?? `tag-${id}`,
          targetTagId: intValue(row.target_tag_id, 0) || null,
          createdAt: timestampSeconds(row.created_at),
          publicTopicCount: intValue(row.public_topic_count),
        });
      } else if (active.table === "topic_tags") {
        const topicId = intValue(row.topic_id);
        const tagId = intValue(row.tag_id);
        if (topicId && tagId) topicTags.push({ topicId, tagId });
      }
      continue;
    }

    const header = parseCopyHeader(line);
    if (header) active = header;
  }

  function canonicalTagId(id) {
    const tag = tags.get(id);
    return tag?.targetTagId && tags.has(tag.targetTagId) ? tag.targetTagId : id;
  }

  const linkedCanonicalTagIds = new Set(topicTags.map((link) => canonicalTagId(link.tagId)).filter((id) => tags.has(id)));
  const usedSlugs = new Set();
  const slugByTagId = new Map();
  const importTags = [...linkedCanonicalTagIds]
    .map((id) => tags.get(id))
    .filter(Boolean)
    .sort((a, b) => a.id - b.id)
    .map((tag) => {
      const base = slugValue(tag.name, `tag-${tag.id}`);
      let slug = base;
      if (usedSlugs.has(slug)) slug = `${base.slice(0, 70)}-${tag.id}`;
      usedSlugs.add(slug);
      slugByTagId.set(tag.id, slug);
      return { ...tag, slug };
    });

  const uniqueLinks = new Set();
  for (const link of topicTags) {
    const tagId = canonicalTagId(link.tagId);
    const slug = slugByTagId.get(tagId);
    if (!slug) continue;
    uniqueLinks.add(`${link.topicId}\t${slug}`);
  }

  const statements = [
    "-- Generated by scripts/import-old-tags.mjs from OLD/dump.sql.",
    "-- Imports legacy Discourse tags and topic_tags for threads already imported with 6-digit public_id values.",
    "",
    "DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM thread_tags);",
    "",
  ];

  const tagRows = importTags.map((tag) => {
    return `  (${[sqlString(tag.name), sqlString(tag.slug), tag.createdAt].join(", ")})`;
  });

  for (const batch of sizedChunks(tagRows)) {
    statements.push(
      `INSERT OR IGNORE INTO tags (\`name\`, \`slug\`, \`created_at\`)\nVALUES\n${batch.join(",\n")};`,
    );
  }

  statements.push("");
  for (const item of uniqueLinks) {
    const [topicId, tagSlug] = item.split("\t");
    statements.push(
      `INSERT OR IGNORE INTO thread_tags (\`thread_id\`, \`tag_id\`)
SELECT threads.id, tags.id
FROM threads
INNER JOIN tags ON tags.slug = ${sqlString(tagSlug)}
WHERE threads.public_id = ${sqlString(topicPublicId(intValue(topicId)))};`,
    );
  }

  statements.push("");
  statements.push("DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM thread_tags);");
  statements.push("");

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, statements.join("\n"), "utf8");

  console.log(JSON.stringify({
    dumpPath,
    outPath,
    oldTags: tags.size,
    oldTopicTags: topicTags.length,
    importTags: importTags.length,
    importLinks: uniqueLinks.size,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
