import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { Bindings, Variables } from "../types";
import { parseLocalePath } from "../../shared/locales";

type AppContext = Context<{ Bindings: Bindings; Variables: Variables }>;

const VISITOR_COOKIE = "fstdesk_vid";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 400;
const UTM_COLUMNS: Array<[string, string]> = [
  ["utm_source", "utm_source TEXT"],
  ["utm_medium", "utm_medium TEXT"],
  ["utm_campaign", "utm_campaign TEXT"],
  ["utm_term", "utm_term TEXT"],
  ["utm_content", "utm_content TEXT"],
];

let analyticsUtmColumnsReady = false;
let analyticsUtmColumnsPromise: Promise<boolean> | null = null;

function clampText(value: unknown, max: number): string | null {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.slice(0, max);
}

function createVisitorId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

function cleanVisitorId(value: string | undefined): string | null {
  if (!value) return null;
  const clean = value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 64);
  return clean.length >= 16 ? clean : null;
}

async function ensureAnalyticsUtmColumns(db: D1Database) {
  if (analyticsUtmColumnsReady) return true;
  if (analyticsUtmColumnsPromise) return analyticsUtmColumnsPromise;
  analyticsUtmColumnsPromise = (async () => {
    try {
      const info = await db.prepare("PRAGMA table_info(analytics_pageviews)").all<{ name: string }>();
      const columns = new Set((info.results ?? []).map((row) => row.name));
      for (const [column, definition] of UTM_COLUMNS) {
        if (!columns.has(column)) {
          await db.prepare(`ALTER TABLE analytics_pageviews ADD COLUMN ${definition}`).run();
        }
      }
      analyticsUtmColumnsReady = true;
      return true;
    } catch {
      return false;
    } finally {
      analyticsUtmColumnsPromise = null;
    }
  })();
  return analyticsUtmColumnsPromise;
}

export function ensureAnalyticsVisitor(c: AppContext): string {
  const existing = cleanVisitorId(getCookie(c, VISITOR_COOKIE));
  if (existing) return existing;

  const visitorId = createVisitorId();
  const secure = new URL(c.req.url).protocol === "https:";
  setCookie(c, VISITOR_COOKIE, visitorId, {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure,
    maxAge: COOKIE_MAX_AGE,
  });
  return visitorId;
}

function normalizePath(rawPath: unknown, requestUrl: string): string {
  try {
    const parsed = new URL(String(rawPath || "/"), requestUrl);
    return `${parsed.pathname}${parsed.search}`.slice(0, 700);
  } catch {
    return "/";
  }
}

function routeType(path: string): string {
  const pathname = parseLocalePath(path.split("?")[0] || "/").path;
  if (pathname === "/") return "home";
  if (pathname.startsWith("/t/")) return "thread";
  if (pathname.startsWith("/c/")) return "category";
  if (pathname.startsWith("/u/")) return "member";
  if (pathname.startsWith("/tag/")) return "tag";
  if (pathname === "/members") return "members";
  if (pathname === "/tags") return "tags";
  if (pathname.startsWith("/search")) return "search";
  if (pathname.startsWith("/admin")) return "admin";
  if (pathname.startsWith("/new-thread")) return "composer";
  return "other";
}

function hostFromUrl(rawUrl: string | null): string | null {
  if (!rawUrl) return null;
  try {
    return new URL(rawUrl).host.toLowerCase();
  } catch {
    return null;
  }
}

function sourceFrom(path: string, referrer: string | null, requestUrl: string) {
  const current = new URL(path, requestUrl);
  const utmSource = clampText(current.searchParams.get("utm_source"), 80);
  const utmMedium = clampText(current.searchParams.get("utm_medium"), 80);
  const utmCampaign = clampText(current.searchParams.get("utm_campaign"), 120);
  const utmTerm = clampText(current.searchParams.get("utm_term"), 160);
  const utmContent = clampText(current.searchParams.get("utm_content"), 160);
  if (utmSource) {
    return {
      source: utmSource.toLowerCase(),
      medium: utmMedium || "utm",
      campaign: utmCampaign,
      referrerHost: hostFromUrl(referrer),
      utmSource,
      utmMedium,
      utmCampaign,
      utmTerm,
      utmContent,
    };
  }

  const requestHost = new URL(requestUrl).host.toLowerCase();
  const referrerHost = hostFromUrl(referrer);
  const utm = { utmSource, utmMedium, utmCampaign, utmTerm, utmContent };
  if (!referrerHost) return { source: "direct", medium: "none", campaign: null, referrerHost, ...utm };
  if (referrerHost === requestHost) return { source: "internal", medium: "internal", campaign: null, referrerHost, ...utm };

  const search = ["google.", "bing.", "yandex.", "duckduckgo.", "yahoo.", "baidu."];
  const social = ["facebook.", "instagram.", "linkedin.", "twitter.", "x.com", "t.co", "reddit.", "youtube.", "pinterest."];
  if (search.some((domain) => referrerHost.includes(domain))) {
    const name = referrerHost.split(".").find(Boolean) || "search";
    return { source: name, medium: "organic", campaign: null, referrerHost, ...utm };
  }
  if (social.some((domain) => referrerHost.includes(domain))) {
    const name = referrerHost.replace(/^www\./, "").split(".")[0] || "social";
    return { source: name, medium: "social", campaign: null, referrerHost, ...utm };
  }
  return { source: referrerHost.replace(/^www\./, ""), medium: "referral", campaign: null, referrerHost, ...utm };
}

