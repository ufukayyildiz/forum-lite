import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, asc, desc, sql } from "drizzle-orm";
import { schema } from "../db";
import { requireAuth } from "../lib/middleware";
import { safeISO } from "../lib/auth";
import { toPublicUser, type AppEnv } from "../types";

const app = new Hono<AppEnv>();

app.get("/", async (c) => {
  const db = c.get("db");
  const threadId = Number(c.req.query("threadId"));
  if (!threadId) return c.json({ error: "threadId is required" }, 400);
  const page = Math.max(1, Number(c.req.query("page") ?? 1));
  const perPage = 20;
  const me = c.get("user");

  const rows = await db
    .select({
      id: schema.posts.id,
      content: schema.posts.content,
      likeCount: schema.posts.likeCount,
      editedAt: schema.posts.editedAt,
      createdAt: schema.posts.createdAt,
      authorId: schema.users.id,
      authorUsername: schema.users.username,
      authorDisplayName: schema.users.displayName,
      authorAvatar: schema.users.avatarUrl,
      authorRole: schema.users.role,
      authorPostCount: schema.users.postCount,
      authorThreadCount: schema.users.threadCount,
      authorCreatedAt: schema.users.createdAt,
      authorBio: schema.users.bio,
    })
    .from(schema.posts)
    .innerJoin(schema.users, eq(schema.users.id, schema.posts.userId))
    .where(eq(schema.posts.threadId, threadId))
    .orderBy(asc(schema.posts.createdAt))
    .limit(perPage)
    .offset((page - 1) * perPage);

  const total = await db.$count(schema.posts, eq(schema.posts.threadId, threadId));

  let likedPostIds: Set<number> = new Set();
  if (me) {
    const liked = await db
      .select({ postId: schema.likes.postId })
      .from(schema.likes)
      .where(eq(schema.likes.userId, me.id));
    likedPostIds = new Set(liked.map((l) => l.postId));
  }

  return c.json({
    posts: rows.map((p) => ({
      id: p.id,
      content: p.content,
      likeCount: p.likeCount,
      likedByMe: likedPostIds.has(p.id),
      editedAt: p.editedAt ? safeISO(p.editedAt) : null,
      createdAt: safeISO(p.createdAt),
      author: {
        id: p.authorId,
        username: p.authorUsername,
        displayName: p.authorDisplayName,
        avatarUrl: p.authorAvatar,
        role: p.authorRole,
        postCount: p.authorPostCount,
        threadCount: p.authorThreadCount,
        createdAt: safeISO(p.authorCreatedAt),
        bio: p.authorBio,
      },
    })),
    total,
    page,
    perPage,
  });
});

const createBody = z.object({
  threadId: z.number().int(),
  content: z.string().min(2, "Enter at least 2 characters"),
});

app.post("/", requireAuth, zValidator("json", createBody), async (c) => {
  const db = c.get("db");
  const user = c.get("user")!;
  const body = c.req.valid("json");

  const thread = await db.query.threads.findFirst({ where: eq(schema.threads.id, body.threadId) });
  if (!thread) return c.json({ error: "Thread not found" }, 404);
  if (thread.locked && user.role === "member") return c.json({ error: "This thread is locked" }, 403);

  const now = new Date();
  const [post] = await db
    .insert(schema.posts)
    .values({ threadId: body.threadId, userId: user.id, content: body.content, createdAt: now })
    .returning();

  await db
    .update(schema.threads)
    .set({ replyCount: sql`${schema.threads.replyCount} + 1`, lastPostAt: now })
    .where(eq(schema.threads.id, body.threadId));
  await db
    .update(schema.users)
    .set({ postCount: sql`${schema.users.postCount} + 1` })
    .where(eq(schema.users.id, user.id));

  return c.json(
    {
      id: post.id,
      content: post.content,
      likeCount: 0,
      likedByMe: false,
      editedAt: null,
      createdAt: safeISO(post.createdAt),
      author: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        role: user.role,
        postCount: user.postCount + 1,
        threadCount: user.threadCount,
        createdAt: safeISO(user.createdAt),
        bio: user.bio,
      },
    },
    201,
  );
});

app.patch("/:id", requireAuth, zValidator("json", z.object({ content: z.string().min(2) })), async (c) => {
  const db = c.get("db");
  const user = c.get("user")!;
  const id = Number(c.req.param("id"));
  const post = await db.query.posts.findFirst({ where: eq(schema.posts.id, id) });
  if (!post) return c.json({ error: "Post not found" }, 404);
  if (post.userId !== user.id && user.role === "member") return c.json({ error: "You do not have permission" }, 403);
  const { content } = c.req.valid("json");
  const [updated] = await db
    .update(schema.posts)
    .set({ content, editedAt: new Date() })
    .where(eq(schema.posts.id, id))
    .returning();
  return c.json({ id: updated.id, content: updated.content, editedAt: updated.editedAt ? safeISO(updated.editedAt) : null });
});

app.delete("/:id", requireAuth, async (c) => {
  const db = c.get("db");
  const user = c.get("user")!;
  const id = Number(c.req.param("id"));
  const post = await db.query.posts.findFirst({ where: eq(schema.posts.id, id) });
  if (!post) return c.json({ error: "Post not found" }, 404);
  if (post.userId !== user.id && user.role === "member") return c.json({ error: "You do not have permission" }, 403);
  await db.delete(schema.posts).where(eq(schema.posts.id, id));
  await db
    .update(schema.threads)
    .set({ replyCount: sql`max(0, ${schema.threads.replyCount} - 1)` })
    .where(eq(schema.threads.id, post.threadId));
  return c.json({ ok: true });
});

app.post("/:id/like", requireAuth, async (c) => {
  const db = c.get("db");
  const user = c.get("user")!;
  const id = Number(c.req.param("id"));
  const post = await db.query.posts.findFirst({ where: eq(schema.posts.id, id) });
  if (!post) return c.json({ error: "Post not found" }, 404);

  const existing = await db.query.likes.findFirst({
    where: and(eq(schema.likes.postId, id), eq(schema.likes.userId, user.id)),
  });

  if (existing) {
    await db.delete(schema.likes).where(and(eq(schema.likes.postId, id), eq(schema.likes.userId, user.id)));
    const [updated] = await db
      .update(schema.posts)
      .set({ likeCount: sql`max(0,${schema.posts.likeCount} - 1)` })
      .where(eq(schema.posts.id, id))
      .returning();
    return c.json({ liked: false, likeCount: updated.likeCount });
  } else {
    await db.insert(schema.likes).values({ postId: id, userId: user.id });
    const [updated] = await db
      .update(schema.posts)
      .set({ likeCount: sql`${schema.posts.likeCount} + 1` })
      .where(eq(schema.posts.id, id))
      .returning();
    return c.json({ liked: true, likeCount: updated.likeCount });
  }
});

export default app;
