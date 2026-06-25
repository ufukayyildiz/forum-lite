import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, eq, desc, sql } from "drizzle-orm";
import { schema } from "../db";
import { requireRole } from "../lib/middleware";
import { safeISO } from "../lib/auth";
import { toPublicUser, type AppEnv } from "../types";
import { loadEmailSettings, sendManagedEmail, weAreBackEmail } from "../lib/notifications";
import { listCloudflareDeliveryFailures, listCloudflareSuppressions } from "../lib/email";
import { recordEmailSuppression } from "../lib/email-suppression";

const app = new Hono<AppEnv>();
const WE_ARE_BACK_CAMPAIGN = "we-are-back";
const MARKETING_BLOCK_DUPLICATE_SENDS_KEY = "marketing_block_duplicate_sends";

app.use("/*", requireRole("admin"));

function toAdminUser(u: typeof schema.users.$inferSelect) {
  return {
    ...toPublicUser(u),
    email: u.email,
    emailVerifiedAt: u.emailVerifiedAt ? safeISO(u.emailVerifiedAt) : null,
    lastLoginAt: u.lastLoginAt ? safeISO(u.lastLoginAt) : null,
    emailSuppressedAt: u.emailSuppressedAt ? safeISO(u.emailSuppressedAt) : null,
    emailSuppressionReason: u.emailSuppressionReason ?? null,
  };
}

async function marketingDuplicateBlockingEnabled(db: AppEnv["Variables"]["db"]) {
  const setting = await db.query.settings.findFirst({
    where: eq(schema.settings.key, MARKETING_BLOCK_DUPLICATE_SENDS_KEY),
  });
  return setting?.value !== "false";
}

app.get("/stats", async (c) => {
  const db = c.get("db");
  const [userCount, threadCount, postCount] = await Promise.all([
    db.$count(schema.users),
    db.$count(schema.threads),
    db.$count(schema.posts),
  ]);
  const recentActivity = await db
    .select()
    .from(schema.activityLog)
    .orderBy(desc(schema.activityLog.createdAt))
    .limit(20);
  return c.json({
    userCount,
    threadCount,
    postCount,
    recentActivity: recentActivity.map((a) => ({ ...a, createdAt: safeISO(a.createdAt) })),
  });
});

app.get("/users", async (c) => {
  const db = c.get("db");
  const page = Math.max(1, Number(c.req.query("page") ?? 1));
  const perPage = 25;
  const rows = await db
    .select()
    .from(schema.users)
    .orderBy(desc(schema.users.createdAt))
    .limit(perPage)
    .offset((page - 1) * perPage);
  const total = await db.$count(schema.users);
  return c.json({ users: rows.map(toAdminUser), total, page, perPage });
});

app.get("/email-suppressions", async (c) => {
  const db = c.get("db");
  const page = Math.max(1, Number(c.req.query("page") ?? 1));
  const perPage = 50;
  const rows = await db
    .select()
    .from(schema.emailSuppressions)
    .orderBy(desc(schema.emailSuppressions.updatedAt))
    .limit(perPage)
    .offset((page - 1) * perPage);
  const total = await db.$count(schema.emailSuppressions);
  return c.json({
    suppressions: rows.map((row) => ({
      ...row,
      createdAt: safeISO(row.createdAt),
      updatedAt: safeISO(row.updatedAt),
      cfSuppressedAt: row.cfSuppressedAt ? safeISO(row.cfSuppressedAt) : null,
    })),
    total,
    page,
    perPage,
  });
});

app.post("/email-suppressions", zValidator("json", z.object({
  email: z.string().email(),
  reason: z.string().min(1).max(120).optional(),
})), async (c) => {
  const db = c.get("db");
  const body = c.req.valid("json");
  const email = body.email.trim().toLowerCase();
  const reason = body.reason || "manual_admin_suppression";
  await recordEmailSuppression(db, c.env, email, {
    reason,
    source: "admin_manual",
    details: `Suppressed manually by ${c.get("user")?.username ?? "admin"}`,
  });
  await c.env.DB.prepare(
    `UPDATE email_events
     SET status = 'suppressed', message = ?, error_code = ?
     WHERE LOWER(email) = ?`,
  ).bind("Suppressed manually by admin", reason, email).run();
  await c.env.DB.prepare(
    `UPDATE marketing_sends
     SET status = 'suppressed'
     WHERE LOWER(email) = ?`,
  ).bind(email).run();
  return c.json({ ok: true, email });
});

