import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, desc, like } from "drizzle-orm";
import { schema } from "../db";
import { requireAuth } from "../lib/middleware";
import { safeISO } from "../lib/auth";
import { toPublicUser, type AppEnv } from "../types";
import { isEmailSuppressed } from "../lib/email-suppression";
import { ensureNotificationPreferences } from "../lib/notifications";

const app = new Hono<AppEnv>();

function serializeEmailPreferences(pref: typeof schema.notificationPreferences.$inferSelect) {
  return {
    allEmail: Boolean(pref.allEmail),
    replyEmail: Boolean(pref.replyEmail),
    likeEmail: Boolean(pref.likeEmail),
    marketingEmail: Boolean(pref.marketingEmail),
  };
}

async function toMemberProfile(
  db: AppEnv["Variables"]["db"],
  user: typeof schema.users.$inferSelect,
  viewer: typeof schema.users.$inferSelect | null,
) {
  const base = toPublicUser(user);
  const canViewPrivate = Boolean(viewer && (viewer.id === user.id || viewer.role === "admin"));
  if (!canViewPrivate) return base;

  const pref = await ensureNotificationPreferences(db, user.id);
  return {
    ...base,
    email: user.email,
    emailVerifiedAt: user.emailVerifiedAt ? safeISO(user.emailVerifiedAt) : null,
    emailSuppressedAt: user.emailSuppressedAt ? safeISO(user.emailSuppressedAt) : null,
    emailSuppressionReason: user.emailSuppressionReason ?? null,
    emailPreferences: serializeEmailPreferences(pref),
  };
}

async function fetchActivityThreads(db: D1Database, userId: number, perPage: number, offset: number) {
  const result = await db
    .prepare(
      `WITH activity AS (
        SELECT id AS threadId, created_at AS activityAt, 1 AS authored
        FROM threads
        WHERE user_id = ?
        UNION ALL
        SELECT thread_id AS threadId, MAX(created_at) AS activityAt, 0 AS authored
        FROM posts
        WHERE user_id = ?
        GROUP BY thread_id
      ),
      ranked AS (
        SELECT threadId, MAX(activityAt) AS activityAt, MAX(authored) AS authored
        FROM activity
        GROUP BY threadId
      )
      SELECT
        t.id AS id,
        t.public_id AS publicId,
        t.title AS title,
        t.slug AS slug,
        t.created_at AS createdAt,
        t.last_post_at AS lastPostAt,
        t.reply_count AS replyCount,
        c.id AS categoryId,
        c.name AS categoryName,
        c.slug AS categorySlug,
        c.public_id AS categoryPublicId,
        ranked.activityAt AS activityAt,
        ranked.authored AS authored
      FROM ranked
      INNER JOIN threads t ON t.id = ranked.threadId
      INNER JOIN categories c ON c.id = t.category_id
      ORDER BY ranked.activityAt DESC, t.id DESC
      LIMIT ? OFFSET ?`,
    )
    .bind(userId, userId, perPage, offset)
    .all();

  return (result.results ?? []) as Array<Record<string, unknown>>;
}

async function countActivityThreads(db: D1Database, userId: number) {
  const result = await db
    .prepare(
      `WITH ids AS (
        SELECT id AS threadId FROM threads WHERE user_id = ?
        UNION
        SELECT thread_id AS threadId FROM posts WHERE user_id = ?
      )
      SELECT COUNT(*) AS total FROM ids`,
    )
    .bind(userId, userId)
    .first<{ total: number }>();
  return Number(result?.total ?? 0);
}

app.get("/", async (c) => {
  const db = c.get("db");
  const q = c.req.query("q")?.trim();
  const sort = c.req.query("sort") ?? "posts";
  const page = Math.max(1, Number(c.req.query("page") ?? 1));
  const loadAllMembers = c.req.query("all") === "1";
  const requestedPerPage = Number(c.req.query("perPage") ?? 24);
  const pagedPerPage = Math.max(1, Math.min(200, Number.isFinite(requestedPerPage) ? Math.floor(requestedPerPage) : 24));

  const where = q ? like(schema.users.username, `%${q}%`) : undefined;
  const orderBy =
    sort === "newest"
      ? desc(schema.users.createdAt)
      : sort === "threads"
        ? desc(schema.users.threadCount)
        : desc(schema.users.postCount);

  const total = await db.$count(schema.users, where);
  const perPage = loadAllMembers ? Math.max(total, 1) : pagedPerPage;
  const offset = loadAllMembers ? 0 : (page - 1) * perPage;

  const rows = await db
    .select()
    .from(schema.users)
    .where(where)
    .orderBy(orderBy)
    .limit(perPage)
    .offset(offset);

  return c.json({
    members: rows.map(toPublicUser),
    total,
    page: loadAllMembers ? 1 : page,
    perPage,
  });
});

