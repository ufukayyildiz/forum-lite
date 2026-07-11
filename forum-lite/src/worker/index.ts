import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { withDb, loadUser } from "./lib/middleware";
import authRoutes from "./routes/auth";
import categoryRoutes from "./routes/categories";
import threadRoutes from "./routes/threads";
import postRoutes from "./routes/posts";
import memberRoutes from "./routes/members";
import tagRoutes from "./routes/tags";
import searchRoutes from "./routes/search";
import adminRoutes, { processMarketingJobs } from "./routes/admin";
import attachmentRoutes from "./routes/attachments";
import contactRoutes from "./routes/contact";
import anchorRoutes from "./routes/anchors";
import { schema, getDb } from "./db";
import type { Bindings, Variables } from "./types";
import { hasPendingTranslationJobs, processTranslationJobs, renderSeoHtml } from "./lib/seo";
import { serveDefaultWebp, serveThreadWebp } from "./lib/og";
import { legacyCanonicalRedirect } from "./lib/legacy-redirects";
import { parseBounceEmail } from "./lib/bounce";
import { recordEmailSuppression } from "./lib/email-suppression";
import { unsubscribeByToken } from "./lib/notifications";
import { createAnalyticsPageview, updateAnalyticsDuration } from "./lib/analytics";
import { syncCloudflareEmailSuppressions } from "./lib/email-sync";
import { errorToRecord, recordErrorEvent, requestErrorMeta } from "./lib/error-events";
import { ensureCoreSchema } from "./lib/core-schema";
import { localizedAlternates } from "../shared/locales";

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function isD1Backpressure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /D1_ERROR: D1 DB is overloaded|Requests queued for too long|database is locked|too many requests/i.test(message);
}

const ADS_SETTINGS_TIMEOUT_MS = 200;
const CF_SUPPRESSION_SYNC_LAST_SETTING_KEY = "cf_suppression_sync_last_at";
const CF_SUPPRESSION_SYNC_INTERVAL_SECONDS = 12 * 60 * 60;
const API_LIGHT_PATHS = new Set([
  "/api/ads",
  "/api/client-errors",
  "/api/analytics/view",
  "/api/analytics/duration",
  "/api/healthz",
]);
type PublicApiCachePolicy = { browserTtl: number; edgeTtl: number };
const PUBLIC_API_DEFAULT_CACHE: PublicApiCachePolicy = { browserTtl: 30, edgeTtl: 120 };
const PUBLIC_API_STABLE_CACHE: PublicApiCachePolicy = { browserTtl: 60, edgeTtl: 300 };
const PUBLIC_API_FAST_CACHE: PublicApiCachePolicy = { browserTtl: 15, edgeTtl: 60 };

function requestPath(url: string) {
  return new URL(url).pathname;
}

function isLightApiPath(path: string) {
  return API_LIGHT_PATHS.has(path);
}

function shouldRecordApiResponseStatus(status: number) {
  return status >= 500 || status === 429;
}

function publicApiCachePolicy(request: Request): PublicApiCachePolicy | null {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === "/api/stats" || path === "/api/categories" || path === "/api/tags" || path === "/api/anchors") {
    return PUBLIC_API_STABLE_CACHE;
  }
  if (path === "/api/threads" || path === "/api/threads/recent" || path === "/api/threads/featured") {
    return PUBLIC_API_FAST_CACHE;
  }
  if (path === "/api/members") {
    return PUBLIC_API_DEFAULT_CACHE;
  }
  if (/^\/api\/categories\/[^/]+$/.test(path) || /^\/api\/tags\/[^/]+$/.test(path)) {
    return PUBLIC_API_DEFAULT_CACHE;
  }
  return null;
}

function isPublicReadApiRequest(request: Request) {
  return publicApiCachePolicy(request) !== null;
}

function publicApiCacheHeader(policy: PublicApiCachePolicy) {
  return `public, max-age=${policy.browserTtl}, stale-while-revalidate=${policy.edgeTtl}`;
}

function publicApiCacheKey(request: Request) {
  const url = new URL(request.url);
  return new Request(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
  });
}

function scheduleCoreSchemaWarmup(c: any) {
  c.executionCtx.waitUntil(
    ensureCoreSchema(c.env.DB).catch((error) => {
      if (!isD1Backpressure(error)) {
        console.warn("core_schema_warmup_failed", errorToRecord(error).message);
      }
    }),
  );
}

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function shouldRunScheduledCloudflareSuppressionSync(env: Bindings): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - CF_SUPPRESSION_SYNC_INTERVAL_SECONDS;
  await env.DB.prepare(
    `INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`,
  ).bind(CF_SUPPRESSION_SYNC_LAST_SETTING_KEY, "0").run();
  const row = await env.DB.prepare(
    `SELECT value FROM settings WHERE key = ? LIMIT 1`,
  ).bind(CF_SUPPRESSION_SYNC_LAST_SETTING_KEY).first<{ value: string }>();
  const last = Number(row?.value ?? "0");
  if (Number.isFinite(last) && last > cutoff) return false;
  await env.DB.prepare(
    `UPDATE settings SET value = ? WHERE key = ?`,
  ).bind(String(now), CF_SUPPRESSION_SYNC_LAST_SETTING_KEY).run();
  return true;
}

app.get("/api/healthz", (c) => c.json({ ok: true, ts: Date.now() }));