app.post("/email-suppressions/sync", zValidator("json", z.object({
  hours: z.number().int().min(1).max(720).optional(),
}).default({})), async (c) => {
  const db = c.get("db");
  const body = c.req.valid("json");
  const hours = body.hours ?? 72;
  const { from } = await loadEmailSettings(db, c.req.url);
  const sendingDomain = from.replace(/^.*@/, "").toLowerCase();
  const errors: string[] = [];
  let cfSuppressions = 0;
  let deliveryFailures = 0;
  let localUpdates = 0;
  const seen = new Set<string>();

  try {
    const suppressions = await listCloudflareSuppressions(c.env);
    for (const row of suppressions) {
      const email = String(row.email ?? "").trim().toLowerCase();
      if (!email || seen.has(email)) continue;
      seen.add(email);
      cfSuppressions += 1;
      await recordEmailSuppression(db, c.env, email, {
        reason: row.reason || "cloudflare_suppression",
        source: "cf_suppression_sync",
        details: JSON.stringify(row).slice(0, 2000),
        skipCloudflareSync: true,
      });
      localUpdates += 1;
    }
  } catch (error) {
    errors.push(`suppression list: ${error instanceof Error ? error.message : "sync failed"}`);
  }

  try {
    const failures = await listCloudflareDeliveryFailures(c.env, { sendingDomain, hours });
    deliveryFailures = failures.length;
    const since = Math.floor(Date.now() / 1000) - hours * 3600;
    for (const row of failures) {
      const email = String(row.to ?? "").trim().toLowerCase();
      if (!email || seen.has(email)) continue;
      seen.add(email);
      const detail = [
        row.datetime,
        row.status,
        row.errorCause,
        row.errorDetail,
        row.subject ? `subject=${row.subject}` : "",
        row.messageId ? `messageId=${row.messageId}` : "",
      ].filter(Boolean).join(" | ");
      await recordEmailSuppression(db, c.env, email, {
        reason: "delivery_failed",
        source: "cf_activity_sync",
        details: detail,
      });
      await c.env.DB.prepare(
        `UPDATE email_events
         SET status = 'suppressed', message = ?, error_code = ?
         WHERE LOWER(email) = ? AND created_at >= ?`,
      ).bind(detail || "Cloudflare delivery failed", row.errorCause || "deliveryFailed", email, since).run();
      await c.env.DB.prepare(
        `UPDATE marketing_sends
         SET status = 'suppressed'
         WHERE LOWER(email) = ? AND created_at >= ?`,
      ).bind(email, since).run();
      localUpdates += 1;
    }
  } catch (error) {
    errors.push(`delivery failures: ${error instanceof Error ? error.message : "sync failed"}`);
  }

  await db.insert(schema.activityLog).values({
    userId: c.get("user")?.id ?? null,
    type: "email_bounce",
    summary: `Synced CF bounces: ${localUpdates} local updates, ${deliveryFailures} failures, ${cfSuppressions} suppressions`,
    createdAt: new Date(),
  });

  return c.json({
    ok: errors.length === 0,
    hours,
    cfSuppressions,
    deliveryFailures,
    localUpdates,
    errors,
  });
});

app.patch("/users/:id/role", requireRole("admin"), zValidator("json", z.object({ role: z.enum(["admin", "moderator", "member"]) })), async (c) => {
  const db = c.get("db");
  const id = Number(c.req.param("id"));
  const { role } = c.req.valid("json");
  await db.update(schema.users).set({ role }).where(eq(schema.users.id, id));
  return c.json({ ok: true });
});

app.patch("/users/:id/ban", requireRole("admin"), async (c) => {
  const db = c.get("db");
  const id = Number(c.req.param("id"));
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, id) });
  if (!user) return c.json({ error: "Not found" }, 404);
  await db.update(schema.users).set({ banned: !user.banned }).where(eq(schema.users.id, id));
  return c.json({ ok: true, banned: !user.banned });
});

app.patch("/users/:id",
  requireRole("admin"),
  zValidator("json", z.object({
    displayName: z.string().min(1).max(80).optional(),
    email: z.string().email().optional(),
    bio: z.string().max(500).optional(),
    avatarUrl: z.string().url().optional().or(z.literal("")),
  })),
  async (c) => {
    const db = c.get("db");
    const id = Number(c.req.param("id"));
    const body = c.req.valid("json");
    const update: Record<string, unknown> = {};
    if (body.displayName !== undefined) update.displayName = body.displayName;
    if (body.email !== undefined) update.email = body.email;
    if (body.bio !== undefined) update.bio = body.bio;
    if (body.avatarUrl !== undefined) update.avatarUrl = body.avatarUrl || null;
    if (!Object.keys(update).length) return c.json({ ok: true });
    await db.update(schema.users).set(update).where(eq(schema.users.id, id));
    const updated = await db.query.users.findFirst({ where: eq(schema.users.id, id) });
    return c.json({ ok: true, user: updated ? toPublicUser(updated) : null });
  }
);

