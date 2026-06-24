#!/usr/bin/env node
import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_OUT_SQL = "/private/tmp/forum-legacy-uploads.sql";
const DEFAULT_OUT_MANIFEST = "/private/tmp/forum-legacy-uploads.tsv";
const DEFAULT_OUT_SUMMARY = "/private/tmp/forum-legacy-uploads-summary.json";
const DEFAULT_USER_MAP = "/private/tmp/forum-users-map.tsv";
const BASE62_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "pdf"]);

const MIME_BY_EXT = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
};

const FALLBACK_USER_SQL =
  "COALESCE((SELECT id FROM users WHERE username = 'ufukayyildiz'), (SELECT id FROM users WHERE username = 'admin'), (SELECT id FROM users ORDER BY id LIMIT 1))";

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

function defaultOldRoot() {
  const dump = defaultDumpPath();
  return dirname(dump);
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

function truthy(value) {
  return value === "t" || value === "true" || value === "1";
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

function publicTopicId(oldId) {
  return String(100_000 + ((oldId * 48271 + 12345) % 900_000)).padStart(6, "0");
}

function base62Sha1(hex) {
  let n = BigInt(`0x${hex}`);
  if (n === 0n) return BASE62_ALPHABET[0];
  let out = "";
  const base = BigInt(BASE62_ALPHABET.length);
  while (n > 0n) {
    out = BASE62_ALPHABET[Number(n % base)] + out;
    n /= base;
  }
  return out;
}

function extensionOf(value) {
  const clean = String(value ?? "").split(/[?#]/)[0];
  const match = clean.match(/\.([a-zA-Z0-9]+)$/);
  return match ? match[1].toLowerCase() : "";
}

function normalizeUploadUrl(value) {
  if (!value) return "";
  const url = String(value).replace(/^https?:\/\/(?:www\.)?(?:feople\.io|fstdesk\.com)/i, "");
  return url.startsWith("/uploads/") ? url : "";
}

function normalizeShortUrlExtension(value) {
  return String(value).replace(/(\/uploads\/short-url\/[A-Za-z0-9]+)\.([a-zA-Z0-9]+)/g, (_match, base, ext) => {
    return `${base}.${ext.toLowerCase()}`;
  });
}

function normalizeUploadTokenExtension(value) {
  return String(value).replace(/^(upload:\/\/[A-Za-z0-9]+)\.([a-zA-Z0-9]+)$/i, (_match, base, ext) => {
    return `${base}.${ext.toLowerCase()}`;
  });
}

function localPathForUrl(oldRoot, url) {
  const normalized = normalizeUploadUrl(url);
  if (!normalized) return "";
  return resolve(oldRoot, `.${normalized}`);
}

function attachmentKey(upload, ext) {
  return `attachments/legacy/${upload.id}-${upload.sha1}.${ext}`;
}

function cleanFilename(value, fallback) {
  const base = String(value ?? "")
    .trim()
    .replace(/[\/\\]/g, "_")
    .replace(/[\u0000-\u001f]/g, "")
    .slice(0, 180);
  return base || fallback;
}

function userIdSql(oldUserId, userMap) {
  const publicId = userMap.get(oldUserId);
  if (!publicId) return FALLBACK_USER_SQL;
  return `COALESCE((SELECT id FROM users WHERE public_id = ${sqlString(publicId)}), ${FALLBACK_USER_SQL})`;
}

async function readUserMap(path) {
  const map = new Map();
  if (!existsSync(path)) return map;
  const text = await readFile(path, "utf8");
  for (const line of text.split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const [oldUserId, publicId] = line.split("\t");
    map.set(intValue(oldUserId), publicId);
  }
  return map;
}

function collectRefs(text, refs) {
  if (!text) return;
  const source = String(text);
  for (const match of source.matchAll(/upload:\/\/([A-Za-z0-9]+)(?:\.([a-zA-Z0-9]+))?/g)) {
    refs.add(`upload://${match[1]}${match[2] ? `.${match[2]}` : ""}`);
    refs.add(`upload://${match[1]}${match[2] ? `.${match[2].toLowerCase()}` : ""}`);
  }
  for (const match of source.matchAll(/(?:https?:\/\/(?:www\.)?(?:feople\.io|fstdesk\.com))?(\/uploads\/default\/original\/[^\s"'<>)]*)/gi)) {
    refs.add(match[1]);
    refs.add(`https://feople.io${match[1]}`);
  }
  for (const match of source.matchAll(/(?:https?:\/\/(?:www\.)?(?:feople\.io|fstdesk\.com))?(\/uploads\/short-url\/[A-Za-z0-9]+\.[a-zA-Z0-9]+)/g)) {
    const normalized = normalizeShortUrlExtension(match[1]);
    refs.add(match[1]);
    refs.add(normalized);
    refs.add(`https://feople.io${match[1]}`);
    refs.add(`https://feople.io${normalized}`);
  }
}

function replacementExpression(key, isPdf) {
  const base = `'/api/attachments/' || (SELECT id FROM attachments WHERE key = ${sqlString(key)})`;
  return isPdf ? `${base} || '?type=pdf'` : base;
}

function replaceStatement(table, oldValue, key, isPdf) {
  return `UPDATE ${table}
SET content = replace(content, ${sqlString(oldValue)}, ${replacementExpression(key, isPdf)})
WHERE instr(content, ${sqlString(oldValue)}) > 0
  AND EXISTS (SELECT 1 FROM attachments WHERE key = ${sqlString(key)});`;
}

async function main() {
  const dumpPath = resolve(readArg("--dump", defaultDumpPath()));
  const oldRoot = resolve(readArg("--old-root", defaultOldRoot()));
  const userMapPath = resolve(readArg("--user-map", DEFAULT_USER_MAP));
  const outSql = resolve(readArg("--out-sql", DEFAULT_OUT_SQL));
  const outManifest = resolve(readArg("--out-manifest", DEFAULT_OUT_MANIFEST));
  const outSummary = resolve(readArg("--out-summary", DEFAULT_OUT_SUMMARY));
  const userMap = await readUserMap(userMapPath);

  const categories = new Set();
  const topics = new Map();
  const posts = [];
  const uploads = new Map();
  const wanted = new Set(["categories", "topics", "posts", "uploads"]);

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
        if (id && !truthy(row.read_restricted)) categories.add(id);
      } else if (active.table === "topics") {
        const id = intValue(row.id);
        const categoryId = intValue(row.category_id);
        if (!id || row.deleted_at || !truthy(row.visible) || row.archetype !== "regular" || !categories.has(categoryId)) continue;
        topics.set(id, {
          id,
          publicId: publicTopicId(id),
          imageUploadId: intValue(row.image_upload_id),
        });
      } else if (active.table === "posts") {
        const topicId = intValue(row.topic_id);
        const postNumber = intValue(row.post_number);
        if (!topicId || !postNumber || row.deleted_at || truthy(row.hidden) || intValue(row.post_type, 1) !== 1) continue;
        posts.push({
          topicId,
          postNumber,
          raw: row.raw ?? "",
          cooked: row.cooked ?? "",
          imageUploadId: intValue(row.image_upload_id),
        });
      } else if (active.table === "uploads") {
        const id = intValue(row.id);
        const ext = extensionOf(row.url || row.original_filename || row.extension);
        if (!id || !ALLOWED_EXTENSIONS.has(ext)) continue;
        const url = normalizeUploadUrl(row.url);
        const sha1 = String(row.sha1 || row.original_sha1 || "").trim();
        if (!url || !sha1 || !/^[0-9a-f]{40}$/i.test(sha1)) continue;
        uploads.set(id, {
          id,
          userId: intValue(row.user_id),
          filename: cleanFilename(row.original_filename, `${sha1}.${ext}`),
          filesize: intValue(row.filesize, 0),
          url,
          sha1: sha1.toLowerCase(),
          ext,
          mime: MIME_BY_EXT[ext],
          createdAt: timestampSeconds(row.created_at),
        });
      }
      continue;
    }

    const header = parseCopyHeader(line);
    if (header) active = header;
  }

  const importedTopicIds = new Set([...topics.keys()]);
  const refs = new Set();
  const imageUploadIds = new Set();
  for (const post of posts) {
    if (!importedTopicIds.has(post.topicId)) continue;
    collectRefs(post.raw, refs);
    collectRefs(post.cooked, refs);
    if (post.imageUploadId) imageUploadIds.add(post.imageUploadId);
  }
  for (const topic of topics.values()) {
    if (topic.imageUploadId) imageUploadIds.add(topic.imageUploadId);
  }

  const uploadsByUrl = new Map();
  const uploadsByShort = new Map();
  for (const upload of uploads.values()) {
    uploadsByUrl.set(upload.url, upload);
    uploadsByUrl.set(`https://feople.io${upload.url}`, upload);
    const short = base62Sha1(upload.sha1);
    uploadsByShort.set(`${short}.${upload.ext}`, upload);
    uploadsByShort.set(short, upload);
    uploadsByUrl.set(`/uploads/short-url/${short}.${upload.ext}`, upload);
    uploadsByUrl.set(`https://feople.io/uploads/short-url/${short}.${upload.ext}`, upload);
  }

  const needed = new Map();
  const unresolvedRefs = [];

  for (const ref of refs) {
    let upload = null;
    if (ref.startsWith("upload://")) {
      upload = uploadsByShort.get(ref.slice("upload://".length)) ?? uploadsByShort.get(normalizeUploadTokenExtension(ref).slice("upload://".length));
    } else {
      upload = uploadsByUrl.get(ref) ?? uploadsByUrl.get(normalizeShortUrlExtension(ref));
    }
    if (upload) {
      const item = needed.get(upload.id) ?? { upload, refs: new Set() };
      item.refs.add(ref);
      needed.set(upload.id, item);
    } else {
      unresolvedRefs.push(ref);
    }
  }

  for (const uploadId of imageUploadIds) {
    const upload = uploads.get(uploadId);
    if (!upload) continue;
    const item = needed.get(upload.id) ?? { upload, refs: new Set() };
    item.refs.add(upload.url);
    needed.set(upload.id, item);
  }

  const ready = [];
  const missingFiles = [];
  for (const item of needed.values()) {
    const localPath = localPathForUrl(oldRoot, item.upload.url);
    if (!localPath || !existsSync(localPath)) {
      missingFiles.push({ uploadId: item.upload.id, url: item.upload.url, localPath });
      continue;
    }
    const size = statSync(localPath).size || item.upload.filesize || 0;
    ready.push({ ...item, localPath, size });
  }

  ready.sort((a, b) => a.upload.id - b.upload.id);

  const sql = [
    "-- Generated by scripts/import-old-uploads.mjs.",
    "-- Upload matching legacy Discourse post/topic images and PDFs to R2 first, then execute this SQL against remote D1.",
  ];
  const manifest = ["local_path\tkey\tcontent_type\tsize\tupload_id\tlegacy_url\tfilename"];

  for (const item of ready) {
    const upload = item.upload;
    const key = attachmentKey(upload, upload.ext);
    manifest.push([item.localPath, key, upload.mime, item.size, upload.id, upload.url, upload.filename].join("\t"));
    sql.push(
      `INSERT OR IGNORE INTO attachments (\`key\`, \`user_id\`, \`filename\`, \`mime\`, \`size\`, \`created_at\`) VALUES (${[
        sqlString(key),
        userIdSql(upload.userId, userMap),
        sqlString(upload.filename),
        sqlString(upload.mime),
        item.size,
        upload.createdAt,
      ].join(", ")});`,
    );
  }

  for (const item of ready) {
    const upload = item.upload;
    const key = attachmentKey(upload, upload.ext);
    const isPdf = upload.ext === "pdf";
    const short = base62Sha1(upload.sha1);
    const variants = new Set(item.refs);
    variants.add(upload.url);
    variants.add(`https://feople.io${upload.url}`);
    variants.add(`/uploads/short-url/${short}.${upload.ext}`);
    variants.add(`https://feople.io/uploads/short-url/${short}.${upload.ext}`);
    variants.add(`upload://${short}.${upload.ext}`);
    for (const variant of variants) {
      sql.push(replaceStatement("threads", variant, key, isPdf));
      sql.push(replaceStatement("posts", variant, key, isPdf));
    }
  }

  sql.push("");

  const summary = {
    dumpPath,
    oldRoot,
    userMapPath,
    importedTopics: topics.size,
    importedPosts: posts.filter((post) => importedTopicIds.has(post.topicId)).length,
    contentReferences: refs.size,
    imageUploadIds: imageUploadIds.size,
    matchedUploads: needed.size,
    readyUploads: ready.length,
    images: ready.filter((item) => item.upload.ext !== "pdf").length,
    pdfs: ready.filter((item) => item.upload.ext === "pdf").length,
    missingFiles: missingFiles.length,
    unresolvedRefs: unresolvedRefs.length,
    outSql,
    outManifest,
    outSummary,
  };

  await mkdir(dirname(outSql), { recursive: true });
  await writeFile(outSql, sql.join("\n"), "utf8");
  await writeFile(outManifest, manifest.join("\n"), "utf8");
  await writeFile(outSummary, JSON.stringify({ summary, missingFiles, unresolvedRefs: unresolvedRefs.slice(0, 100) }, null, 2), "utf8");

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