app.use("*", logger());
app.use("/api/*", cors({ origin: "*" }));
app.use("/api/*", async (c, next) => {
  await next();
  c.header("X-Robots-Tag", "noindex, nofollow");
});
app.use("/api/*", async (c, next) => {
  const policy = publicApiCachePolicy(c.req.raw);
  if (!policy) {
    await next();
    return;
  }

  const cacheKey = publicApiCacheKey(c.req.raw);
  const cached = await caches.default.match(cacheKey);
  if (cached) {
    const response = new Response(cached.body, cached);
    response.headers.set("Cache-Control", publicApiCacheHeader(policy));
    response.headers.set("CDN-Cache-Control", `public, max-age=${policy.edgeTtl}`);
    response.headers.set("Cloudflare-CDN-Cache-Control", `public, max-age=${policy.edgeTtl}`);
    response.headers.set("Vary", "Accept");
    response.headers.set("X-FSTDESK-Cache", "HIT");
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    return response;
  }

  await next();

  const contentType = c.res.headers.get("content-type") ?? "";
  if (c.res.status === 200 && contentType.includes("application/json")) {
    c.header("Cache-Control", publicApiCacheHeader(policy));
    c.header("CDN-Cache-Control", `public, max-age=${policy.edgeTtl}`);
    c.header("Cloudflare-CDN-Cache-Control", `public, max-age=${policy.edgeTtl}`);
    c.header("Vary", "Accept");
    c.header("X-FSTDESK-Cache", "MISS");
    c.executionCtx.waitUntil(caches.default.put(cacheKey, c.res.clone()));
  }
});
app.use("/api/*", withDb);
app.use("/api/*", async (c, next) => {
  const path = requestPath(c.req.url);
  if (!isLightApiPath(path) && !isPublicReadApiRequest(c.req.raw)) {
    const ready = await ensureCoreSchema(c.env.DB);
    if (!ready) {
      console.warn("core_schema_check_deferred", path);
      scheduleCoreSchemaWarmup(c);
    }
  }
  await next();
});
app.use("/api/*", async (c, next) => {
  const path = requestPath(c.req.url);
  if (path === "/api/ads") {
    await loadUser(c, next);
    return;
  }
  if (isLightApiPath(path) || isPublicReadApiRequest(c.req.raw)) {
    c.set("user", null);
    await next();
    return;
  }
  await loadUser(c, next);
});
app.use("/api/*", async (c, next) => {
  const startedAt = Date.now();
  await next();
  const status = c.res.status;
  const path = requestPath(c.req.url);
  if (shouldRecordApiResponseStatus(status) && path !== "/api/client-errors") {
    c.executionCtx.waitUntil(recordErrorEvent(c.env.DB, {
      ...requestErrorMeta(c),
      source: "api",
      level: status >= 500 ? "error" : "warn",
      kind: "api_response",
      status,
      message: `API ${c.req.method} ${path} returned ${status}`,
      metadata: {
        durationMs: Date.now() - startedAt,
        cacheControl: c.res.headers.get("cache-control"),
        contentType: c.res.headers.get("content-type"),
      },
    }));
  }
});

app.onError((error, c) => {
  const record = errorToRecord(error);
  c.executionCtx.waitUntil(recordErrorEvent(c.env.DB, {
    ...requestErrorMeta(c),
    source: "worker",
    level: "error",
    kind: "exception",
    status: 500,
    message: record.message,
    stack: record.stack,
    metadata: { name: record.name },
  }));
  if (isD1Backpressure(error)) console.warn("worker_exception", record.message);
  else console.error("worker_exception", error);
  return c.json({ error: "Internal server error" }, 500);
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function metadataString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" ? value : null;
}

function isLikelyBotUserAgent(userAgent: string | null | undefined) {
  return /bot|crawler|spider|slurp|google-inspectiontool|lighthouse|pagespeed|baiduspider/i.test(userAgent ?? "");
}

function isBenignBrowserBridgeError(text: string) {
  return /Object Not Found Matching Id:\d+,\s*MethodName:[a-zA-Z0-9_]+,\s*ParamCount:\d+/i.test(text);
}

function isBenignNetworkMessage(message: string) {
  return /^(Load failed|Failed to fetch|Network request failed|cancelled)$/i.test(message.trim());
}

function ignoredClientErrorEvent(body: Record<string, unknown>, userAgent?: string | null) {
  const kind = typeof body.kind === "string" ? body.kind : "";
  const message = typeof body.message === "string" ? body.message : "";
  const reason = typeof body.reason === "string" ? body.reason : "";
  const stack = typeof body.stack === "string" ? body.stack : "";
  const metadata = isRecord(body.metadata) ? body.metadata : {};
  const status = typeof metadata.status === "number" ? metadata.status : null;
  const path = metadataString(metadata, "path");

  if (isBenignBrowserBridgeError(`${message}\n${reason}\n${stack}`)) {
    return true;
  }
  if ((kind === "unhandled_rejection" || kind === "window_error") && isBenignNetworkMessage(message)) {
    return true;
  }
  if (kind === "api_network_error" && /failed to fetch|load failed|network request failed|cancelled/i.test(message)) {
    return true;
  }
  if (kind === "api_error_response" && path === "/auth/me" && status !== null && status >= 500 && isLikelyBotUserAgent(userAgent)) {
    return true;
  }
  if (kind === "api_error_response" && /<unknown status code>|forbidden/i.test(message) && !status) {
    return true;
  }
  if (kind === "api_error_response" && status === 599) {
    return true;
  }
  if (kind === "api_error_response" && status !== null && status < 500 && status !== 429) {
    return true;
  }
  return false;
}

app.post("/api/client-errors", async (c) => {
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  if (ignoredClientErrorEvent(body, c.req.header("user-agent"))) return c.json({ ok: true, ignored: true });
  const source = body.source === "react" ? "react" : "client";
  const kind = typeof body.kind === "string" ? body.kind : "client_error";
  const message = typeof body.message === "string" ? body.message : "Client error";
  const stack = typeof body.stack === "string" ? body.stack : null;
  const metadata = isRecord(body.metadata) ? body.metadata : {};
  const status = typeof metadata.status === "number" ? metadata.status : null;
  c.executionCtx.waitUntil(recordErrorEvent(c.env.DB, {
    ...requestErrorMeta(c),
    source,
    level: status !== null && status < 500 ? "warn" : "error",
    kind,
    message,
    stack,
    metadata: {
      href: typeof body.href === "string" ? body.href : undefined,
      componentStack: typeof body.componentStack === "string" ? body.componentStack : undefined,
      reason: typeof body.reason === "string" ? body.reason : undefined,
      viewport: body.viewport,
    },
  }));
  return c.json({ ok: true });
});

app.get("/api/stats", async (c) => {
  const db = c.get("db");
  const [users, threads, posts] = await Promise.all([
    db.$count(schema.users),
    db.$count(schema.threads),
    db.$count(schema.posts),
  ]);
  c.header("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  return c.json({ users, threads, posts });
});

app.route("/api/auth", authRoutes);
app.route("/api/categories", categoryRoutes);
app.route("/api/threads", threadRoutes);
app.route("/api/posts", postRoutes);
app.route("/api/members", memberRoutes);
app.route("/api/tags", tagRoutes);
app.route("/api/search", searchRoutes);
app.route("/api/contact", contactRoutes);
app.route("/api/anchors", anchorRoutes);
app.route("/api/admin", adminRoutes);
app.route("/api/attachments", attachmentRoutes);

app.post("/api/analytics/view", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const payload = body && typeof body === "object" ? body as Record<string, unknown> : {};
  c.executionCtx.waitUntil(
    createAnalyticsPageview(c, payload).catch((error) => {
      if (!isD1Backpressure(error)) console.warn("analytics_view_failed", errorToRecord(error).message);
    }),
  );
  return c.json({ ok: true, id: 0, queued: true }, 202);
});

app.post("/api/analytics/duration", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const payload = body && typeof body === "object" ? body as Record<string, unknown> : {};
  c.executionCtx.waitUntil(
    updateAnalyticsDuration(c, payload).catch((error) => {
      if (!isD1Backpressure(error)) console.warn("analytics_duration_failed", errorToRecord(error).message);
    }),
  );
  return c.json({ ok: true, queued: true }, 202);
});