app.get("/logs", async (c) => {
  const db = c.get("db");
  const page = Math.max(1, Number(c.req.query("page") ?? 1));
  const type = c.req.query("type") ?? "";
  const where = type ? eq(schema.activityLog.type, type) : undefined;
  const perPage = 30;
  const rows = await db
    .select()
    .from(schema.activityLog)
    .where(where)
    .orderBy(desc(schema.activityLog.createdAt))
    .limit(perPage)
    .offset((page - 1) * perPage);
  const total = await db.$count(schema.activityLog, where);
  return c.json({
    logs: rows.map((r) => ({ ...r, createdAt: safeISO(r.createdAt) })),
    total, page, perPage,
  });
});

app.get("/email-events", async (c) => {
  const db = c.get("db");
  const page = Math.max(1, Number(c.req.query("page") ?? 1));
  const kind = c.req.query("kind") ?? "";
  const perPage = 40;
  const where = kind ? eq(schema.emailEvents.kind, kind) : undefined;
  const rows = await db
    .select()
    .from(schema.emailEvents)
    .where(where)
    .orderBy(desc(schema.emailEvents.createdAt))
    .limit(perPage)
    .offset((page - 1) * perPage);
  const total = await db.$count(schema.emailEvents, where);
  return c.json({
    events: rows.map((row) => ({
      ...row,
      createdAt: safeISO(row.createdAt),
      openedAt: row.openedAt ? safeISO(row.openedAt) : null,
      lastOpenedAt: row.lastOpenedAt ? safeISO(row.lastOpenedAt) : null,
      clickedAt: row.clickedAt ? safeISO(row.clickedAt) : null,
      lastClickedAt: row.lastClickedAt ? safeISO(row.lastClickedAt) : null,
    })),
    total,
    page,
    perPage,
  });
});

app.get("/notifications", async (c) => {
  const db = c.get("db");
  const [eventCount, suppressionCount, prefCount] = await Promise.all([
    db.$count(schema.emailEvents),
    db.$count(schema.emailSuppressions),
    db.$count(schema.notificationPreferences),
  ]);
  const statusRows = await c.env.DB.prepare(
    "SELECT status, COUNT(*) AS count FROM email_events GROUP BY status ORDER BY count DESC",
  ).all<{ status: string; count: number }>();
  const kindRows = await c.env.DB.prepare(
    "SELECT kind, COUNT(*) AS count FROM email_events GROUP BY kind ORDER BY count DESC",
  ).all<{ kind: string; count: number }>();
  const cfRows = await c.env.DB.prepare(
    "SELECT COALESCE(cf_suppression_status, 'unknown') AS status, COUNT(*) AS count FROM email_suppressions GROUP BY COALESCE(cf_suppression_status, 'unknown') ORDER BY count DESC",
  ).all<{ status: string; count: number }>();
  return c.json({
    eventCount,
    suppressionCount,
    preferenceCount: prefCount,
    byStatus: statusRows.results ?? [],
    byKind: kindRows.results ?? [],
    cfSuppressionStatus: cfRows.results ?? [],
  });
});

