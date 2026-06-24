import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, desc, like } from "drizzle-orm";
import { schema } from "../db";
import { requireAuth } from "../lib/middleware";
import { safeISO } from "../lib/auth";
import { toPublicUser, type AppEnv } from "../types";

const app = new Hono<AppEnv>();

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
  const perPage = 24;

  const where = q ? like(schema.users.username, `%${q}%`) : undefined;
  const orderBy =
    sort === "newest"
      ? desc(schema.users.createdAt)
      : sort === "threads"
        ? desc(schema.users.threadCount)
        : desc(schema.users.postCount);

  const rows = await db
    .select()
    .from(schema.users)
    .where(where)
    .orderBy(orderBy)
    .limit(perPage)
    .offset((page - 1) * perPage);

  const total = await db.$count(schema.users, where);
  return c.json({
    members: rows.map(toPublicUser),
    total,
    page,
    perPage,
  });
});

// Lookup by username
app.get("/:username", async (c) => {
  const db = c.get("db");
  const page = Math.max(1, Number(c.req.query("page") ?? 1));
  const perPage = 50;
  const tab = c.req.query("tab") === "replies" ? "replies" : "threads";
  const username = c.req.param("username").toLowerCase();
  const user = await db.query.users.findFirst({
    where: eq(schema.users.username, username),
  });
  if (!user) return c.json({ error: "Member not found" }, 404);

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
    .offset((page - 1) * perPage);

  const [recentThreads, recentReplies, authoredThreadCount, activityThreadCount, realReplyCount] = await Promise.all([
    tab === "threads" ? fetchActivityThreads(c.env.DB, user.id, perPage, (page - 1) * perPage) : Promise.resolve([]),
    tab === "replies" ? replyQuery : Promise.resolve([]),
    db.$count(schema.threads, eq(schema.threads.userId, user.id)),
    countActivityThreads(c.env.DB, user.id),
    db.$count(schema.posts, eq(schema.posts.userId, user.id)),
  ]);

  const publicUser = toPublicUser(user);

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
    page,
    perPage,
    tab,
  });
});

const updateBody = z.object({
  displayName: z.string().min(2).max(60).optional(),
  bio: z.string().max(500).optional(),
  avatarUrl: z.string().url().optional().or(z.literal("")),
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
  const [updated] = await db
    .update(schema.users)
    .set({
      displayName: body.displayName,
      bio: body.bio,
      avatarUrl: body.avatarUrl === "" ? null : body.avatarUrl,
    })
    .where(eq(schema.users.username, username))
    .returning();

  return c.json({ user: toPublicUser(updated) });
});

export default app;
