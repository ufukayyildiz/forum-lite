import { Hono } from "hono";
import { like, or, desc, eq } from "drizzle-orm";
import { schema } from "../db";
import { safeISO } from "../lib/auth";
import type { AppEnv } from "../types";

const app = new Hono<AppEnv>();

app.get("/", async (c) => {
  const db = c.get("db");
  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 2) return c.json({ threads: [], posts: [], users: [] });

  const pat = `%${q}%`;

  const threads = await db
    .select({
      id: schema.threads.id,
      publicId: schema.threads.publicId,
      title: schema.threads.title,
      slug: schema.threads.slug,
      createdAt: schema.threads.createdAt,
      replyCount: schema.threads.replyCount,
      categoryName: schema.categories.name,
      categorySlug: schema.categories.slug,
      categoryPublicId: schema.categories.publicId,
      authorUsername: schema.users.username,
      authorDisplayName: schema.users.displayName,
    })
    .from(schema.threads)
    .innerJoin(schema.categories, eq(schema.categories.id, schema.threads.categoryId))
    .innerJoin(schema.users, eq(schema.users.id, schema.threads.userId))
    .where(or(like(schema.threads.title, pat), like(schema.threads.content, pat)))
    .orderBy(desc(schema.threads.lastPostAt))
    .limit(10);

  const users = await db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      displayName: schema.users.displayName,
      avatarUrl: schema.users.avatarUrl,
      role: schema.users.role,
      postCount: schema.users.postCount,
    })
    .from(schema.users)
    .where(or(like(schema.users.username, pat), like(schema.users.displayName, pat)))
    .limit(5);

  return c.json({
    threads: threads.map((t) => ({ ...t, createdAt: safeISO(t.createdAt) })),
    posts: [],
    users,
  });
});

export default app;