app.get("/analytics", async (c) => {
  const days = Math.max(1, Math.min(90, Number(c.req.query("days") ?? 7) || 7));
  const onlineWindowSeconds = 300;
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const onlineSince = Math.floor(Date.now() / 1000) - onlineWindowSeconds;
  const bindSince = (sqlText: string) => c.env.DB.prepare(sqlText).bind(since);

  const [
    summary,
    onlineSummary,
    sourceRows,
    countryRows,
    routeRows,
    deviceRows,
    pathRows,
    userRows,
    referrerRows,
    timelineRows,
    onlineRows,
    recentRows,
  ] = await Promise.all([
    bindSince(
      `SELECT
        COUNT(*) AS pageviews,
        COUNT(DISTINCT visitor_id) AS visitors,
        SUM(CASE WHEN user_id IS NOT NULL THEN 1 ELSE 0 END) AS userViews,
        SUM(CASE WHEN user_id IS NULL THEN 1 ELSE 0 END) AS anonymousViews,
        SUM(CASE WHEN is_repeat = 1 THEN 1 ELSE 0 END) AS repeatViews,
        SUM(CASE WHEN is_bot = 1 THEN 1 ELSE 0 END) AS botViews,
        AVG(NULLIF(duration_ms, 0)) AS avgDurationMs,
        MAX(created_at) AS lastSeenAt
       FROM analytics_pageviews
       WHERE created_at >= ?`,
    ).first<Record<string, unknown>>(),
    c.env.DB.prepare(
      `SELECT
        COUNT(DISTINCT visitor_id) AS onlineVisitors,
        COUNT(DISTINCT CASE WHEN user_id IS NOT NULL THEN visitor_id END) AS onlineSignedIn,
        COUNT(DISTINCT CASE WHEN user_id IS NULL THEN visitor_id END) AS onlineAnonymous,
        COUNT(DISTINCT CASE WHEN is_repeat = 1 THEN visitor_id END) AS onlineRepeat,
        COUNT(DISTINCT CASE WHEN is_bot = 1 THEN visitor_id END) AS onlineBots,
        MAX(last_seen_at) AS lastSeenAt
       FROM analytics_pageviews
       WHERE last_seen_at >= ?`,
    ).bind(onlineSince).first<Record<string, unknown>>(),
    bindSince(
      `SELECT source, medium, COUNT(*) AS views, COUNT(DISTINCT visitor_id) AS visitors, AVG(NULLIF(duration_ms, 0)) AS avgDurationMs
       FROM analytics_pageviews
       WHERE created_at >= ?
       GROUP BY source, medium
       ORDER BY views DESC
       LIMIT 12`,
    ).all<Record<string, unknown>>(),
    bindSince(
      `SELECT COALESCE(NULLIF(country, ''), 'unknown') AS country, COUNT(*) AS views, COUNT(DISTINCT visitor_id) AS visitors
       FROM analytics_pageviews
       WHERE created_at >= ?
       GROUP BY COALESCE(NULLIF(country, ''), 'unknown')
       ORDER BY views DESC
       LIMIT 16`,
    ).all<Record<string, unknown>>(),
    bindSince(
      `SELECT route_type AS routeType, COUNT(*) AS views, COUNT(DISTINCT visitor_id) AS visitors, AVG(NULLIF(duration_ms, 0)) AS avgDurationMs
       FROM analytics_pageviews
       WHERE created_at >= ?
       GROUP BY route_type
       ORDER BY views DESC`,
    ).all<Record<string, unknown>>(),
    bindSince(
      `SELECT device_type AS deviceType, browser, os, COUNT(*) AS views, COUNT(DISTINCT visitor_id) AS visitors
       FROM analytics_pageviews
       WHERE created_at >= ?
       GROUP BY device_type, browser, os
       ORDER BY views DESC
       LIMIT 16`,
    ).all<Record<string, unknown>>(),
    bindSince(
      `SELECT path, route_type AS routeType, COUNT(*) AS views, COUNT(DISTINCT visitor_id) AS visitors,
        SUM(CASE WHEN user_id IS NOT NULL THEN 1 ELSE 0 END) AS userViews,
        AVG(NULLIF(duration_ms, 0)) AS avgDurationMs
       FROM analytics_pageviews
       WHERE created_at >= ?
       GROUP BY path, route_type
       ORDER BY views DESC
       LIMIT 30`,
    ).all<Record<string, unknown>>(),
    bindSince(
      `SELECT u.username, u.display_name AS displayName, COUNT(*) AS views, COUNT(DISTINCT ap.visitor_id) AS visitors,
        MAX(ap.created_at) AS lastSeenAt, AVG(NULLIF(ap.duration_ms, 0)) AS avgDurationMs
       FROM analytics_pageviews ap
       INNER JOIN users u ON u.id = ap.user_id
       WHERE ap.created_at >= ?
       GROUP BY ap.user_id
       ORDER BY views DESC
       LIMIT 20`,
    ).all<Record<string, unknown>>(),
    bindSince(
      `SELECT COALESCE(NULLIF(referrer_host, ''), 'direct') AS referrerHost, COUNT(*) AS views, COUNT(DISTINCT visitor_id) AS visitors
       FROM analytics_pageviews
       WHERE created_at >= ?
       GROUP BY COALESCE(NULLIF(referrer_host, ''), 'direct')
       ORDER BY views DESC
       LIMIT 16`,
    ).all<Record<string, unknown>>(),
    bindSince(
      `SELECT strftime('%Y-%m-%d %H:00', created_at, 'unixepoch') AS bucket, COUNT(*) AS views, COUNT(DISTINCT visitor_id) AS visitors
       FROM analytics_pageviews
       WHERE created_at >= ?
       GROUP BY bucket
       ORDER BY bucket ASC`,
    ).all<Record<string, unknown>>(),
    c.env.DB.prepare(
      `WITH latest_seen AS (
        SELECT visitor_id, MAX(last_seen_at) AS lastSeenAt
        FROM analytics_pageviews
        WHERE last_seen_at >= ?
        GROUP BY visitor_id
      ),
      latest AS (
        SELECT MAX(ap.id) AS id
        FROM analytics_pageviews ap
        INNER JOIN latest_seen ls ON ls.visitor_id = ap.visitor_id AND ls.lastSeenAt = ap.last_seen_at
        GROUP BY ap.visitor_id
      )
      SELECT ap.id, ap.path, ap.route_type AS routeType, ap.source, ap.medium, ap.country, ap.city, ap.colo,
        ap.device_type AS deviceType, ap.browser, ap.os, ap.is_repeat AS isRepeat, ap.is_bot AS isBot,
        ap.duration_ms AS durationMs, ap.created_at AS createdAt, ap.last_seen_at AS lastSeenAt,
        u.username, u.display_name AS displayName
       FROM latest
       INNER JOIN analytics_pageviews ap ON ap.id = latest.id
       LEFT JOIN users u ON u.id = ap.user_id
       ORDER BY ap.last_seen_at DESC
       LIMIT 80`,
    ).bind(onlineSince).all<Record<string, unknown>>(),
    bindSince(
      `SELECT ap.id, ap.path, ap.route_type AS routeType, ap.source, ap.medium, ap.country, ap.city, ap.colo,
        ap.device_type AS deviceType, ap.browser, ap.os, ap.is_repeat AS isRepeat, ap.is_bot AS isBot,
        ap.duration_ms AS durationMs, ap.created_at AS createdAt, ap.last_seen_at AS lastSeenAt,
        u.username, u.display_name AS displayName
       FROM analytics_pageviews ap
       LEFT JOIN users u ON u.id = ap.user_id
       WHERE ap.created_at >= ?
       ORDER BY ap.created_at DESC
       LIMIT 60`,
    ).all<Record<string, unknown>>(),
  ]);

  const asNumber = (value: unknown) => Number(value ?? 0);
  const rows = (result: D1Result<Record<string, unknown>>) => result.results ?? [];
  return c.json({
    days,
    summary: {
      pageviews: asNumber(summary?.pageviews),
      visitors: asNumber(summary?.visitors),
      userViews: asNumber(summary?.userViews),
      anonymousViews: asNumber(summary?.anonymousViews),
      repeatViews: asNumber(summary?.repeatViews),
      botViews: asNumber(summary?.botViews),
      avgDurationMs: Math.round(asNumber(summary?.avgDurationMs)),
      lastSeenAt: summary?.lastSeenAt ? safeISO(asNumber(summary.lastSeenAt)) : null,
      onlineVisitors: asNumber(onlineSummary?.onlineVisitors),
      onlineSignedIn: asNumber(onlineSummary?.onlineSignedIn),
      onlineAnonymous: asNumber(onlineSummary?.onlineAnonymous),
      onlineRepeat: asNumber(onlineSummary?.onlineRepeat),
      onlineBots: asNumber(onlineSummary?.onlineBots),
      onlineWindowSeconds,
      onlineLastSeenAt: onlineSummary?.lastSeenAt ? safeISO(asNumber(onlineSummary.lastSeenAt)) : null,
    },
    sources: rows(sourceRows).map((row) => ({ ...row, views: asNumber(row.views), visitors: asNumber(row.visitors), avgDurationMs: Math.round(asNumber(row.avgDurationMs)) })),
    countries: rows(countryRows).map((row) => ({ ...row, views: asNumber(row.views), visitors: asNumber(row.visitors) })),
    routes: rows(routeRows).map((row) => ({ ...row, views: asNumber(row.views), visitors: asNumber(row.visitors), avgDurationMs: Math.round(asNumber(row.avgDurationMs)) })),
    devices: rows(deviceRows).map((row) => ({ ...row, views: asNumber(row.views), visitors: asNumber(row.visitors) })),
    paths: rows(pathRows).map((row) => ({ ...row, views: asNumber(row.views), visitors: asNumber(row.visitors), userViews: asNumber(row.userViews), avgDurationMs: Math.round(asNumber(row.avgDurationMs)) })),
    users: rows(userRows).map((row) => ({ ...row, views: asNumber(row.views), visitors: asNumber(row.visitors), avgDurationMs: Math.round(asNumber(row.avgDurationMs)), lastSeenAt: row.lastSeenAt ? safeISO(asNumber(row.lastSeenAt)) : null })),
    referrers: rows(referrerRows).map((row) => ({ ...row, views: asNumber(row.views), visitors: asNumber(row.visitors) })),
    timeline: rows(timelineRows).map((row) => ({ ...row, views: asNumber(row.views), visitors: asNumber(row.visitors) })),
    online: rows(onlineRows).map((row) => ({
      ...row,
      isRepeat: Boolean(row.isRepeat),
      isBot: Boolean(row.isBot),
      durationMs: asNumber(row.durationMs),
      createdAt: safeISO(asNumber(row.createdAt)),
      lastSeenAt: safeISO(asNumber(row.lastSeenAt)),
    })),
    recent: rows(recentRows).map((row) => ({
      ...row,
      isRepeat: Boolean(row.isRepeat),
      isBot: Boolean(row.isBot),
      durationMs: asNumber(row.durationMs),
      createdAt: safeISO(asNumber(row.createdAt)),
      lastSeenAt: safeISO(asNumber(row.lastSeenAt)),
    })),
  });
});

