import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, eq, desc, sql } from "drizzle-orm";
import { schema } from "../db";
import { requireRole } from "../lib/middleware";
import { safeISO } from "../lib/auth";
import { toPublicUser, type AppEnv } from "../types";
import { loadEmailSettings, sendManagedEmail, weAreBackEmail } from "../lib/notifications";

const app = new Hono<AppEnv>();
const WE_ARE_BACK_CAMPAIGN = "we-are-back";

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
  const query = q
    ? `SELECT u.id, u.username, u.display_name AS displayName, u.email, u.email_suppressed_at AS emailSuppressedAt,
        np.all_email AS allEmail, np.marketing_email AS marketingEmail,
        es.email AS suppressedEmail, es.reason AS suppressionReason, es.updated_at AS suppressionUpdatedAt,
        (SELECT MAX(ms.created_at) FROM marketing_sends ms WHERE ms.user_id = u.id AND ms.campaign_key = ?) AS lastSentAt,
        (SELECT COUNT(*) FROM marketing_sends ms WHERE ms.user_id = u.id AND ms.campaign_key = ?) AS sendCount
       FROM users u
       LEFT JOIN notification_preferences np ON np.user_id = u.id
       LEFT JOIN email_suppressions es ON LOWER(es.email) = LOWER(u.email)
       WHERE u.banned = 0 AND (LOWER(u.username) LIKE ? OR LOWER(u.display_name) LIKE ? OR LOWER(u.email) LIKE ?)
       ORDER BY CASE WHEN es.email IS NOT NULL OR u.email_suppressed_at IS NOT NULL THEN 2 WHEN np.all_email = 0 OR np.marketing_email = 0 THEN 1 ELSE 0 END DESC, u.username LIMIT 120`
    : `SELECT u.id, u.username, u.display_name AS displayName, u.email, u.email_suppressed_at AS emailSuppressedAt,
        np.all_email AS allEmail, np.marketing_email AS marketingEmail,
        es.email AS suppressedEmail, es.reason AS suppressionReason, es.updated_at AS suppressionUpdatedAt,
        (SELECT MAX(ms.created_at) FROM marketing_sends ms WHERE ms.user_id = u.id AND ms.campaign_key = ?) AS lastSentAt,
        (SELECT COUNT(*) FROM marketing_sends ms WHERE ms.user_id = u.id AND ms.campaign_key = ?) AS sendCount
       FROM users u
       LEFT JOIN notification_preferences np ON np.user_id = u.id
       LEFT JOIN email_suppressions es ON LOWER(es.email) = LOWER(u.email)
       WHERE u.banned = 0
       ORDER BY CASE WHEN es.email IS NOT NULL OR u.email_suppressed_at IS NOT NULL THEN 2 WHEN np.all_email = 0 OR np.marketing_email = 0 THEN 1 ELSE 0 END DESC, u.created_at DESC LIMIT 120`;
  const stmt = c.env.DB.prepare(query).bind(...(q ? [campaign, campaign, like, like, like] : [campaign, campaign]));
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
  return c.json({
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
  test: z.boolean().optional(),
})), async (c) => {
  const db = c.get("db");
  const admin = c.get("user")!;
  const body = c.req.valid("json");
  const targetId = body.test ? admin.id : body.userId;
  if (!targetId) return c.json({ error: "Select a user" }, 400);

  const user = await db.query.users.findFirst({ where: eq(schema.users.id, targetId) });
  if (!user) return c.json({ error: "User not found" }, 404);

  const previous = await db.query.marketingSends.findFirst({
    where: and(eq(schema.marketingSends.campaignKey, body.campaignKey), eq(schema.marketingSends.userId, user.id)),
    orderBy: desc(schema.marketingSends.createdAt),
  });
  const { siteUrl, from } = await loadEmailSettings(db, c.req.url);
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
    summary: `${body.test ? "Tested" : "Sent"} ${body.campaignKey} to ${user.username} (${result.status})`,
  });

  return c.json({
    ok: result.status === "sent",
    status: result.status,
    previousSentAt: previous?.createdAt ? safeISO(previous.createdAt) : null,
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