function deviceFromUserAgent(userAgent: string) {
  const ua = userAgent.toLowerCase();
  const isBot = /bot|crawler|spider|slurp|google-inspectiontool|lighthouse|pagespeed|facebookexternalhit|whatsapp|telegrambot/.test(ua);
  const deviceType = /ipad|tablet/.test(ua) ? "tablet" : /mobi|iphone|android/.test(ua) ? "mobile" : "desktop";
  const browser = ua.includes("edg/") ? "edge"
    : ua.includes("chrome/") || ua.includes("crios/") ? "chrome"
      : ua.includes("firefox/") ? "firefox"
        : ua.includes("safari/") ? "safari"
          : ua.includes("bot") ? "bot"
            : "unknown";
  const os = ua.includes("iphone") || ua.includes("ipad") ? "ios"
    : ua.includes("android") ? "android"
      : ua.includes("mac os") || ua.includes("macintosh") ? "macos"
        : ua.includes("windows") ? "windows"
          : ua.includes("linux") ? "linux"
            : "unknown";
  return { deviceType: isBot ? "bot" : deviceType, browser, os, isBot };
}

function requestCf(c: AppContext) {
  const cf = (c.req.raw as Request & { cf?: Record<string, unknown> }).cf ?? {};
  return {
    country: clampText(cf.country, 2),
    city: clampText(cf.city, 120),
    colo: clampText(cf.colo, 12),
    timezone: clampText(cf.timezone, 80),
  };
}

export async function createAnalyticsPageview(c: AppContext, body: Record<string, unknown>) {
  const path = normalizePath(body.path, c.req.url);
  const type = routeType(path);
  const referrer = clampText(body.referrer || c.req.header("referer"), 1000);
  const source = sourceFrom(path, referrer, c.req.url);
  const userAgent = c.req.header("user-agent") ?? "";
  const device = deviceFromUserAgent(userAgent);
  const cf = requestCf(c);
  const user = c.get("user");
  if (type === "admin" || device.isBot || user?.role === "admin") {
    return { id: 0, visitorId: null, repeat: false, skipped: true };
  }
  const visitorId = ensureAnalyticsVisitor(c);
  const now = Math.floor(Date.now() / 1000);
  const previous = await c.env.DB.prepare(
    "SELECT id FROM analytics_pageviews WHERE visitor_id = ? LIMIT 1",
  ).bind(visitorId).first<{ id: number }>();
  const hasUtmColumns = await ensureAnalyticsUtmColumns(c.env.DB);

  const baseBindings = [
    visitorId,
    user?.id ?? null,
    path,
    type,
    referrer,
    source.referrerHost,
    source.source,
    source.medium,
    source.campaign,
  ];
  const tailBindings = [
    cf.country,
    cf.city,
    cf.colo,
    cf.timezone,
    device.deviceType,
    device.browser,
    device.os,
    previous ? 1 : 0,
    device.isBot ? 1 : 0,
    now,
    now,
  ];
  const result = hasUtmColumns
    ? await c.env.DB.prepare(
      `INSERT INTO analytics_pageviews (
        visitor_id, user_id, path, route_type, referrer, referrer_host, source, medium, campaign,
        utm_source, utm_medium, utm_campaign, utm_term, utm_content,
        country, city, colo, timezone, device_type, browser, os, is_repeat, is_bot, duration_ms, created_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    ).bind(
      ...baseBindings,
      source.utmSource,
      source.utmMedium,
      source.utmCampaign,
      source.utmTerm,
      source.utmContent,
      ...tailBindings,
    ).run()
    : await c.env.DB.prepare(
      `INSERT INTO analytics_pageviews (
        visitor_id, user_id, path, route_type, referrer, referrer_host, source, medium, campaign,
        country, city, colo, timezone, device_type, browser, os, is_repeat, is_bot, duration_ms, created_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    ).bind(
      ...baseBindings,
      ...tailBindings,
    ).run();

  return {
    id: Number((result.meta as { last_row_id?: number | string } | undefined)?.last_row_id ?? 0),
    visitorId,
    repeat: Boolean(previous),
  };
}

export async function updateAnalyticsDuration(c: AppContext, body: Record<string, unknown>) {
  const visitorId = cleanVisitorId(getCookie(c, VISITOR_COOKIE));
  const id = Number(body.id);
  const durationMs = Math.max(0, Math.min(1000 * 60 * 60 * 6, Math.round(Number(body.durationMs ?? 0))));
  if (c.get("user")?.role === "admin") return { ok: false, skipped: true };
  if (!visitorId || !Number.isInteger(id) || id <= 0) return { ok: false };
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(
    `UPDATE analytics_pageviews
     SET duration_ms = MAX(COALESCE(duration_ms, 0), ?),
       last_seen_at = ?,
       user_id = COALESCE(user_id, ?)
     WHERE id = ? AND visitor_id = ?
       AND COALESCE(is_bot, 0) = 0
       AND COALESCE(route_type, '') != 'admin'
       AND path NOT LIKE '/admin%'`,
  ).bind(durationMs, now, c.get("user")?.id ?? null, id, visitorId).run();
  return { ok: true };
}