app.get("/marketing/template", async (c) => {
  const db = c.get("db");
  const { siteUrl } = await loadEmailSettings(db, c.req.url);
  const mail = weAreBackEmail({ recipientName: "Ufuk", siteUrl });
  return c.json({
    campaignKey: WE_ARE_BACK_CAMPAIGN,
    name: "We are back",
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });
});

app.get("/marketing/users", async (c) => {
  const q = (c.req.query("q") ?? "").trim().toLowerCase();
  const campaign = c.req.query("campaign") || WE_ARE_BACK_CAMPAIGN;
  const like = `%${q}%`;
  const marketingOrder = `CASE
    WHEN COALESCE(ms.sendCount, 0) > 0 THEN 2
    WHEN es.email IS NOT NULL OR u.email_suppressed_at IS NOT NULL THEN 1
    WHEN np.all_email = 0 OR np.marketing_email = 0 THEN 1
    ELSE 0
  END`;
  const query = q
    ? `SELECT u.id, u.username, u.display_name AS displayName, u.email, u.email_suppressed_at AS emailSuppressedAt,
        np.all_email AS allEmail, np.marketing_email AS marketingEmail,
        es.email AS suppressedEmail, es.reason AS suppressionReason, es.updated_at AS suppressionUpdatedAt,
        ms.lastSentAt AS lastSentAt,
        COALESCE(ms.sendCount, 0) AS sendCount
       FROM users u
       LEFT JOIN notification_preferences np ON np.user_id = u.id
       LEFT JOIN email_suppressions es ON LOWER(es.email) = LOWER(u.email)
       LEFT JOIN (
        SELECT user_id, MAX(created_at) AS lastSentAt, COUNT(*) AS sendCount
        FROM marketing_sends
        WHERE campaign_key = ?
        GROUP BY user_id
       ) ms ON ms.user_id = u.id
       WHERE u.banned = 0 AND (LOWER(u.username) LIKE ? OR LOWER(u.display_name) LIKE ? OR LOWER(u.email) LIKE ?)
       ORDER BY ${marketingOrder} ASC, COALESCE(ms.lastSentAt, 0) DESC, u.username COLLATE NOCASE ASC`
    : `SELECT u.id, u.username, u.display_name AS displayName, u.email, u.email_suppressed_at AS emailSuppressedAt,
        np.all_email AS allEmail, np.marketing_email AS marketingEmail,
        es.email AS suppressedEmail, es.reason AS suppressionReason, es.updated_at AS suppressionUpdatedAt,
        ms.lastSentAt AS lastSentAt,
        COALESCE(ms.sendCount, 0) AS sendCount
       FROM users u
       LEFT JOIN notification_preferences np ON np.user_id = u.id
       LEFT JOIN email_suppressions es ON LOWER(es.email) = LOWER(u.email)
       LEFT JOIN (
        SELECT user_id, MAX(created_at) AS lastSentAt, COUNT(*) AS sendCount
        FROM marketing_sends
        WHERE campaign_key = ?
        GROUP BY user_id
       ) ms ON ms.user_id = u.id
       WHERE u.banned = 0
       ORDER BY ${marketingOrder} ASC, COALESCE(ms.lastSentAt, 0) DESC, u.created_at DESC`;
  const stmt = c.env.DB.prepare(query).bind(...(q ? [campaign, like, like, like] : [campaign]));
  const rows = await stmt.all<{
    id: number;
    username: string;
    displayName: string;
    email: string;
    emailSuppressedAt: number | null;
    allEmail: number | null;
    marketingEmail: number | null;
    suppressedEmail: string | null;
    suppressionReason: string | null;
    suppressionUpdatedAt: number | null;
    lastSentAt: number | null;
    sendCount: number;
  }>();
  const totalRows = await c.env.DB.prepare(
    `SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN es.email IS NULL AND u.email_suppressed_at IS NULL AND COALESCE(np.all_email, 1) != 0 AND COALESCE(np.marketing_email, 1) != 0 THEN 1 ELSE 0 END) AS subscribed,
      SUM(CASE WHEN es.email IS NULL AND u.email_suppressed_at IS NULL AND (np.all_email = 0 OR np.marketing_email = 0) THEN 1 ELSE 0 END) AS unsubscribed,
      SUM(CASE WHEN es.email IS NOT NULL OR u.email_suppressed_at IS NOT NULL THEN 1 ELSE 0 END) AS suppressed
     FROM users u
     LEFT JOIN notification_preferences np ON np.user_id = u.id
     LEFT JOIN email_suppressions es ON LOWER(es.email) = LOWER(u.email)
     WHERE u.banned = 0`,
  ).first<{ total: number; subscribed: number | null; unsubscribed: number | null; suppressed: number | null }>();
  return c.json({
    total: Number(totalRows?.total ?? 0),
    summary: {
      subscribed: Number(totalRows?.subscribed ?? 0),
      unsubscribed: Number(totalRows?.unsubscribed ?? 0),
      suppressed: Number(totalRows?.suppressed ?? 0),
    },
    users: (rows.results ?? []).map((row) => {
      const suppressed = Boolean(row.emailSuppressedAt || row.suppressedEmail);
      const marketingUnsubscribed = row.allEmail === 0 || row.marketingEmail === 0;
      return {
        ...row,
        allEmail: row.allEmail !== 0,
        marketingEmail: row.marketingEmail !== 0,
        marketingUnsubscribed,
        canReceiveMarketing: !suppressed && !marketingUnsubscribed,
        marketingStatus: suppressed ? "suppressed" : marketingUnsubscribed ? "unsubscribed" : "subscribed",
        emailSuppressedAt: row.emailSuppressedAt ? safeISO(row.emailSuppressedAt) : row.suppressionUpdatedAt ? safeISO(row.suppressionUpdatedAt) : null,
        lastSentAt: row.lastSentAt ? safeISO(row.lastSentAt) : null,
        sendCount: Number(row.sendCount ?? 0),
      };
    }),
  });
});