function shouldEnsureCoreSchema(path: string) {
  if (path.startsWith("/api/")) return false;
  if (path.startsWith("/assets/") || path.startsWith("/cdn-cgi/")) return false;
  if (
    path === "/favicon.ico" ||
    path === "/og-default.svg" ||
    path === "/robots.txt" ||
    path === "/llms.txt" ||
    path === "/llms-full.txt" ||
    path === "/ads.txt" ||
    path === "/sitemap.xml" ||
    path === "/sitemap-index.xml" ||
    path.startsWith("/sitemap-")
  ) return false;
  if (/\.(?:css|js|map|png|jpg|jpeg|gif|svg|webp|ico)$/i.test(path)) return false;
  return true;
}

app.use("*", async (c, next) => {
  const path = requestPath(c.req.url);
  if (!shouldEnsureCoreSchema(path)) return next();
  scheduleCoreSchemaWarmup(c);
  await next();
});

function originFromRequest(url: string): string {
  const reqUrl = new URL(url);
  return `${reqUrl.protocol}//${reqUrl.host.replace(/[^a-zA-Z0-9.\-:[\]]/g, "")}`;
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function safeDate(v: number | string | Date | null | undefined): string {
  if (!v) return new Date().toISOString().slice(0, 10);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const ms = typeof v === "number" ? (v > 1e10 ? v : v * 1000) : Date.parse(v);
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10);
}

function newestDate(...values: Array<number | string | Date | null | undefined>): number | string | Date | null {
  let newest: { value: number | string | Date; time: number } | null = null;
  for (const value of values) {
    if (!value) continue;
    const time = value instanceof Date ? value.getTime() : typeof value === "number" ? (value > 1e10 ? value : value * 1000) : Date.parse(value);
    if (Number.isNaN(time)) continue;
    if (!newest || time > newest.time) newest = { value, time };
  }
  return newest?.value ?? null;
}

function sitemapUrl(
  base: string,
  path: string,
  opts: { lastmod?: number | string | Date | null; changefreq?: string; priority?: string } = {},
): string {
  const alternates = localizedAlternates(path)
    .map((alternate) => `<xhtml:link rel="alternate" hreflang="${xmlEscape(alternate.hreflang)}" href="${xmlEscape(base + alternate.path)}" />`);
  return [
    "<url>",
    `<loc>${xmlEscape(base + path)}</loc>`,
    ...alternates,
    opts.lastmod ? `<lastmod>${safeDate(opts.lastmod)}</lastmod>` : "",
    opts.changefreq ? `<changefreq>${opts.changefreq}</changefreq>` : "",
    opts.priority ? `<priority>${opts.priority}</priority>` : "",
    "</url>",
  ].filter(Boolean).join("");
}