// Lookup by username
app.get("/:username", async (c) => {
  const db = c.get("db");
  const page = Math.max(1, Number(c.req.query("page") ?? 1));
  const loadAllActivity = c.req.query("all") === "1";
  const tab = c.req.query("tab") === "replies" ? "replies" : "threads";
  const username = c.req.param("username").toLowerCase();
  const user = await db.query.users.findFirst({
    where: eq(schema.users.username, username),
  });
  if (!user) return c.json({ error: "Member not found" }, 404);

  const [authoredThreadCount, activityThreadCount, realReplyCount] = await Promise.all([
    db.$count(schema.threads, eq(schema.threads.userId, user.id)),
    countActivityThreads(c.env.DB, user.id),
    db.$count(schema.posts, eq(schema.posts.userId, user.id)),
  ]);
  const activeTotal = tab === "replies" ? realReplyCount : activityThreadCount;
  const perPage = loadAllActivity ? Math.max(activeTotal, 1) : 50;
  const offset = loadAllActivity ? 0 : (page - 1) * perPage;

  const replyQuery = db
    .select({
      id: schema.posts.id,
      content: schema.posts.content,
      likeCount: schema.posts.likeCount,
      createdAt: schema.posts.createdAt,
      threadId: schema.threads.id,
      threadPublicId: schema.threads.publicId,
      threadTitle: schema.threads.title,
      threadSlug: schema.threads.slug,
      threadReplyCount: schema.threads.replyCount,
      categoryId: schema.categories.id,
      categoryName: schema.categories.name,
      categorySlug: schema.categories.slug,
      categoryPublicId: schema.categories.publicId,
    })
    .from(schema.posts)
    .innerJoin(schema.threads, eq(schema.threads.id, schema.posts.threadId))
    .innerJoin(schema.categories, eq(schema.categories.id, schema.threads.categoryId))
    .where(eq(schema.posts.userId, user.id))
    .orderBy(desc(schema.posts.createdAt))
    .limit(perPage)
    .offset(offset);

  const [recentThreads, recentReplies] = await Promise.all([
    tab === "threads" ? fetchActivityThreads(c.env.DB, user.id, perPage, offset) : Promise.resolve([]),
    tab === "replies" ? replyQuery : Promise.resolve([]),
  ]);

  const publicUser = await toMemberProfile(db, user, c.get("user"));

  return c.json({
    user: { ...publicUser, threadCount: activityThreadCount, postCount: realReplyCount },
    threads: recentThreads.map((t) => ({
      ...t,
      authored: Boolean(t.authored),
      createdAt: safeISO(t.createdAt as any),
      lastPostAt: safeISO(t.lastPostAt as any),
      activityAt: safeISO(t.activityAt as any),
    })),
    replies: recentReplies.map((p) => ({ ...p, createdAt: safeISO(p.createdAt) })),
    totals: { threads: activityThreadCount, authoredThreads: authoredThreadCount, replies: realReplyCount },
    page: loadAllActivity ? 1 : page,
    perPage,
    tab,
  });
});

const updateBody = z.object({
  displayName: z.string().min(2).max(60).optional(),
  email: z.string().email().optional(),
  bio: z.string().max(500).optional(),
  avatarUrl: z.string().url().optional().or(z.literal("")),
  emailPreferences: z.object({
    allEmail: z.boolean().optional(),
    replyEmail: z.boolean().optional(),
    likeEmail: z.boolean().optional(),
    marketingEmail: z.boolean().optional(),
  }).optional(),
});

// PATCH by username
app.patch("/:username", requireAuth, zValidator("json", updateBody), async (c) => {
  const db = c.get("db");
  const me = c.get("user")!;
  const username = c.req.param("username").toLowerCase();

  const target = await db.query.users.findFirst({
    where: eq(schema.users.username, username),
  });
  if (!target) return c.json({ error: "Member not found" }, 404);

  if (me.id !== target.id && me.role !== "admin") {
    return c.json({ error: "You cannot edit this profile" }, 403);
  }

  const body = c.req.valid("json");
  const userUpdate: Record<string, unknown> = {};
  if (body.displayName !== undefined) userUpdate.displayName = body.displayName.trim();
  if (body.bio !== undefined) userUpdate.bio = body.bio;
  if (body.avatarUrl !== undefined) userUpdate.avatarUrl = body.avatarUrl === "" ? null : body.avatarUrl;
  if (body.email !== undefined) {
    const email = body.email.trim().toLowerCase();
    if (email !== target.email.toLowerCase()) {
      const existing = await db.query.users.findFirst({
        where: eq(schema.users.email, email),
      });
      if (existing && existing.id !== target.id) {
        return c.json({ error: "Email is already used by another account" }, 409);
      }
      if (await isEmailSuppressed(db, email)) {
        return c.json({ error: "This email is suppressed and cannot receive mail" }, 409);
      }
      userUpdate.email = email;
      userUpdate.emailVerifiedAt = null;
      userUpdate.emailSuppressedAt = null;
      userUpdate.emailSuppressionReason = null;
    }
  }

  if (Object.keys(userUpdate).length) {
    await db.update(schema.users).set(userUpdate).where(eq(schema.users.id, target.id));
  }

  if (body.emailPreferences) {
    await ensureNotificationPreferences(db, target.id);
    const prefUpdate: Record<string, unknown> = { updatedAt: new Date() };
    if (body.emailPreferences.allEmail !== undefined) prefUpdate.allEmail = body.emailPreferences.allEmail;
    if (body.emailPreferences.replyEmail !== undefined) prefUpdate.replyEmail = body.emailPreferences.replyEmail;
    if (body.emailPreferences.likeEmail !== undefined) prefUpdate.likeEmail = body.emailPreferences.likeEmail;
    if (body.emailPreferences.marketingEmail !== undefined) prefUpdate.marketingEmail = body.emailPreferences.marketingEmail;
    await db
      .update(schema.notificationPreferences)
      .set(prefUpdate)
      .where(eq(schema.notificationPreferences.userId, target.id));
  }

  const updated = await db.query.users.findFirst({ where: eq(schema.users.id, target.id) });
  if (!updated) return c.json({ error: "Member not found" }, 404);

  return c.json({ user: await toMemberProfile(db, updated, me) });
});

export default app;