app.get("/marketing/sends", async (c) => {
  const page = Math.max(1, Number(c.req.query("page") ?? 1));
  const perPage = 30;
  const rows = await c.env.DB.prepare(
    `SELECT ms.id, ms.campaign_key AS campaignKey, ms.email, ms.status, ms.created_at AS createdAt,
      u.username, u.display_name AS displayName,
      admin.username AS sentByUsername,
      ee.open_count AS openCount, ee.opened_at AS openedAt, ee.last_opened_at AS lastOpenedAt,
      ee.click_count AS clickCount, ee.clicked_at AS clickedAt, ee.last_clicked_at AS lastClickedAt
     FROM marketing_sends ms
     LEFT JOIN users u ON u.id = ms.user_id
     LEFT JOIN users admin ON admin.id = ms.sent_by_user_id
     LEFT JOIN email_events ee ON ee.id = ms.email_event_id
     ORDER BY ms.created_at DESC
     LIMIT ? OFFSET ?`,
  ).bind(perPage, (page - 1) * perPage).all();
  const total = await c.get("db").$count(schema.marketingSends);
  return c.json({
    sends: (rows.results ?? []).map((row: any) => ({
      ...row,
      openCount: Number(row.openCount ?? 0),
      clickCount: Number(row.clickCount ?? 0),
      createdAt: safeISO(row.createdAt),
      openedAt: row.openedAt ? safeISO(row.openedAt) : null,
      lastOpenedAt: row.lastOpenedAt ? safeISO(row.lastOpenedAt) : null,
      clickedAt: row.clickedAt ? safeISO(row.clickedAt) : null,
      lastClickedAt: row.lastClickedAt ? safeISO(row.lastClickedAt) : null,
    })),
    total,
    page,
    perPage,
  });
});