function urlset(urls: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join("\n")}\n</urlset>`;
}

function sitemapIndex(base: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const paths = [
    "/sitemap-general.xml",
    "/sitemap-categories.xml",
    "/sitemap-threads.xml",
    "/sitemap-users.xml",
    "/sitemap-tags.xml",
  ];
  const rows = paths.map((path) =>
    `<sitemap><loc>${xmlEscape(base + path)}</loc><lastmod>${today}</lastmod></sitemap>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join("\n")}\n</sitemapindex>`;
}

const PUBLIC_CRAWLER_ALLOW = [
  "Allow: /",
  "Allow: /llms.txt",
  "Allow: /llms-full.txt",
  "Allow: /sitemap.xml",
  "Allow: /sitemap-general.xml",
  "Allow: /sitemap-categories.xml",
  "Allow: /sitemap-threads.xml",
  "Allow: /sitemap-tags.xml",
  "Allow: /sitemap-users.xml",
  "Allow: /api/ads",
  "Allow: /api/categories",
  "Allow: /api/members",
  "Allow: /api/stats",
  "Allow: /api/tags",
  "Allow: /api/threads",
];

const PRIVATE_CRAWLER_DISALLOW = [
  "Disallow: /api/admin",
  "Disallow: /api/attachments",
  "Disallow: /api/auth",
  "Disallow: /admin",
  "Disallow: /admin/",
  "Disallow: /login",
  "Disallow: /register",
  "Disallow: /new-thread",
  "Disallow: /search",
];

const AI_CRAWLER_USER_AGENTS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "Google-Extended",
  "GoogleOther",
  "Googlebot",
  "Applebot",
  "Applebot-Extended",
  "Meta-ExternalAgent",
  "Meta-ExternalFetcher",
  "Amazonbot",
  "PerplexityBot",
  "Perplexity-User",
  "YouBot",
  "DuckAssistBot",
  "MistralAI-User",
  "cohere-ai",
  "CCBot",
];

function robotGroup(userAgents: string[]): string[] {
  return [
    ...userAgents.map((agent) => `User-agent: ${agent}`),
    ...PUBLIC_CRAWLER_ALLOW,
    ...PRIVATE_CRAWLER_DISALLOW,
  ];
}

function robotsTxt(base: string): string {
  return [
    "# FSTDESK public crawler policy",
    "# Public forum pages are open for search and AI answer engines.",
    "# Admin, auth and private API surfaces are intentionally blocked.",
    "",
    ...robotGroup(["*"]),
    "",
    "# Explicit AI crawler policy: OpenAI, Anthropic, Google/Gemini, Apple, Meta, Amazon, Perplexity, You.com, DuckDuckGo, Mistral, Cohere and Common Crawl may index public content.",
    ...robotGroup(AI_CRAWLER_USER_AGENTS),
    "",
    `Sitemap: ${base}/sitemap.xml`,
    `Sitemap: ${base}/sitemap-general.xml`,
    `Sitemap: ${base}/sitemap-categories.xml`,
    `Sitemap: ${base}/sitemap-threads.xml`,
    `Sitemap: ${base}/sitemap-tags.xml`,
    `Sitemap: ${base}/sitemap-users.xml`,
    "",
    `# LLM content guide: ${base}/llms.txt`,
    `# Full LLM content guide: ${base}/llms-full.txt`,
    "",
  ].join("\n");
}

function llmsTxt(base: string): string {
  return [
    "# FSTDESK",
    "",
    "> Food Science and Technology Desk: a public, server-rendered discussion archive for food science, food safety, product development, packaging, ingredients, shelf life and food technology.",
    "",
    "FSTDESK is designed to be useful to humans, search engines and AI answer engines. Public topic, category, tag and member pages contain real HTML content, canonical metadata, structured data and internal links.",
    "",
    "## Primary entry points",
    "",
    `- [Home and recent discussions](${base}/)`,
    `- [What is FSTDESK](${base}/what-is-fstdesk)`,
    `- [Tags](${base}/tags)`,
    `- [Members](${base}/members)`,
    `- [Sitemap index](${base}/sitemap.xml)`,
    `- [Full AI crawler guide](${base}/llms-full.txt)`,
    "",
    "## XML sitemaps",
    "",
    `- [General pages](${base}/sitemap-general.xml)`,
    `- [Threads](${base}/sitemap-threads.xml)`,
    `- [Categories](${base}/sitemap-categories.xml)`,
    `- [Tags](${base}/sitemap-tags.xml)`,
    `- [Users](${base}/sitemap-users.xml)`,
    "",
    "## High-value public topics",
    "",
    "- Food safety, chilled poultry shelf life, microbial risks and validation",
    "- Product development, clean-label preservation and shelf-life extension",
    "- Water activity, pH, texture, oxidation and stability",
    "- Packaging, MAP, oxygen barriers, seal quality and cold-chain control",
    "- Ingredients, color additives, cocoa butter alternatives and non-palm fat systems",
    "- Food regulations, labeling, allergens and cleaning validation",
    "",
    "## Crawling guidance",
    "",
    "Public pages are intended for indexing and AI retrieval. Admin pages, authentication pages, private APIs and attachment internals should not be crawled. Use the XML sitemaps for freshness and URL discovery. Do not rely on JavaScript-only rendering; the public archive has server-rendered HTML.",
    "",
  ].join("\n");
}

type LlmTopicCluster = {
  publicId: string;
  title: string;
  categoryName: string;
  categoryPublicId: string;
  tags: string[];
  views: number;
  replyCount: number;
  updatedAt: string;
  summary: string;
};

