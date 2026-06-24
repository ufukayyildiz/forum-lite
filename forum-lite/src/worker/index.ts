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

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.use("*", logger());
app.use("/api/*", cors({ origin: "*" }));
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
      "Disallow: /api/",
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
  const categories = await db
    .select({ publicId: schema.categories.publicId, updatedAt: schema.categories.createdAt })
    .from(schema.categories)
    .orderBy(schema.categories.position, schema.categories.id);
  const urls = categories.map((cat) =>
    sitemapUrl(base, `/c/${cat.publicId}`, { lastmod: cat.updatedAt, changefreq: "daily", priority: "0.8" }),
  );
  return c.text(urlset(urls), 200, { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" });
});

app.get("/sitemap-threads.xml", async (c) => {
  const db = getDb(c.env);
  const base = originFromRequest(c.req.url);
  const threads = await db
    .select({ publicId: schema.threads.publicId, updatedAt: schema.threads.lastPostAt, createdAt: schema.threads.createdAt })
    .from(schema.threads)
    .orderBy(schema.threads.id);
  const urls = threads.map((t) =>
    sitemapUrl(base, `/t/${t.publicId}`, { lastmod: t.updatedAt ?? t.createdAt, changefreq: "weekly", priority: "0.7" }),
  );
  return c.text(urlset(urls), 200, { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" });
});

app.get("/sitemap-users.xml", async (c) => {
  const db = getDb(c.env);
  const base = originFromRequest(c.req.url);
  const users = await db
    .select({ username: schema.users.username, updatedAt: schema.users.createdAt })
    .from(schema.users)
    .orderBy(schema.users.id);
  const urls = users.map((u) =>
    sitemapUrl(base, `/u/${encodeURIComponent(u.username)}`, { lastmod: u.updatedAt, changefreq: "monthly", priority: "0.4" }),
  );
  return c.text(urlset(urls), 200, { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" });
});

app.get("/sitemap-tags.xml", async (c) => {
  const db = getDb(c.env);
  const base = originFromRequest(c.req.url);
  const tags = await db
    .select({ slug: schema.tags.slug, updatedAt: schema.tags.createdAt })
    .from(schema.tags)
    .orderBy(schema.tags.id);
  const urls = tags.map((tag) =>
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

app.all("*", (c) => renderSeoHtml(c));

export default app;
