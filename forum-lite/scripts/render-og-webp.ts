import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { defaultOgSvg, threadOgSvg, type OgThreadData } from "../src/worker/lib/og";

type ThreadRow = {
  publicId: string;
  title: string;
  content: string;
  replyCount: number;
  views: number;
  updatedAt: number | string | null;
  lastPostAt: number | string | null;
  categoryName: string;
  categoryColor: string;
  authorName: string;
  tags: string | null;
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wranglerBin = path.join(root, "node_modules", ".bin", "wrangler");
const publicDir = path.join(root, "public");
const tmpDir = path.join(root, "tmp", "og");
const threadDir = path.join(tmpDir, "thread");
const args = process.argv.slice(2);
const renderThreads = args.includes("--threads");
const upload = args.includes("--upload");
const clean = args.includes("--clean");
const limitArg = args.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Math.max(1, Number(limitArg.slice("--limit=".length)) || 0) : 0;
const bucket = process.env.OG_R2_BUCKET || "fstdesk";
const config = process.env.WRANGLER_CONFIG || "wrangler.local.jsonc";
const cacheControl = "public, max-age=86400, stale-while-revalidate=604800";
const concurrency = Math.max(1, Number(process.env.OG_UPLOAD_CONCURRENCY || "8") || 8);
const fontFile =
  process.env.OG_FONT_FILE ||
  path.join(process.env.HOME || "", "Library", "Fonts", "JetBrainsMonoNLNerdFont-Regular (2).ttf");
let embeddedFontCss: string | null = null;

const execFileAsync = promisify(execFile);

function runWrangler(args: string[]): string {
  return execFileSync(wranglerBin, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 80,
    stdio: ["ignore", "pipe", "inherit"],
  });
}

async function runWranglerAsync(args: string[]): Promise<void> {
  await execFileAsync(wranglerBin, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 8,
  });
}

async function svgWithFont(svg: string): Promise<string> {
  if (embeddedFontCss === null) {
    try {
      const font = await readFile(fontFile);
      const data = font.toString("base64");
      embeddedFontCss = [
        "<defs>",
        "<style>",
        "@font-face{font-family:'JetBrains Mono';src:url(data:font/ttf;base64,",
        data,
        ") format('truetype');font-weight:300 900;font-style:normal;}",
        "</style>",
        "</defs>",
      ].join("");
    } catch {
      embeddedFontCss = "";
      console.warn(`warning: JetBrains Mono font not found at ${fontFile}`);
    }
  }
  return embeddedFontCss ? svg.replace(/(<svg\b[^>]*>)/, `$1\n${embeddedFontCss}`) : svg;
}

async function renderWebp(svg: string, file: string) {
  await mkdir(path.dirname(file), { recursive: true });
  await sharp(Buffer.from(await svgWithFont(svg))).resize(1200, 630).webp({ quality: 88, effort: 5 }).toFile(file);
}

async function uploadObject(key: string, file: string) {
  await runWranglerAsync([
    "r2",
    "object",
    "put",
    `${bucket}/${key}`,
    "--file",
    file,
    "--content-type",
    "image/webp",
    "--cache-control",
    cacheControl,
    "--remote",
    "--config",
    config,
    "--force",
  ]);
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T, index: number) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      await fn(items[index], index);
    }
  });
  await Promise.all(workers);
}

function queryThreads(): ThreadRow[] {
  const sql = [
    "SELECT",
    "t.public_id AS publicId, t.title, t.content, t.reply_count AS replyCount, t.views,",
    "t.updated_at AS updatedAt, t.last_post_at AS lastPostAt,",
    "c.name AS categoryName, c.color AS categoryColor, u.display_name AS authorName,",
    "COALESCE(GROUP_CONCAT(tags.name, '||'), '') AS tags",
    "FROM threads t",
    "INNER JOIN categories c ON c.id = t.category_id",
    "INNER JOIN users u ON u.id = t.user_id",
    "LEFT JOIN thread_tags tt ON tt.thread_id = t.id",
    "LEFT JOIN tags ON tags.id = tt.tag_id",
    "GROUP BY t.id",
    "ORDER BY t.id",
    limit ? `LIMIT ${limit}` : "",
  ].filter(Boolean).join(" ");

  const out = runWrangler(["d1", "execute", "forum-db", "--remote", "--config", config, "--json", "--command", sql]);
  const parsed = JSON.parse(out) as Array<{ results?: ThreadRow[] }>;
  return parsed.flatMap((chunk) => chunk.results ?? []);
}

function toThreadData(row: ThreadRow): OgThreadData {
  return {
    publicId: String(row.publicId),
    title: String(row.title),
    description: String(row.content ?? ""),
    categoryName: String(row.categoryName),
    categoryColor: String(row.categoryColor || "#b8bb26"),
    authorName: String(row.authorName),
    replyCount: Number(row.replyCount ?? 0),
    views: Number(row.views ?? 0),
    tags: String(row.tags ?? "").split("||").map((tag) => tag.trim()).filter(Boolean),
    updatedAt: String(row.lastPostAt ?? row.updatedAt ?? ""),
  };
}

async function main() {
  if (clean) await rm(tmpDir, { recursive: true, force: true });
  await mkdir(publicDir, { recursive: true });
  await mkdir(threadDir, { recursive: true });

  const defaultFile = path.join(publicDir, "og-default.webp");
  await renderWebp(defaultOgSvg(), defaultFile);
  console.log(`created ${path.relative(root, defaultFile)}`);
  if (upload) {
    await uploadObject("og/default.webp", defaultFile);
    console.log(`uploaded ${bucket}/og/default.webp`);
  }

  if (!renderThreads) return;

  const rows = queryThreads();
  console.log(`rendering ${rows.length} thread OG images`);
  let done = 0;
  await mapLimit(rows, upload ? concurrency : 4, async (row) => {
    const data = toThreadData(row);
    const file = path.join(threadDir, `${data.publicId}.webp`);
    await renderWebp(threadOgSvg(data), file);
    if (upload) await uploadObject(`og/thread/${data.publicId}.webp`, file);
    done += 1;
    if (done % 25 === 0 || done === rows.length) console.log(`done ${done}/${rows.length}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