app.post("/marketing/send", zValidator("json", z.object({
  campaignKey: z.literal(WE_ARE_BACK_CAMPAIGN).default(WE_ARE_BACK_CAMPAIGN),
  userId: z.number().int().optional(),
  userIds: z.array(z.number().int()).max(20).optional(),
  test: z.boolean().optional(),
})), async (c) => {
  const db = c.get("db");
  const admin = c.get("user")!;
  const body = c.req.valid("json");
  const emailSettings = await loadEmailSettings(db, c.req.url);
  const blockDuplicateSends = !body.test && await marketingDuplicateBlockingEnabled(db);
  const sendOne = async (user: typeof schema.users.$inferSelect, mode: "test" | "single" | "bulk") => {
    const previous = await db.query.marketingSends.findFirst({
      where: and(eq(schema.marketingSends.campaignKey, body.campaignKey), eq(schema.marketingSends.userId, user.id)),
      orderBy: desc(schema.marketingSends.createdAt),
    });
    if (mode !== "test" && blockDuplicateSends && previous) {
      if (mode === "single") {
        await db.insert(schema.activityLog).values({
          userId: admin.id,
          type: "marketing",
          summary: `Skipped duplicate ${body.campaignKey} to ${user.username}`,
          createdAt: new Date(),
        });
      }
      return {
        userId: user.id,
        username: user.username,
        email: user.email,
        status: "duplicate",
        previousSentAt: previous.createdAt ? safeISO(previous.createdAt) : null,
      };
    }
    const { siteUrl, from } = emailSettings;
    const mail = weAreBackEmail({ recipientName: user.displayName, siteUrl });
    const result = await sendManagedEmail({
      db,
      env: c.env,
      user,
      kind: "marketing",
      ...mail,
      siteUrl,
      from,
      campaignKey: body.campaignKey,
      waitUntil: c.executionCtx.waitUntil.bind(c.executionCtx),
    });

    await db.insert(schema.marketingSends).values({
      campaignKey: body.campaignKey,
      userId: user.id,
      email: user.email,
      status: result.status,
      emailEventId: result.eventId,
      sentByUserId: admin.id,
      createdAt: new Date(),
    });
    await db.insert(schema.activityLog).values({
      userId: admin.id,
      type: "marketing",
      summary: `${mode === "test" ? "Tested" : "Sent"} ${body.campaignKey} to ${user.username} (${result.status})`,
    });
    return {
      userId: user.id,
      username: user.username,
      email: user.email,
      status: result.status,
      previousSentAt: previous?.createdAt ? safeISO(previous.createdAt) : null,
    };
  };

  if (!body.test && body.userIds?.length) {
    const ids = [...new Set(body.userIds)].slice(0, 20);
    if (!ids.length) return c.json({ error: "Select users" }, 400);
    const results = [];
    for (const id of ids) {
      const user = await db.query.users.findFirst({ where: eq(schema.users.id, id) });
      if (!user) {
        results.push({ userId: id, status: "skipped", error: "User not found" });
        continue;
      }
      results.push(await sendOne(user, "bulk"));
    }
    const counts = results.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = (acc[row.status] ?? 0) + 1;
      return acc;
    }, {});
    await db.insert(schema.activityLog).values({
      userId: admin.id,
      type: "marketing",
      summary: `Bulk sent ${body.campaignKey} to ${ids.length} users (${counts.sent ?? 0} sent, ${counts.duplicate ?? 0} duplicate blocked)`,
    });
    return c.json({
      ok: true,
      status: "bulk",
      total: results.length,
      sent: counts.sent ?? 0,
      duplicate: counts.duplicate ?? 0,
      skipped: counts.skipped ?? 0,
      suppressed: counts.suppressed ?? 0,
      error: counts.error ?? 0,
      results,
    });
  }

  const targetId = body.test ? admin.id : body.userId;
  if (!targetId) return c.json({ error: "Select a user" }, 400);

  const user = await db.query.users.findFirst({ where: eq(schema.users.id, targetId) });
  if (!user) return c.json({ error: "User not found" }, 404);

  const result = await sendOne(user, body.test ? "test" : "single");

  return c.json({
    ok: result.status === "sent",
    status: result.status,
    previousSentAt: result.previousSentAt,
  });
});

app.get("/settings", async (c) => {
  const db = c.get("db");
  const rows = await db.select().from(schema.settings);
  const result: Record<string, string> = {};
  for (const r of rows) result[r.key] = r.value;
  return c.json(result);
});

app.post("/settings", zValidator("json", z.record(z.string())), async (c) => {
  const db = c.get("db");
  const body = c.req.valid("json");
  for (const [key, value] of Object.entries(body)) {
    await db
      .insert(schema.settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value } });
  }
  return c.json({ ok: true });
});

export default app;
