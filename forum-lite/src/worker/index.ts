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
import adminRoutes from "./routes/admin";
import attachmentRoutes from "./routes/attachments";
import { schema, getDb } from "./db";
import type { Bindings, Variables } from "./types";
import { renderSeoHtml } from "./lib/seo";
import { serveDefaultWebp, serveThreadWebp } from "./lib/og";
import { legacyCanonicalRedirect } from "./lib/legacy-redirects";
import { parseBounceEmail } from "./lib/bounce";
import { recordEmailSuppression } from "./lib/email-suppression";
import { unsubscribeByToken } from "./lib/notifications";
import { createAnalyticsPageview, updateAnalyticsDuration } from "./lib/analytics";

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.use("*", logger());
app.use("/api/*", cors({ origin: "*" }));
app.use("/api/*", async (c, next) => {
  await next();
  c.header("X-Robots-Tag", "noindex, nofollow");
});
app.use("/api/*", withDb);
app.use("/api/*", loadUser);

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
app.route("/api/admin", adminRoutes);
app.route("/api/attachments", attachmentRoutes);

app.get("/api/healthz", (c) => c.json({ ok: true, ts: Date.now() }));

app.post("/api/analytics/view", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const result = await createAnalyticsPageview(c, body && typeof body === "object" ? body as Record<string, unknown> : {});
  return c.json(result);
});

app.post("/api/analytics/duration", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const result = await updateAnalyticsDuration(c, body && typeof body === "object" ? body as Record<string, unknown> : {});
  return c.json(result);
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
  return [
    "<url>",
    `<loc>${xmlEscape(base + path)}</loc>`,
    opts.lastmod ? `<lastmod>${safeDate(opts.lastmod)}</lastmod>` : "",
    opts.changefreq ? `<changefreq>${opts.changefreq}</changefreq>` : "",
    opts.priority ? `<priority>${opts.priority}</priority>` : "",
    "</url>",
  ].filter(Boolean).join("");
}

function urlset(urls: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`;
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

async function loadSettings(env: Bindings): Promise<Record<string, string>> {
  const db = getDb(env);
  const rows = await db.select().from(schema.settings);
  const result: Record<string, string> = {};
  for (const row of rows) result[row.key] = row.value;
  return result;
}

function adsConfigFromSettings(settings: Record<string, string>) {
  const postInterval = Math.max(1, Math.min(20, Number(settings["ads_post_interval"] || 3) || 3));
  return {
    enabled: settings["ads_enabled"] === "true",
    postInterval,
    adsenseClient: "",
    adsenseSlot: "",
    adsenseFormat: "",
    fullWidthResponsive: true,
    html: settings["ad_thread_html"] || "",
  };
}

app.get("/api/ads", async (c) => {
  const settings = await loadSettings(c.env);
  c.header("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  return c.json(adsConfigFromSettings(settings));
});

app.get("/robots.txt", (c) => {
  const base = originFromRequest(c.req.url);
  return c.text(
    [
      "User-agent: *",
      "Allow: /",
      "Allow: /api/ads",
      "Allow: /api/categories",
      "Allow: /api/members",
      "Allow: /api/stats",
      "Allow: /api/tags",
      "Allow: /api/threads",
      "Disallow: /api/admin",
      "Disallow: /api/attachments",
      "Disallow: /api/auth",
      "Disallow: /admin",
      "Disallow: /admin/",
      "",
      `Sitemap: ${base}/sitemap.xml`,
      "",
    ].join("\n"),
    200,
    { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  );
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
  const settings = await loadSettings(c.env);
  const custom = settings["ads_txt"]?.trim();
  if (custom) return c.text(`${custom}\n`, 200, { "Content-Type": "text/plain; charset=utf-8" });

  const publisherFromCode = settings["ad_thread_html"]?.match(/ca-pub-\d+/)?.[0].replace(/^ca-/, "") ?? "";
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
  await recordEmailOpen(c.env, trackingToken);
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
  await recordEmailClick(c.env, trackingToken);

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

export default {
  fetch: app.fetch,
  email: handleInboundEmail,
};
