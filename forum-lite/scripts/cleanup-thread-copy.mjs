import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const APPLY = process.argv.includes("--apply");
const LIMIT_ARG = process.argv.find((arg) => arg.startsWith("--limit="));
const LIMIT = LIMIT_ARG ? Math.max(1, Number(LIMIT_ARG.split("=")[1]) || 0) : 0;
const CONFIG = "wrangler.local.jsonc";
const DB = "forum-db";

function runWrangler(args) {
  return execFileSync("npx", ["wrangler", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 200 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function sqlQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function slugify(input) {
  return String(input)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "thread";
}

function protectInlineCode(line, transform) {
  const parts = line.split(/(`[^`]*`)/g);
  return parts.map((part) => part.startsWith("`") && part.endsWith("`") ? part : transform(part)).join("");
}

const replacements = [
  [/\bnon\s*[- ]\s*dairy\s+ice\s*cream\b/gi, "non-dairy ice cream"],
  [/\bnon\s*[- ]\s*dairy\b/gi, "non-dairy"],
  [/\botc\b/g, "OTC"],
  [/\bios\b/g, "iOS"],
  [/\bandroid\b/g, "Android"],
  [/\bcovid-19\b/gi, "COVID-19"],
  [/\bph\b/gi, "pH"],
  [/\bhaccp\b/gi, "HACCP"],
  [/\bfssc-?22000\b/gi, "FSSC 22000"],
  [/\biso\s*22000\b/gi, "ISO 22000"],
  [/\br&d\b/gi, "R&D"],
  [/\bfstdesk\b/gi, "FSTDESK"],
  [/\bprefered\b/gi, "preferred"],
  [/\bsweetner\b/gi, "sweetener"],
  [/\bxanthum\b/gi, "xanthan"],
  [/\bdoesnot\b/gi, "does not"],
  [/\bicecream\b/gi, "ice cream"],
];

function normalizeTextSegment(text) {
  let next = text;
  for (const [pattern, replacement] of replacements) next = next.replace(pattern, replacement);
  next = next
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/([,;:!?])(?=[A-Za-z])/g, "$1 ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s+\/\s+/g, " / ")
    .replace(/\.{4,}/g, "...")
    .replace(/\?{2,}/g, "?")
    .replace(/!{2,}/g, "!");
  return next;
}

function normalizeLine(line) {
  if (!line.trim()) return "";
  let next = line.replace(/\t/g, " ").replace(/[ \t]+$/g, "");
  if (!next.includes("|")) next = next.replace(/[ ]{2,}/g, " ");
  return protectInlineCode(next, normalizeTextSegment);
}

function normalizeBody(content) {
  let inFence = false;
  const lines = String(content ?? "").replace(/\r\n?/g, "\n").split("\n").map((line) => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      return line.replace(/[ \t]+$/g, "");
    }
    return inFence ? line.replace(/[ \t]+$/g, "") : normalizeLine(line);
  });
  return lines
    .join("\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function smartTitleCaseShortAllCaps(title) {
  const words = title.split(" ");
  if (words.length > 8 || !/^[A-Z0-9 /&()\-:]+$/.test(title)) return title;
  const keep = new Set(["R&D", "HACCP", "ISO", "FSSC", "COVID-19", "OTC", "pH", "iOS"]);
  return words.map((word) => {
    if (keep.has(word)) return word;
    if (/^[A-Z]{2,}$/.test(word)) return word.charAt(0) + word.slice(1).toLowerCase();
    return word;
  }).join(" ");
}

function normalizeTitle(title) {
  let next = normalizeBody(title).replace(/\s*\n+\s*/g, " ");
  next = next
    .replace(/\s+-\s+/g, " - ")
    .replace(/^Manufacturing of non-dairy ice cream$/i, "Manufacturing of Non-Dairy Ice Cream")
    .replace(/^Manufacturing of - non-dairy ice cream$/i, "Manufacturing of Non-Dairy Ice Cream")
    .replace(/^What is flavour enhancers\?$/i, "What are Flavour Enhancers?")
    .replace(/^Hara analysis for packaging$/i, "HARA Analysis for Packaging")
    .replace(/^Food can Packaging$/i, "Food Can Packaging")
    .replace(/^pH of non-dairy whipping cream$/i, "pH of Non-Dairy Whipping Cream");
  next = smartTitleCaseShortAllCaps(next);
  if (/^[a-z]/.test(next) && !/^pH\b/.test(next)) next = next.charAt(0).toUpperCase() + next.slice(1);
  return next.trim();
}

const select = "SELECT id, public_id AS publicId, title, slug, content, updated_at AS updatedAt FROM threads ORDER BY id";
const output = runWrangler(["d1", "execute", DB, "--remote", "--config", CONFIG, "--json", "--command", select]);
const json = JSON.parse(output);
const rows = json[0]?.results ?? [];
const changes = [];

for (const row of rows) {
  const title = normalizeTitle(row.title);
  const content = normalizeBody(row.content);
  if (title !== row.title || content !== row.content) {
    changes.push({
      id: row.id,
      publicId: row.publicId,
      beforeTitle: row.title,
      beforeSlug: row.slug,
      beforeContent: row.content,
      beforeUpdatedAt: row.updatedAt,
      title,
      content,
      slug: title !== row.title ? slugify(title) : row.slug,
      titleChanged: title !== row.title,
      contentChanged: content !== row.content,
    });
  }
}

const selected = LIMIT ? changes.slice(0, LIMIT) : changes;
console.log(`${APPLY ? "apply" : "dry-run"}: ${selected.length}/${rows.length} threads would be updated`);
for (const change of selected.slice(0, 20)) {
  const marks = [change.titleChanged ? "title" : "", change.contentChanged ? "content" : ""].filter(Boolean).join("+");
  console.log(`#${change.id} ${change.publicId} [${marks}]`);
  if (change.titleChanged) console.log(`  ${change.beforeTitle} -> ${change.title}`);
}

if (!APPLY || selected.length === 0) process.exit(0);

const now = Math.floor(Date.now() / 1000);
const statements = selected.map((change) =>
  [
    "UPDATE threads SET",
    `title = ${sqlQuote(change.title)},`,
    `slug = ${sqlQuote(change.slug)},`,
    `content = ${sqlQuote(change.content)},`,
    `updated_at = ${now}`,
    `WHERE id = ${Number(change.id)};`,
  ].join(" "),
);

const dir = mkdtempSync(join(tmpdir(), "fstdesk-thread-cleanup-"));
const sqlFile = join(dir, "cleanup.sql");
const undoFile = join(dir, "undo.sql");
writeFileSync(sqlFile, statements.join("\n"), "utf8");
writeFileSync(
  undoFile,
  selected.map((change) =>
    [
      "UPDATE threads SET",
      `title = ${sqlQuote(change.beforeTitle)},`,
      `slug = ${sqlQuote(change.beforeSlug)},`,
      `content = ${sqlQuote(change.beforeContent)},`,
      `updated_at = ${Number(change.beforeUpdatedAt) || "NULL"}`,
      `WHERE id = ${Number(change.id)};`,
    ].join(" "),
  ).join("\n"),
  "utf8",
);
runWrangler(["d1", "execute", DB, "--remote", "--config", CONFIG, "--file", sqlFile]);
console.log(`updated ${selected.length} threads; updated_at=${now}`);
console.log(`rollback SQL: ${undoFile}`);
