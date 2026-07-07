import type { Context } from "hono";
import type { Bindings, Variables } from "../types";

type AppContext = Context<{ Bindings: Bindings; Variables: Variables }>;

export type OgThreadData = {
  publicId: string;
  title: string;
  description: string;
  categoryName: string;
  categoryColor: string;
  authorName: string;
  replyCount: number;
  views: number;
  tags: string[];
  updatedAt: string;
};

const WIDTH = 1200;
const HEIGHT = 630;
const SVG_CONTENT_TYPE = "image/svg+xml; charset=utf-8";
const WEBP_CONTENT_TYPE = "image/webp";
const OG_CACHE = "public, max-age=86400, stale-while-revalidate=604800";

function escapeXml(input: unknown): string {
  return String(input ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function cleanText(input: unknown, max = 240): string {
  const text = String(input ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/\[\/?quote[^\]]*]/gi, " ")
    .replace(/[`*_>#|~=-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1)).trim()}...` : text;
}

function wrapText(input: unknown, maxChars: number, maxLines: number): string[] {
  const words = cleanText(input, 900).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
      if (lines.length >= maxLines) break;
    } else {
      line = next;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/\.*$/, "")}...`;
  }
  return lines;
}

function textLines(lines: string[], x: number, y: number, size: number, color: string, lineHeight: number, weight = 500): string {
  return lines
    .map(
      (line, index) =>
        `<text x="${x}" y="${y + index * lineHeight}" font-family="JetBrains Mono, Fira Code, Courier New, monospace" font-size="${size}" font-weight="${weight}" fill="${color}">${escapeXml(line)}</text>`,
    )
    .join("\n");
}

function centeredTextLines(lines: string[], x: number, y: number, size: number, color: string, lineHeight: number, weight = 500): string {
  return lines
    .map(
      (line, index) =>
        `<text x="${x}" y="${y + index * lineHeight}" text-anchor="middle" font-family="JetBrains Mono, Fira Code, Courier New, monospace" font-size="${size}" font-weight="${weight}" fill="${color}">${escapeXml(line)}</text>`,
    )
    .join("\n");
}

function shellRows(startY: number, count: number): string {
  return Array.from({ length: count }, (_, index) => {
    const y = startY + index * 28;
    return `<line x1="198" y1="${y}" x2="1138" y2="${y}" stroke="#3c3836" stroke-width="1" opacity=".72" />`;
  }).join("\n");
}

function baseSvg(inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#282828" />
  <rect x="0" y="0" width="${WIDTH}" height="52" fill="#32302f" />
  <rect x="0" y="0" width="132" height="52" fill="#1d2021" />
  <text x="32" y="34" font-family="JetBrains Mono, Fira Code, Courier New, monospace" font-size="20" font-weight="800" fill="#fabd2f">forum</text>
  <text x="1060" y="34" font-family="JetBrains Mono, Fira Code, Courier New, monospace" font-size="14" fill="#a89984">lang: EN</text>
  <rect x="0" y="52" width="182" height="578" fill="#3c3836" />
  <text x="26" y="94" font-family="JetBrains Mono, Fira Code, Courier New, monospace" font-size="14" font-weight="800" letter-spacing="1.6" fill="#928374">" NAVIGATION</text>
  <text x="28" y="132" font-family="JetBrains Mono, Fira Code, Courier New, monospace" font-size="18" fill="#928374"># threads</text>
  <text x="28" y="166" font-family="JetBrains Mono, Fira Code, Courier New, monospace" font-size="18" fill="#a89984"># members</text>
  <text x="28" y="200" font-family="JetBrains Mono, Fira Code, Courier New, monospace" font-size="18" fill="#a89984"># tags</text>
  <line x1="182" y1="52" x2="182" y2="630" stroke="#504945" stroke-width="2" />
  <text x="212" y="88" font-family="JetBrains Mono, Fira Code, Courier New, monospace" font-size="18" fill="#a89984">~ /</text>
  ${shellRows(116, 16)}
  ${inner}
</svg>`;
}

export function defaultOgSvg(): string {
  const title = ["FSTDESK Forum"];
  const desc = ["Food science, food safety, product development", "and food technology discussions."];
  return baseSvg(`
  <text x="258" y="88" font-family="JetBrains Mono, Fira Code, Courier New, monospace" font-size="18" font-weight="800" fill="#b8bb26">threads /</text>
  <rect x="218" y="136" width="884" height="290" rx="0" fill="#32302f" stroke="#504945" />
  ${centeredTextLines(title, 660, 274, 54, "#fbf1c7", 62, 900)}
  ${centeredTextLines(desc, 660, 352, 24, "#d5c4a1", 34, 500)}
  <text x="250" y="488" font-family="JetBrains Mono, Fira Code, Courier New, monospace" font-size="20" fill="#83a598">food science</text>
  <text x="472" y="488" font-family="JetBrains Mono, Fira Code, Courier New, monospace" font-size="20" fill="#b8bb26">product development</text>
  <text x="818" y="488" font-family="JetBrains Mono, Fira Code, Courier New, monospace" font-size="20" fill="#fabd2f">forum</text>
  <text x="1068" y="566" text-anchor="end" font-family="JetBrains Mono, Fira Code, Courier New, monospace" font-size="20" font-weight="800" fill="#fabd2f">FSTDESK</text>`);
}

export function threadOgSvg(data: OgThreadData): string {
  const title = wrapText(data.title, 29, 3);
  const description = wrapText(data.description, 60, 3);
  const tags = data.tags.slice(0, 4);
  const tagText = tags.length ? tags.map((tag) => `#${tag}`).join("   ") : "#discussion";
  const categoryColor = /^#[0-9a-f]{6}$/i.test(data.categoryColor) ? data.categoryColor : "#b8bb26";

  return baseSvg(`
  <text x="258" y="88" font-family="JetBrains Mono, Fira Code, Courier New, monospace" font-size="18" fill="#a89984">threads /</text>
  <text x="374" y="88" font-family="JetBrains Mono, Fira Code, Courier New, monospace" font-size="18" font-weight="800" fill="${categoryColor}">${escapeXml(data.categoryName.toLowerCase())} /</text>
  <rect x="218" y="124" width="884" height="362" rx="0" fill="#32302f" stroke="#504945" />
  ${centeredTextLines(title, 660, 238, 42, "#fbf1c7", 52, 900)}
  ${centeredTextLines(description, 660, 392, 22, "#d5c4a1", 31, 500)}
  <line x1="250" y1="510" x2="1038" y2="510" stroke="#504945" />
  <text x="250" y="548" font-family="JetBrains Mono, Fira Code, Courier New, monospace" font-size="18" fill="#a89984">by</text>
  <text x="286" y="548" font-family="JetBrains Mono, Fira Code, Courier New, monospace" font-size="18" font-weight="800" fill="#b8bb26">${escapeXml(data.authorName)}</text>
  <text x="540" y="548" font-family="JetBrains Mono, Fira Code, Courier New, monospace" font-size="18" fill="#8ec07c">${data.replyCount} replies</text>
  <text x="704" y="548" font-family="JetBrains Mono, Fira Code, Courier New, monospace" font-size="18" fill="#83a598">${data.views} views</text>
  <text x="250" y="588" font-family="JetBrains Mono, Fira Code, Courier New, monospace" font-size="17" fill="#d3869b">${escapeXml(tagText)}</text>
  <text x="1068" y="588" text-anchor="end" font-family="JetBrains Mono, Fira Code, Courier New, monospace" font-size="20" font-weight="800" fill="#fabd2f">FSTDESK</text>`);
}

function svgResponse(svg: string, headers?: HeadersInit): Response {
  return new Response(svg, {
    headers: {
      "Content-Type": SVG_CONTENT_TYPE,
      "Cache-Control": OG_CACHE,
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

function webpObjectResponse(object: R2ObjectBody, extraHeaders?: HeadersInit): Response {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", WEBP_CONTENT_TYPE);
  headers.set("Cache-Control", OG_CACHE);
  headers.set("ETag", object.httpEtag);
  headers.set("X-Content-Type-Options", "nosniff");
  for (const [key, value] of Object.entries(extraHeaders ?? {})) headers.set(key, String(value));
  return new Response(object.body, { headers });
}

async function defaultWebpResponse(c: AppContext, extraHeaders?: HeadersInit): Promise<Response> {
  const bucket = c.env.BUCKET;
  const object = bucket ? await bucket.get("og/default.webp") : null;
  if (object) return webpObjectResponse(object, extraHeaders);

  const assetUrl = new URL("/og-default.webp", c.req.url);
  const assetResponse = await c.env.ASSETS.fetch(new Request(assetUrl.toString(), { headers: c.req.raw.headers }));
  if (assetResponse.ok) {
    const headers = new Headers(assetResponse.headers);
    headers.set("Content-Type", WEBP_CONTENT_TYPE);
    headers.set("Cache-Control", OG_CACHE);
    headers.set("X-Content-Type-Options", "nosniff");
    for (const [key, value] of Object.entries(extraHeaders ?? {})) headers.set(key, String(value));
    return new Response(assetResponse.body, { status: assetResponse.status, headers });
  }

  return svgResponse(defaultOgSvg(), { "X-OG-Fallback": "svg" });
}

export async function serveDefaultWebp(c: AppContext): Promise<Response> {
  return defaultWebpResponse(c);
}

async function loadThreadOgData(c: AppContext, rawId: string): Promise<OgThreadData | null> {
  const id = rawId.replace(/\.(svg|png|jpg|jpeg|webp)$/i, "");
  const thread = await c.env.DB.prepare(
    `SELECT t.id, t.public_id AS publicId, t.title, t.content, t.reply_count AS replyCount, t.views,
      t.updated_at AS updatedAt, t.last_post_at AS lastPostAt,
      c.name AS categoryName, c.color AS categoryColor,
      u.display_name AS authorName
    FROM threads t
    INNER JOIN categories c ON c.id = t.category_id
    INNER JOIN users u ON u.id = t.user_id
    WHERE t.public_id = ? OR t.id = ? OR printf('%012d', 100000000000 + ((t.id * 982451653 + 57885161) % 900000000000)) = ?
    LIMIT 1`,
  )
    .bind(id, Number.isInteger(Number(id)) ? Number(id) : -1, id)
    .first<Record<string, unknown>>();

  if (!thread) return null;

  const tagRows = await c.env.DB.prepare(
    `SELECT tags.name
     FROM tags
     INNER JOIN thread_tags tt ON tt.tag_id = tags.id
     WHERE tt.thread_id = ?
     ORDER BY tags.name
     LIMIT 6`,
  )
    .bind(Number(thread.id))
    .all<Record<string, unknown>>();

  return {
    publicId: String(thread.publicId),
    title: String(thread.title),
    description: cleanText(thread.content, 260),
    categoryName: String(thread.categoryName),
    categoryColor: String(thread.categoryColor || "#b8bb26"),
    authorName: String(thread.authorName),
    replyCount: Number(thread.replyCount ?? 0),
    views: Number(thread.views ?? 0),
    tags: (tagRows.results ?? []).map((tag) => String(tag.name)),
    updatedAt: String(thread.lastPostAt ?? thread.updatedAt ?? ""),
  };
}

export async function serveThreadWebp(c: AppContext, rawId: string): Promise<Response> {
  const data = await loadThreadOgData(c, rawId);
  if (!data) return defaultWebpResponse(c, { "X-OG-Missing": "thread" });

  const object = c.env.BUCKET ? await c.env.BUCKET.get(`og/thread/${data.publicId}.webp`) : null;
  if (object) return webpObjectResponse(object);

  return defaultWebpResponse(c, { "X-OG-Missing": `og/thread/${data.publicId}.webp` });
}
