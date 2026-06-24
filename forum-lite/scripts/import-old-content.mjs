#!/usr/bin/env node
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_OUT = "/private/tmp/forum-content-import.sql";
const DEFAULT_USER_MAP = "/private/tmp/forum-users-map.tsv";
const MAX_CONTENT_CHARS = 60_000;
const MAX_STATEMENT_CHARS = 80_000;
const SYSTEM_FALLBACK_USER_SQL =
  "(SELECT id FROM users WHERE username = 'admin' UNION SELECT id FROM users ORDER BY id LIMIT 1)";

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

function truthy(value) {
  return value === "t" || value === "true" || value === "1";
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
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1)}...` : trimmed;
}

function publicCategoryId(oldId) {
  return String(1_000 + ((oldId * 7919 + 1013) % 9_000)).padStart(4, "0");
}

function publicTopicId(oldId) {
  return String(100_000 + ((oldId * 48271 + 12345) % 900_000)).padStart(6, "0");
}

function cssColor(value, fallback = "#6366f1") {
  const hex = String(value ?? "").replace(/[^0-9a-fA-F]/g, "").slice(0, 6);
  return hex.length === 6 ? `#${hex}` : fallback;
}

function slugValue(value, fallback) {
  const raw = textValue(value, 90) ?? fallback;
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || fallback;
}

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function sizedChunks(rows, maxRows = 100, maxChars = MAX_STATEMENT_CHARS) {
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

function contentValue(value) {
  const text = textValue(value, MAX_CONTENT_CHARS);
  if (text == null) return null;
  if (String(value ?? "").trim().length <= MAX_CONTENT_CHARS) return text;
  return `${text}\n\n[... legacy content truncated ...]`;
}

async function readUserMap(path) {
  const map = new Map();
  const text = await readFile(path, "utf8");
  for (const line of text.split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const [oldUserId, publicId] = line.split("\t");
    map.set(intValue(oldUserId), publicId);
  }
  return map;
}

function userIdSql(oldUserId, userMap) {
  const publicId = userMap.get(oldUserId);
  if (!publicId) return `(${SYSTEM_FALLBACK_USER_SQL})`;
  return `COALESCE((SELECT id FROM users WHERE public_id = ${sqlString(publicId)}), ${SYSTEM_FALLBACK_USER_SQL})`;
}

async function main() {
  const dumpPath = resolve(readArg("--dump", defaultDumpPath()));
  const outPath = resolve(readArg("--out", DEFAULT_OUT));
  const userMapPath = resolve(readArg("--user-map", DEFAULT_USER_MAP));
  const userMap = await readUserMap(userMapPath);

  const categories = new Map();
  const topics = new Map();
  const firstPosts = new Map();
  const repliesByTopic = new Map();
  const wanted = new Set(["categories", "topics", "posts"]);

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

      if (active.table === "categories") {
        const id = intValue(row.id);
        if (!id || truthy(row.read_restricted)) continue;
        categories.set(id, {
          id,
          publicId: publicCategoryId(id),
          name: textValue(row.name, 60) ?? `Category ${id}`,
          slug: slugValue(row.slug, `category-${id}`),
          description: textValue(row.description, 400),
          color: cssColor(row.color),
          position: intValue(row.position, id),
          createdAt: timestampSeconds(row.created_at),
        });
      } else if (active.table === "topics") {
        const id = intValue(row.id);
        if (!id) continue;
        if (row.deleted_at || !truthy(row.visible)) continue;
        if (row.archetype !== "regular") continue;
        const categoryId = intValue(row.category_id);
        if (!categories.has(categoryId)) continue;
        topics.set(id, {
          id,
          categoryId,
          publicId: publicTopicId(id),
          userId: intValue(row.user_id),
          title: textValue(row.title, 200) ?? `Topic ${id}`,
          slug: slugValue(row.slug, `topic-${id}`),
          pinned: row.pinned_at != null || truthy(row.pinned_globally),
          locked: truthy(row.closed) || truthy(row.archived),
          views: intValue(row.views),
          createdAt: timestampSeconds(row.created_at),
          updatedAt: timestampSeconds(row.updated_at ?? row.created_at),
          lastPostAt: timestampSeconds(row.last_posted_at ?? row.bumped_at ?? row.updated_at ?? row.created_at),
        });
      } else if (active.table === "posts") {
        const topicId = intValue(row.topic_id);
        const postNumber = intValue(row.post_number);
        if (!topicId || !postNumber) continue;
        if (row.deleted_at || truthy(row.hidden)) continue;
        if (intValue(row.post_type, 1) !== 1) continue;
        const post = {
          id: intValue(row.id),
          topicId,
          postNumber,
          userId: intValue(row.user_id),
          raw: contentValue(row.raw) ?? contentValue(row.cooked) ?? "",
          likeCount: intValue(row.like_count),
          createdAt: timestampSeconds(row.created_at),
          editedAt:
            row.updated_at && row.updated_at !== row.created_at
              ? timestampSeconds(row.updated_at)
              : null,
        };
        if (postNumber === 1) {
          firstPosts.set(topicId, post);
        } else {
          const list = repliesByTopic.get(topicId) ?? [];
          list.push(post);
          repliesByTopic.set(topicId, list);
        }
      }
    } else {
      const header = parseCopyHeader(line);
      if (header) active = header;
    }
  }

  const importedTopics = [...topics.values()].filter((topic) => firstPosts.has(topic.id));
  const importedTopicIds = new Set(importedTopics.map((topic) => topic.id));
  const replies = [];
  for (const [topicId, list] of repliesByTopic) {
    if (!importedTopicIds.has(topicId)) continue;
    replies.push(...list.sort((a, b) => a.postNumber - b.postNumber));
  }

  const replyCounts = new Map();
  const lastPostTimes = new Map();
  for (const topic of importedTopics) lastPostTimes.set(topic.id, topic.lastPostAt);
  for (const reply of replies) {
    replyCounts.set(reply.topicId, (replyCounts.get(reply.topicId) ?? 0) + 1);
    lastPostTimes.set(reply.topicId, Math.max(lastPostTimes.get(reply.topicId) ?? 0, reply.createdAt));
  }

  const statements = [
    "-- Generated by scripts/import-old-content.mjs from OLD/dump.sql.",
    "-- Order: categories, first topic posts as threads, remaining topic posts as replies.",
    "-- D1 ids are left untouched; legacy ids are encoded in deterministic public_id values.",
    "",
  ];

  for (const batch of chunk([...categories.values()], 100)) {
    const values = batch.map((cat) => {
      return `  (${[
        sqlString(cat.publicId),
        sqlString(cat.name),
        sqlString(cat.slug),
        cat.description == null ? "NULL" : sqlString(cat.description),
        sqlString(cat.color),
        sqlString("MessageSquare"),
        cat.position,
        cat.createdAt,
      ].join(", ")})`;
    });
    statements.push(
      `INSERT OR IGNORE INTO categories (\`public_id\`, \`name\`, \`slug\`, \`description\`, \`color\`, \`icon\`, \`position\`, \`created_at\`)\nVALUES\n${values.join(",\n")};`,
    );
  }

  const threadRows = importedTopics.map((topic) => {
      const first = firstPosts.get(topic.id);
      return `  (${[
        sqlString(topic.publicId),
        `(SELECT id FROM categories WHERE public_id = ${sqlString(publicCategoryId(topic.categoryId))})`,
        userIdSql(first.userId || topic.userId, userMap),
        sqlString(topic.title),
        sqlString(topic.slug),
        sqlString(first.raw),
        topic.pinned ? 1 : 0,
        topic.locked ? 1 : 0,
        0,
        topic.views,
        replyCounts.get(topic.id) ?? 0,
        topic.createdAt,
        topic.updatedAt,
        lastPostTimes.get(topic.id) ?? topic.lastPostAt,
      ].join(", ")})`;
    });

  for (const batch of sizedChunks(threadRows, 50)) {
    statements.push(
      `INSERT OR IGNORE INTO threads (\`public_id\`, \`category_id\`, \`user_id\`, \`title\`, \`slug\`, \`content\`, \`pinned\`, \`locked\`, \`featured\`, \`views\`, \`reply_count\`, \`created_at\`, \`updated_at\`, \`last_post_at\`)\nVALUES\n${batch.join(",\n")};`,
    );
  }

  const replyRows = replies.map((reply) => {
      return `  (${[
        `(SELECT id FROM threads WHERE public_id = ${sqlString(publicTopicId(reply.topicId))})`,
        userIdSql(reply.userId, userMap),
        sqlString(reply.raw),
        reply.likeCount,
        reply.editedAt == null ? "NULL" : reply.editedAt,
        reply.createdAt,
      ].join(", ")})`;
    });

  for (const batch of sizedChunks(replyRows, 50)) {
    statements.push(
      `INSERT INTO posts (\`thread_id\`, \`user_id\`, \`content\`, \`like_count\`, \`edited_at\`, \`created_at\`)\nVALUES\n${batch.join(",\n")};`,
    );
  }

  statements.push("");

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, statements.join("\n"), "utf8");

  const summary = {
    categories: categories.size,
    sourceTopics: topics.size,
    importedThreads: importedTopics.length,
    importedReplies: replies.length,
    skippedTopicsWithoutFirstPost: topics.size - importedTopics.length,
    outPath,
  };
  console.log(JSON.stringify({ dumpPath, userMapPath, summary }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