function crawlerText(input: unknown, max = 180): string {
  const text = String(input ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[`*_>#|~=]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, Math.max(0, max - 3)).trim()}...` : text;
}

function markdownText(input: unknown, max = 140): string {
  return crawlerText(input, max).replace(/\[/g, "(").replace(/\]/g, ")");
}

async function loadTopLlmTopicClusters(env: Bindings, limit = 100): Promise<LlmTopicCluster[]> {
  const rows = await env.DB.prepare(
    `SELECT t.public_id AS publicId, t.title, t.content, t.views, t.reply_count AS replyCount,
      t.created_at AS createdAt, t.updated_at AS updatedAt, t.last_post_at AS lastPostAt,
      c.name AS categoryName, c.public_id AS categoryPublicId,
      GROUP_CONCAT(DISTINCT tags.name) AS tags,
      (COALESCE(t.views, 0) + COALESCE(t.reply_count, 0) * 80 + CASE WHEN t.featured THEN 500 ELSE 0 END) AS score
     FROM threads t
     INNER JOIN categories c ON c.id = t.category_id
     LEFT JOIN thread_tags tt ON tt.thread_id = t.id
     LEFT JOIN tags ON tags.id = tt.tag_id
     WHERE length(trim(t.title)) > 0
     GROUP BY t.id
     ORDER BY score DESC, COALESCE(t.last_post_at, t.updated_at, t.created_at) DESC
     LIMIT ?`,
  )
    .bind(limit)
    .all<Record<string, unknown>>();

  return (rows.results ?? []).map((row) => ({
    publicId: String(row.publicId ?? ""),
    title: String(row.title ?? ""),
    categoryName: String(row.categoryName ?? "Forum"),
    categoryPublicId: String(row.categoryPublicId ?? ""),
    tags: String(row.tags ?? "")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 8),
    views: Number(row.views ?? 0),
    replyCount: Number(row.replyCount ?? 0),
    updatedAt: safeDate(newestDate(row.updatedAt, row.lastPostAt, row.createdAt)),
    summary: crawlerText(row.content, 180),
  }));
}

function llmTopicClusterSection(base: string, topics: LlmTopicCluster[]): string[] {
  if (!topics.length) {
    return [
      "## Top topic cluster links",
      "",
      "The live worker enriches this section with up to 100 high-signal public topic URLs when database access is available.",
      "",
    ];
  }
  return [
    "## Top 100 topic cluster links",
    "",
    ...topics.map((topic, index) => {
      const tags = topic.tags.length ? `; tags: ${topic.tags.map((tag) => `#${markdownText(tag, 40)}`).join(", ")}` : "";
      const summary = topic.summary ? `; summary: ${markdownText(topic.summary, 180)}` : "";
      return `${index + 1}. [${markdownText(topic.title, 120)}](${base}/t/${topic.publicId}) - category: ${markdownText(topic.categoryName, 80)}; replies: ${topic.replyCount}; views: ${topic.views}; updated: ${topic.updatedAt}${tags}${summary}`;
    }),
    "",
  ];
}

function llmsFullTxt(base: string, topics: LlmTopicCluster[] = []): string {
  return [
    "# FSTDESK AI Crawler Guide",
    "",
    "FSTDESK means Food Science and Technology Desk. The site is a public forum archive for practical food science and technology questions. It is useful for retrieval-augmented answers about product development, food safety, shelf life, ingredients, packaging, regulations, QA/QC, R&D and production troubleshooting.",
    "",
    "## Best pages to crawl first",
    "",
    `1. ${base}/what-is-fstdesk - detailed site purpose, audience, examples and FAQ.`,
    `2. ${base}/ - recent public discussions.`,
    `3. ${base}/tags - technical terms and recurring subjects.`,
    `4. ${base}/members - public member profiles and author context.`,
    `5. ${base}/sitemap-threads.xml - complete public discussion URL discovery.`,
    "",
    "## Sitemap map",
    "",
    `- ${base}/sitemap.xml - sitemap index.`,
    `- ${base}/sitemap-general.xml - home, about, contact, tags, members and FSTDESK explainer.`,
    `- ${base}/sitemap-categories.xml - public category archive pages.`,
    `- ${base}/sitemap-threads.xml - public thread pages with lastmod signals.`,
    `- ${base}/sitemap-tags.xml - public tag archive pages.`,
    `- ${base}/sitemap-users.xml - public user profile pages.`,
    "",
    ...llmTopicClusterSection(base, topics),
    "## Content areas",
    "",
    "- Food safety: microbial growth, pathogens, chilled storage, poultry, hygiene, HPP, testing labs and validation.",
    "- Shelf life: water activity, pH, packaging, preservatives, oxidation, texture, mold, sensory change and accelerated studies.",
    "- Product development: formulation constraints, ingredient replacement, clean-label targets, cost reduction and scale-up.",
    "- Packaging: MAP, oxygen/moisture barriers, tray sealing, flexible packaging, shelf-life validation and labeling fit.",
    "- Ingredients: hydrocolloids, proteins, fats, oils, cocoa systems, sweeteners, colors, stabilizers and preservatives.",
    "- Regulations: allergens, labeling, cleaning validation, documentation, market constraints and compliance discussion.",
    "- Production troubleshooting: process deviation, equipment effects, quality defects, sanitation, batch records and root-cause analysis.",
    "",
    "## Example queries this archive can answer",
    "",
    "- How can raw chicken shelf life be evaluated safely?",
    "- What factors affect biscuit shelf life when using natural preservation?",
    "- How does water activity differ from moisture percentage in shelf-life studies?",
    "- What should a food and water microbial testing lab consider?",
    "- Which variables matter when choosing pearl or silver pigments for beverages?",
    "- How can bakery fat systems move away from palm while protecting texture?",
    "- What risks appear when replacing cocoa butter in chocolate products?",
    "- How should MAP ready meals be validated?",
    "- How should nut butter rancidity and separation be controlled?",
    "- What records support allergen cleaning validation?",
    "",
    "## Preferred crawler behavior",
    "",
    "Use GET requests for public HTML pages and XML sitemaps. Respect canonical URLs, structured data and robots.txt. Public content is intentionally indexable. Do not crawl /admin, /login, /register, private API routes or attachment internals. There is no Crawl-delay directive because freshness matters, but responsible rate limiting is welcome.",
    "",
    "## Freshness",
    "",
    "Thread, category, tag and user sitemaps include lastmod data where available. Recent and active discussions should be discovered through the thread sitemap and the home page.",
    "",
  ].join("\n");
}

async function loadSettings(env: Bindings): Promise<Record<string, string>> {
  const db = getDb(env);
  const rows = await db.select().from(schema.settings);
  const result: Record<string, string> = {};
  for (const row of rows) result[row.key] = row.value;
  return result;
}

function adsConfigFromSettings(settings: Record<string, string>, user?: { role?: string | null } | null) {
  const interval = (key: string, fallback: number) => {
    const value = Number(settings[key] || fallback);
    return Math.max(1, Math.min(50, Number.isFinite(value) ? value : fallback));
  };
  const desktopHtml = settings["ad_desktop_html"] || settings["ad_thread_html"] || "";
  const mobileHtml = settings["ad_mobile_html"] || desktopHtml;
  const sidebarHtml = settings["ad_sidebar_html"] || "";
  const disableAdsenseForAdmins = settings["ads_disable_adsense_for_admins"] !== "false";
  const adsenseSuppressedForAdmin = Boolean(disableAdsenseForAdmins && user?.role === "admin");
  const effectiveDesktopHtml = adsenseSuppressedForAdmin ? "" : desktopHtml;
  const effectiveMobileHtml = adsenseSuppressedForAdmin ? "" : mobileHtml;
  const effectiveSidebarHtml = adsenseSuppressedForAdmin ? "" : sidebarHtml;
  const postInterval = interval("ads_post_interval", 3);
  const desktopIntervals = {
    post: postInterval,
    topic: interval("ads_topic_interval", 7),
    user: interval("ads_user_interval", 7),
    tag: interval("ads_tag_interval", 7),
  };
  const mobileIntervals = {
    post: interval("ads_mobile_post_interval", desktopIntervals.post),
    topic: interval("ads_mobile_topic_interval", desktopIntervals.topic),
    user: interval("ads_mobile_user_interval", desktopIntervals.user),
    tag: interval("ads_mobile_tag_interval", desktopIntervals.tag),
  };
  return {
    enabled: settings["ads_enabled"] === "true",
    disableAdsenseForAdmins,
    adsenseSuppressedForAdmin,
    postInterval,
    adsenseClient: "",
    adsenseSlot: "",
    adsenseFormat: "",
    fullWidthResponsive: true,
    html: effectiveDesktopHtml,
    desktop: {
      html: effectiveDesktopHtml,
      intervals: desktopIntervals,
    },
    mobile: {
      html: effectiveMobileHtml,
      intervals: mobileIntervals,
    },
    sidebar: {
      html: effectiveSidebarHtml,
      width: 200,
      height: 200,
    },
  };
}

app.get("/api/ads", async (c) => {
  c.header("Cache-Control", "private, no-store");
  try {
    const settings = await withTimeout(loadSettings(c.env), ADS_SETTINGS_TIMEOUT_MS, {});
    return c.json(adsConfigFromSettings(settings, c.get("user")));
  } catch (error) {
    const record = errorToRecord(error);
    c.executionCtx.waitUntil(recordErrorEvent(c.env.DB, {
      ...requestErrorMeta(c),
      source: "worker",
      level: "error",
      kind: "ads_config_fallback",
      status: 200,
      message: `Ads config fallback: ${record.message}`,
      stack: record.stack,
      metadata: { name: record.name },
    }));
    return c.json(adsConfigFromSettings({}, c.get("user")));
  }
});

app.get("/robots.txt", (c) => {
  const base = originFromRequest(c.req.url);
  return c.text(robotsTxt(base), 200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" });
});

app.get("/llms.txt", (c) => {
  const base = originFromRequest(c.req.url);
  return c.text(llmsTxt(base), 200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" });
});

app.get("/llms-full.txt", async (c) => {
  const base = originFromRequest(c.req.url);
  const topics = await loadTopLlmTopicClusters(c.env).catch((error) => {
    if (!isD1Backpressure(error)) console.warn("llms_full_topics_failed", errorToRecord(error).message);
    return [];
  });
  return c.text(llmsFullTxt(base, topics), 200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" });
});

app.get("/sitemap.xml", async (c) => {
  const base = originFromRequest(c.req.url);
  return c.text(sitemapIndex(base), 200, { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" });
});

app.get("/sitemap-index.xml", async (c) => {
  const base = originFromRequest(c.req.url);
  return c.text(sitemapIndex(base), 200, { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" });
});

app.get("/sitemap-general.xml", async (c) => {
  const base = originFromRequest(c.req.url);
  const urls = [
    sitemapUrl(base, "/", { changefreq: "daily", priority: "1.0" }),
    sitemapUrl(base, "/members", { changefreq: "weekly", priority: "0.6" }),
    sitemapUrl(base, "/tags", { changefreq: "weekly", priority: "0.6" }),
    sitemapUrl(base, "/what-is-fstdesk", { changefreq: "monthly", priority: "0.7" }),
    sitemapUrl(base, "/about", { changefreq: "monthly", priority: "0.5" }),
    sitemapUrl(base, "/contact", { changefreq: "monthly", priority: "0.4" }),
  ];
  return c.text(urlset(urls), 200, { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" });
});

app.get("/sitemap-categories.xml", async (c) => {
  const db = getDb(c.env);
  const base = originFromRequest(c.req.url);
  const categoryRows = await c.env.DB.prepare(
    `SELECT c.public_id AS publicId,
      COALESCE(NULLIF(MAX(max(COALESCE(t.updated_at, 0), COALESCE(t.last_post_at, 0), COALESCE(t.created_at, 0))), 0), c.created_at) AS updatedAt
     FROM categories c
     LEFT JOIN threads t ON t.category_id = c.id
     GROUP BY c.id
     ORDER BY c.position, c.id`,
  ).all<{ publicId: string; updatedAt: number | string | Date | null }>();
  const urls = (categoryRows.results ?? []).map((cat) =>
    sitemapUrl(base, `/c/${cat.publicId}`, { lastmod: cat.updatedAt, changefreq: "daily", priority: "0.8" }),
  );
  return c.text(urlset(urls), 200, { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" });
});

app.get("/sitemap-threads.xml", async (c) => {
  const db = getDb(c.env);
  const base = originFromRequest(c.req.url);
  const threads = await db
    .select({
      publicId: schema.threads.publicId,
      updatedAt: schema.threads.updatedAt,
      lastPostAt: schema.threads.lastPostAt,
      createdAt: schema.threads.createdAt,
    })
    .from(schema.threads)
    .orderBy(schema.threads.id);
  const urls = threads.map((t) =>
    sitemapUrl(base, `/t/${t.publicId}`, { lastmod: newestDate(t.updatedAt, t.lastPostAt, t.createdAt), changefreq: "weekly", priority: "0.7" }),
  );
  return c.text(urlset(urls), 200, { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" });
});

app.get("/sitemap-users.xml", async (c) => {
  const base = originFromRequest(c.req.url);
  const userRows = await c.env.DB.prepare(
    `SELECT u.username,
      max(
        COALESCE(u.created_at, 0),
        COALESCE((SELECT MAX(max(COALESCE(t.updated_at, 0), COALESCE(t.last_post_at, 0), COALESCE(t.created_at, 0))) FROM threads t WHERE t.user_id = u.id), 0),
        COALESCE((SELECT MAX(max(COALESCE(p.edited_at, 0), COALESCE(p.created_at, 0))) FROM posts p WHERE p.user_id = u.id), 0)
      ) AS updatedAt
     FROM users u
     ORDER BY u.id`,
  ).all<{ username: string; updatedAt: number | string | Date | null }>();
  const urls = (userRows.results ?? []).map((u) =>
    sitemapUrl(base, `/u/${encodeURIComponent(u.username)}`, { lastmod: u.updatedAt, changefreq: "monthly", priority: "0.4" }),
  );
  return c.text(urlset(urls), 200, { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" });
});

app.get("/sitemap-tags.xml", async (c) => {
  const base = originFromRequest(c.req.url);
  const tagRows = await c.env.DB.prepare(
    `SELECT tags.slug,
      COALESCE(NULLIF(MAX(max(COALESCE(t.updated_at, 0), COALESCE(t.last_post_at, 0), COALESCE(t.created_at, 0))), 0), tags.created_at) AS updatedAt
     FROM tags
     LEFT JOIN thread_tags tt ON tt.tag_id = tags.id
     LEFT JOIN threads t ON t.id = tt.thread_id
     GROUP BY tags.id
     ORDER BY tags.id`,
  ).all<{ slug: string; updatedAt: number | string | Date | null }>();
  const urls = (tagRows.results ?? []).map((tag) =>
    sitemapUrl(base, `/tag/${encodeURIComponent(tag.slug)}`, { lastmod: tag.updatedAt, changefreq: "weekly", priority: "0.5" }),
  );
  return c.text(urlset(urls), 200, { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" });
});

app.get("/ads.txt", async (c) => {
  const settings = await withTimeout(loadSettings(c.env), ADS_SETTINGS_TIMEOUT_MS, {});
  const custom = settings["ads_txt"]?.trim();
  if (custom) return c.text(`${custom}\n`, 200, { "Content-Type": "text/plain; charset=utf-8" });

  const publisherFromCode = (settings["ad_desktop_html"] || settings["ad_thread_html"] || settings["ad_mobile_html"] || settings["ad_sidebar_html"])
    ?.match(/ca-pub-\d+/)?.[0].replace(/^ca-/, "") ?? "";
  const publisher = (settings["adsense_client"] || publisherFromCode).replace(/^ca-/, "").trim();
  const body = publisher
    ? `google.com, ${publisher}, DIRECT, f08c47fec0942fa0\n`
    : "# ads.txt is managed from /admin/ads\n";
  return c.text(body, 200, { "Content-Type": "text/plain; charset=utf-8" });
});

app.get("/og/default.webp", (c) => serveDefaultWebp(c));
app.get("/og/default.svg", (c) => c.text("Gone. Use /og/default.webp", 410, { "Cache-Control": "no-store" }));
app.get("/og/thread/:id", (c) => {
  const id = c.req.param("id");
  if (!id.toLowerCase().endsWith(".webp")) {
    return c.text("Gone. Thread Open Graph images are served as WebP.", 410, { "Cache-Control": "no-store" });
  }
  return serveThreadWebp(c, id);
});

const TRANSPARENT_GIF = new Uint8Array([
  71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 255, 255, 255, 33, 249, 4, 1, 0, 0, 0, 0, 44, 0,
  0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 68, 1, 0, 59,
]);

function emailTrackingToken(raw: string): string {
  return raw.replace(/\.gif$/i, "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
}

async function recordEmailOpen(env: Bindings, trackingToken: string): Promise<void> {
  if (!trackingToken) return;
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `UPDATE email_events
     SET open_count = COALESCE(open_count, 0) + 1,
       opened_at = COALESCE(opened_at, ?),
       last_opened_at = ?
     WHERE tracking_token = ?`,
  ).bind(now, now, trackingToken).run();
}

async function recordEmailClick(env: Bindings, trackingToken: string): Promise<void> {
  if (!trackingToken) return;
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `UPDATE email_events
     SET click_count = COALESCE(click_count, 0) + 1,
       clicked_at = COALESCE(clicked_at, ?),
       last_clicked_at = ?
     WHERE tracking_token = ?`,
  ).bind(now, now, trackingToken).run();
}

app.on(["GET", "POST"], "/unsubscribe/:token", async (c) => {
  const db = getDb(c.env);
  const token = c.req.param("token");
  const type = new URL(c.req.url).searchParams.get("type") || "all";
  const result = await unsubscribeByToken(db, token, type);
  const title = result.ok ? "Email preferences updated" : "Unsubscribe link not found";
  const body = result.ok
    ? `${result.disabled === "all" ? "All email notifications" : `${result.disabled} emails`} have been disabled for ${result.email ?? "this account"}.`
    : "This unsubscribe link is invalid or expired.";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>${title}</title></head><body style="margin:0;background:#282828;color:#ebdbb2;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"><main style="max-width:720px;margin:0 auto;padding:42px 22px"><div style="color:#fabd2f;font-weight:700;margin-bottom:18px">FSTDESK</div><section style="border:1px solid #504945;background:#3c3836;padding:24px"><h1 style="font-size:22px;color:#fabd2f;margin:0 0 14px">${title}</h1><p style="line-height:1.7">${body}</p><p><a href="/" style="color:#95c7c0">Return to forum</a></p></section></main></body></html>`;
  return c.html(html, result.ok ? 200 : 404);
});

app.get("/email/open/:token", async (c) => {
  const trackingToken = emailTrackingToken(c.req.param("token"));
  c.executionCtx.waitUntil(
    recordEmailOpen(c.env, trackingToken).catch((error) => {
      if (!isD1Backpressure(error)) console.warn("email_open_tracking_failed", errorToRecord(error).message);
    }),
  );
  return new Response(TRANSPARENT_GIF, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, max-age=0",
      "Content-Length": String(TRANSPARENT_GIF.byteLength),
    },
  });
});

app.get("/email/click/:token", async (c) => {
  const url = new URL(c.req.url);
  const trackingToken = emailTrackingToken(c.req.param("token"));
  c.executionCtx.waitUntil(
    recordEmailClick(c.env, trackingToken).catch((error) => {
      if (!isD1Backpressure(error)) console.warn("email_click_tracking_failed", errorToRecord(error).message);
    }),
  );

  let target = new URL("/", url.origin);
  const rawTarget = url.searchParams.get("u");
  if (rawTarget) {
    try {
      const parsed = new URL(rawTarget, url.origin);
      const allowedHosts = new Set([url.host, "manufox.com", "www.manufox.com"]);
      if ((parsed.protocol === "https:" || parsed.protocol === "http:") && allowedHosts.has(parsed.host)) target = parsed;
    } catch {
      target = new URL("/", url.origin);
    }
  }

  return c.redirect(target.toString(), 302);
});

app.on(["GET", "HEAD"], "*", async (c, next) => {
  const redirect = await legacyCanonicalRedirect(c);
  if (!redirect) return next();
  redirect.headers.set("Cache-Control", "public, max-age=3600");
  return redirect;
});

const LEGACY_CONTENT_SECTIONS = new Set(["articles", "categories", "about"]);

function isLegacyContentPath(pathname: string): boolean {
  const parts = pathname.split("/").filter(Boolean);
  if (!parts.length) return false;
  const [first, second] = parts;
  if (/^[a-z]{2}$/.test(first)) {
    return parts.length === 1 || LEGACY_CONTENT_SECTIONS.has(second ?? "");
  }
  return LEGACY_CONTENT_SECTIONS.has(first);
}

app.on(["GET", "HEAD"], "*", (c, next) => {
  const url = new URL(c.req.url);
  if (!isLegacyContentPath(url.pathname)) return next();
  const target = new URL("/", url.origin);
  return c.redirect(target.toString(), 301);
});

app.all("*", (c) => renderSeoHtml(c));

async function handleInboundEmail(message: ForwardableEmailMessage, env: Bindings, ctx: ExecutionContext): Promise<void> {
  const raw = await new Response(message.raw).text();
  const bounce = parseBounceEmail(raw, message.headers);
  if (!bounce) {
    message.setReject("Only delivery status notifications are accepted.");
    return;
  }

  const db = getDb(env);
  await recordEmailSuppression(db, env, bounce.email, {
    reason: bounce.reason,
    source: "inbound_bounce",
    details: bounce.details,
    waitUntil: ctx.waitUntil.bind(ctx),
  });
}

async function handleScheduled(_controller: ScheduledController, env: Bindings, ctx: ExecutionContext): Promise<void> {
  const db = getDb(env);
  const syncIfDue = shouldRunScheduledCloudflareSuppressionSync(env)
    .then((due) => {
      if (!due) return undefined;
      return syncCloudflareEmailSuppressions(db, env, {
        requestUrl: "https://fstdesk.com/",
        hours: 72,
        userId: null,
        logMissingConfig: false,
      });
    })
    .catch((error) => {
      console.warn("scheduled_cf_suppression_sync_gate_failed", error instanceof Error ? error.message : String(error));
    });
  ctx.waitUntil(syncIfDue);
  ctx.waitUntil(processMarketingJobs(env, ctx));
}

async function handleQueue(batch: MessageBatch<{ action?: "process"; jobId?: string; locale?: string; path?: string; limit?: number }>, env: Bindings, ctx: ExecutionContext): Promise<void> {
  if (batch.queue.includes("translation")) {
    for (const message of batch.messages) {
      if (message.body?.action !== "process") {
        message.ack();
        continue;
      }
      const jobId = typeof message.body.jobId === "string" ? message.body.jobId : undefined;
      const locale = typeof message.body.locale === "string" ? message.body.locale : undefined;
      const path = typeof message.body.path === "string" ? message.body.path : undefined;
      const limit = Math.max(1, Math.min(25, Number(message.body.limit || 4) || 4));
      try {
        await processTranslationJobs(env, ctx, { jobId, locale, path, limit });
        if (env.TRANSLATION_QUEUE && await hasPendingTranslationJobs(env, { jobId, locale, path })) {
          await env.TRANSLATION_QUEUE.send({ action: "process", jobId, locale, path, limit });
        }
        message.ack();
      } catch (error) {
        console.warn("translation_queue_processor_failed", locale ?? jobId ?? "global", error instanceof Error ? error.message : String(error));
        message.retry({ delaySeconds: 60 });
      }
    }
    return;
  }

  for (const message of batch.messages) {
    const jobId = typeof message.body?.jobId === "string" ? message.body.jobId : "";
    if (!/^[a-f0-9]{20}$/i.test(jobId)) {
      message.ack();
      continue;
    }
    try {
      await processMarketingJobs(env, ctx, { jobId });
      message.ack();
    } catch (error) {
      console.warn("marketing_queue_job_failed", jobId, error instanceof Error ? error.message : String(error));
      message.retry({ delaySeconds: 30 });
    }
  }
}

export default {
  fetch: app.fetch,
  email: handleInboundEmail,
  scheduled: handleScheduled,
  queue: handleQueue,
};
