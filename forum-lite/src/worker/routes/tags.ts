import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, desc, sql } from "drizzle-orm";
import { schema } from "../db";
import { requireRole } from "../lib/middleware";
import { slugify, safeISO } from "../lib/auth";
import type { AppEnv } from "../types";

const app = new Hono<AppEnv>();

app.get("/", async (c) => {
  const db = c.get("db");
  const rows = await db
    .select({
      id: schema.tags.id,
      name: schema.tags.name,
      slug: schema.tags.slug,
      threadCount: sql<number>`count(${schema.threadTags.threadId})`.as("thread_count"),
    })
    .from(schema.tags)
    .leftJoin(schema.threadTags, sql`${schema.threadTags.tagId} = ${schema.tags.id}`)
    .groupBy(schema.tags.id)
    .orderBy(sql`thread_count desc`);
  return c.json(rows);
});

// GET /tags/:slug — threads for a tag
app.get("/:slug", async (c) => {
  const db = c.get("db");
  const slug = c.req.param("slug");

  const tag = await db.query.tags.findFirst({ where: eq(schema.tags.slug, slug) });
  if (!tag) return c.json({ error: "Etiket bulunamadı" }, 404);

  const sort = c.req.query("sort") ?? "recent";
  const page = Math.max(1, Number(c.req.query("page") ?? 1));
  const perPage = 20;

  const orderBy =
    sort === "popular"
      ? [desc(schema.threads.views)]
      : sort === "replies"
        ? [desc(schema.threads.replyCount)]
        : [desc(schema.threads.lastPostAt)];

  const rows = await db
    .select({
      id: schema.threads.id,
      publicId: schema.threads.publicId,
      title: schema.threads.title,
      slug: schema.threads.slug,
      pinned: schema.threads.pinned,
      locked: schema.threads.locked,
      featured: schema.threads.featured,
      views: schema.threads.views,
      replyCount: schema.threads.replyCount,
      createdAt: schema.threads.createdAt,
      lastPostAt: schema.threads.lastPostAt,
      categoryId: schema.threads.categoryId,
      categoryName: schema.categories.name,
      categorySlug: schema.categories.slug,
      categoryPublicId: schema.categories.publicId,
      categoryColor: schema.categories.color,
      authorId: schema.users.id,
      authorUsername: schema.users.username,
      authorPublicId: schema.users.publicId,
      authorDisplayName: schema.users.displayName,
      authorAvatar: schema.users.avatarUrl,
    })
    .from(schema.threadTags)
    .innerJoin(schema.threads, eq(schema.threads.id, schema.threadTags.threadId))
    .innerJoin(schema.categories, eq(schema.categories.id, schema.threads.categoryId))
    .innerJoin(schema.users, eq(schema.users.id, schema.threads.userId))
    .where(eq(schema.threadTags.tagId, tag.id))
    .orderBy(...orderBy)
    .limit(perPage)
    .offset((page - 1) * perPage);

  const total = await db.$count(schema.threadTags, eq(schema.threadTags.tagId, tag.id));

  return c.json({
    tag: { id: tag.id, name: tag.name, slug: tag.slug },
    threads: rows.map((t) => ({
      id: t.id,
      publicId: t.publicId,
      title: t.title,
      slug: t.slug,
      pinned: !!t.pinned,
      locked: !!t.locked,
      featured: !!t.featured,
      views: t.views,
      replyCount: t.replyCount,
      createdAt: safeISO(t.createdAt),
      lastPostAt: safeISO(t.lastPostAt),
      category: { id: t.categoryId, name: t.categoryName, slug: t.categorySlug, publicId: t.categoryPublicId, color: t.categoryColor },
      author: { id: t.authorId, publicId: t.authorPublicId, username: t.authorUsername, displayName: t.authorDisplayName, avatarUrl: t.authorAvatar },
      tags: [{ id: tag.id, name: tag.name, slug: tag.slug }],
    })),
    total,
    page,
    perPage,
  });
});

app.post("/", requireRole("admin", "moderator"), zValidator("json", z.object({ name: z.string().min(2).max(40) })), async (c) => {
  const { name } = c.req.valid("json");
  const db = c.get("db");
  const slug = slugify(name);
  const existing = await db.query.tags.findFirst({ where: eq(schema.tags.slug, slug) });
  if (existing) return c.json({ error: "Bu etiket zaten var" }, 409);
  const [tag] = await db
    .insert(schema.tags)
    .values({ name, slug })
    .returning();
  return c.json({ id: tag.id, name: tag.name, slug: tag.slug, threadCount: 0 }, 201);
});

app.delete("/:slug", requireRole("admin"), async (c) => {
  const db = c.get("db");
  const slug = c.req.param("slug");
  const tag = await db.query.tags.findFirst({ where: eq(schema.tags.slug, slug) });
  if (!tag) return c.json({ error: "Etiket bulunamadı" }, 404);
  await db.delete(schema.tags).where(eq(schema.tags.id, tag.id));
  return c.json({ ok: true });
});

export default app;
