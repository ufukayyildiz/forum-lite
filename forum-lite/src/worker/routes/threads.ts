import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, desc, or, sql } from "drizzle-orm";
import { schema } from "../db";
import { requireAuth, requireRole } from "../lib/middleware";
import { slugify, safeISO, generatePublicId } from "../lib/auth";
import { toPublicUser, type AppEnv } from "../types";
import type { DB } from "../db";
import { notifyAdminNewThread } from "../lib/admin-alerts";

const app = new Hono<AppEnv>();
const PUBLIC_ID_ATTEMPTS = 20;
const VALUABLE_THREAD_MIN_AGE_DAYS = 180;
const VALUABLE_THREAD_MIN_VIEWS = 500;
const VALUABLE_THREAD_MIN_REPLIES = 3;

const threadAuthorSelect = {
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
  updatedAt: schema.threads.updatedAt,
  lastPostAt: schema.threads.lastPostAt,
  categoryId: schema.threads.categoryId,
  categoryName: schema.categories.name,
  categorySlug: schema.categories.slug,
  categoryPublicId: schema.categories.publicId,
  categoryColor: schema.categories.color,
  authorId: schema.users.id,
  authorPublicId: schema.users.publicId,
  authorUsername: schema.users.username,
  authorDisplayName: schema.users.displayName,
  authorAvatar: schema.users.avatarUrl,
};

function dateMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value > 1e10 ? value : value * 1000;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n) && value.trim() !== "") return dateMs(n);
    return Date.parse(value);
  }
  return NaN;
}

function newestDateValue(...values: unknown[]): Date | null {
  let newest: { time: number } | null = null;
  for (const value of values) {
    if (value == null) continue;
    const time = dateMs(value);
    if (Number.isNaN(time)) continue;
    if (!newest || time > newest.time) newest = { time };
  }
  return newest ? new Date(newest.time) : null;
}

function reviewedAtForThread(t: any): string | null {
  const createdMs = dateMs(t.createdAt);
  if (Number.isNaN(createdMs)) return null;
  const ageDays = (Date.now() - createdMs) / 86_400_000;
  const views = Number(t.views ?? 0);
  const replies = Number(t.replyCount ?? 0);
  if (ageDays < VALUABLE_THREAD_MIN_AGE_DAYS) return null;
  if (!t.featured && views < VALUABLE_THREAD_MIN_VIEWS && replies < VALUABLE_THREAD_MIN_REPLIES) return null;
  return safeISO(newestDateValue(t.updatedAt, t.lastPostAt, t.createdAt));
}

function mapThread(t: any) {
  return {
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
    updatedAt: safeISO(t.updatedAt),
    lastPostAt: safeISO(t.lastPostAt),
    reviewedAt: reviewedAtForThread(t),
    category: { id: t.categoryId, name: t.categoryName, slug: t.categorySlug, publicId: t.categoryPublicId, color: t.categoryColor },
    author: {
      id: t.authorId,
      publicId: t.authorPublicId,
      username: t.authorUsername,
      displayName: t.authorDisplayName,
      avatarUrl: t.authorAvatar,
    },
    tags: [],
  };
}

async function loadRelatedThread(env: AppEnv["Bindings"], threadId: number, categoryId: number) {
  const selectSql = `SELECT t.id, t.public_id AS publicId, t.title, t.slug, t.pinned, t.locked, t.featured,
      t.views, t.reply_count AS replyCount, t.created_at AS createdAt, t.updated_at AS updatedAt, t.last_post_at AS lastPostAt,
      c.id AS categoryId, c.name AS categoryName, c.slug AS categorySlug, c.public_id AS categoryPublicId, c.color AS categoryColor,
      u.id AS authorId, u.public_id AS authorPublicId, u.username AS authorUsername, u.display_name AS authorDisplayName,
      u.avatar_url AS authorAvatar`;

  const tagged = await env.DB.prepare(
    `${selectSql}, COUNT(tt.tag_id) AS matchCount
     FROM thread_tags current_tags
     INNER JOIN thread_tags tt ON tt.tag_id = current_tags.tag_id
     INNER JOIN threads t ON t.id = tt.thread_id
     INNER JOIN categories c ON c.id = t.category_id
     INNER JOIN users u ON u.id = t.user_id
     WHERE current_tags.thread_id = ? AND t.id <> ?
     GROUP BY t.id
     ORDER BY matchCount DESC, t.last_post_at DESC
     LIMIT 1`,
  )
    .bind(threadId, threadId)
    .first<Record<string, unknown>>();

  if (tagged) return mapThread(tagged);

  const categoryFallback = await env.DB.prepare(
    `${selectSql}
     FROM threads t
     INNER JOIN categories c ON c.id = t.category_id
     INNER JOIN users u ON u.id = t.user_id
     WHERE t.category_id = ? AND t.id <> ?
     ORDER BY t.last_post_at DESC
     LIMIT 1`,
  )
    .bind(categoryId, threadId)
    .first<Record<string, unknown>>();

  return categoryFallback ? mapThread(categoryFallback) : null;
}

function numericId(value: string): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function positivePage(value: string | undefined): number {
  const page = Number(value ?? 1);
  return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
}

function threadIdentifierWhere(identifier: string) {
  const n = numericId(identifier);
  const clauses: any[] = [eq(schema.threads.publicId, identifier)];
  if (n) clauses.push(eq(schema.threads.id, n));
  if (/^\d{12}$/.test(identifier)) {
    clauses.push(sql`printf('%012d', 100000000000 + ((${schema.threads.id} * 982451653 + 57885161) % 900000000000)) = ${identifier}`);
  }
  return clauses.length === 1 ? clauses[0] : or(...clauses);
}

async function createThreadPublicId(db: DB): Promise<string> {
  for (let attempt = 0; attempt < PUBLIC_ID_ATTEMPTS; attempt++) {
    const publicId = generatePublicId();
    const existing = await db.query.threads.findFirst({
      where: eq(schema.threads.publicId, publicId),
      columns: { id: true },
    });
    if (!existing) return publicId;
  }
  throw new Error("Could not allocate a unique thread public_id");
}

app.get("/", async (c) => {
  const db = c.get("db");
  const categoryFilter = c.req.query("category");
  const sort = c.req.query("sort") ?? "recent";
  const page = positivePage(c.req.query("page"));
  const loadAllThreads = c.req.query("all") === "1";

  let where: any = undefined;
  if (categoryFilter) {
    const n = numericId(categoryFilter);
    const category = await db.query.categories.findFirst({
      where: n
        ? or(eq(schema.categories.publicId, categoryFilter), eq(schema.categories.id, n), eq(schema.categories.slug, categoryFilter))
        : or(eq(schema.categories.publicId, categoryFilter), eq(schema.categories.slug, categoryFilter)),
      columns: { id: true },
    });
    if (!category) return c.json({ threads: [], total: 0, page: loadAllThreads ? 1 : page, perPage: 20 });
    where = eq(schema.threads.categoryId, category.id);
  }

  const orderBy =
    sort === "popular"
      ? [desc(schema.threads.pinned), desc(schema.threads.views)]
      : sort === "replies"
        ? [desc(schema.threads.pinned), desc(schema.threads.replyCount)]
        : [desc(schema.threads.pinned), desc(schema.threads.lastPostAt)];

  const total = await db.$count(schema.threads, where);
  const perPage = loadAllThreads ? Math.max(total, 1) : 20;
  const offset = loadAllThreads ? 0 : (page - 1) * perPage;

  const rows = await db
    .select(threadAuthorSelect)
    .from(schema.threads)
    .innerJoin(schema.categories, eq(schema.categories.id, schema.threads.categoryId))
    .innerJoin(schema.users, eq(schema.users.id, schema.threads.userId))
    .where(where)
    .orderBy(...orderBy)
    .limit(perPage)
    .offset(offset);

  return c.json({ threads: rows.map(mapThread), total, page: loadAllThreads ? 1 : page, perPage });
});

app.get("/recent", async (c) => {
  const db = c.get("db");
  const rows = await db
    .select(threadAuthorSelect)
    .from(schema.threads)
    .innerJoin(schema.categories, eq(schema.categories.id, schema.threads.categoryId))
    .innerJoin(schema.users, eq(schema.users.id, schema.threads.userId))
    .orderBy(desc(schema.threads.lastPostAt))
    .limit(8);
  return c.json(rows.map(mapThread));
});

app.get("/featured", async (c) => {
  const db = c.get("db");
  const rows = await db
    .select(threadAuthorSelect)
    .from(schema.threads)
    .innerJoin(schema.categories, eq(schema.categories.id, schema.threads.categoryId))
    .innerJoin(schema.users, eq(schema.users.id, schema.threads.userId))
    .where(eq(schema.threads.featured, true))
    .orderBy(desc(schema.threads.lastPostAt))
    .limit(5);
  return c.json(rows.map(mapThread));
});

const createBody = z.object({
  categoryId: z.number().int(),
  title: z.string().min(5, "Title must be at least 5 characters").max(200),
  content: z.string().min(10, "Content must be at least 10 characters"),
  tagIds: z.array(z.number().int()).max(5, "You can select at most 5 tags").optional(),
});

const updateBody = z.object({
  title: z.string().min(5, "Title must be at least 5 characters").max(200).optional(),
  content: z.string().min(2, "Content must be at least 2 characters").optional(),
}).refine((body) => body.title !== undefined || body.content !== undefined, {
  message: "No fields to update",
});

app.post("/", requireAuth, zValidator("json", createBody), async (c) => {
  const db = c.get("db");
  const user = c.get("user")!;
  const body = c.req.valid("json");
  const now = new Date();
  const publicId = await createThreadPublicId(db);

  const [thread] = await db
    .insert(schema.threads)
    .values({
      categoryId: body.categoryId,
      userId: user.id,
      publicId,
      title: body.title,
      slug: slugify(body.title),
      content: body.content,
      createdAt: now,
      updatedAt: now,
      lastPostAt: now,
    })
    .returning();

  const tagIds = Array.from(new Set(body.tagIds ?? []));
  if (tagIds.length) {
    await db.insert(schema.threadTags).values(tagIds.map((tagId) => ({ threadId: thread.id, tagId })));
  }

  await db
    .update(schema.users)
    .set({ threadCount: sql`${schema.users.threadCount} + 1` })
    .where(eq(schema.users.id, user.id));

  notifyAdminNewThread(db, c.env, c.executionCtx, c.req.url, {
    publicId: thread.publicId,
    title: thread.title,
    content: body.content,
    categoryId: body.categoryId,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
  });

  return c.json({ id: thread.id, publicId: thread.publicId, slug: thread.slug }, 201);
});

app.get("/:id", async (c) => {
  const db = c.get("db");
  const identifier = c.req.param("id");

  const rows = await db
    .select(threadAuthorSelect)
    .from(schema.threads)
    .innerJoin(schema.categories, eq(schema.categories.id, schema.threads.categoryId))
    .innerJoin(schema.users, eq(schema.users.id, schema.threads.userId))
    .where(threadIdentifierWhere(identifier))
    .limit(1);

  if (!rows.length) return c.json({ error: "Thread not found" }, 404);

  const t = rows[0];

  await db
    .update(schema.threads)
    .set({ views: sql`${schema.threads.views} + 1` })
    .where(eq(schema.threads.id, t.id));

  const thread = await db.query.threads.findFirst({ where: eq(schema.threads.id, t.id) });

  const [tagRows, relatedThread] = await Promise.all([
    db
      .select({ id: schema.tags.id, name: schema.tags.name, slug: schema.tags.slug })
      .from(schema.tags)
      .innerJoin(schema.threadTags, eq(schema.threadTags.tagId, schema.tags.id))
      .where(eq(schema.threadTags.threadId, t.id)),
    loadRelatedThread(c.env, Number(t.id), Number(t.categoryId)),
  ]);

  return c.json({
    ...mapThread(t),
    content: thread?.content ?? "",
    tags: tagRows,
    relatedThread,
    author: {
      id: t.authorId,
      publicId: t.authorPublicId,
      username: t.authorUsername,
      displayName: t.authorDisplayName,
      avatarUrl: t.authorAvatar,
      role: "member",
    },
  });
});

app.patch("/:id", requireRole("admin", "moderator"), zValidator("json", updateBody), async (c) => {
  const db = c.get("db");
  const body = c.req.valid("json");
  const thread = await db.query.threads.findFirst({ where: threadIdentifierWhere(c.req.param("id")) });
  if (!thread) return c.json({ error: "Thread not found" }, 404);

  const now = new Date();
  const update: Record<string, unknown> = { updatedAt: now };
  if (body.title !== undefined) {
    update.title = body.title;
    update.slug = slugify(body.title);
  }
  if (body.content !== undefined) update.content = body.content;

  const [updated] = await db
    .update(schema.threads)
    .set(update)
    .where(eq(schema.threads.id, thread.id))
    .returning();

  return c.json({ id: updated.id, publicId: updated.publicId, slug: updated.slug });
});

app.delete("/:id", requireRole("admin", "moderator"), async (c) => {
  const db = c.get("db");
  const thread = await db.query.threads.findFirst({ where: threadIdentifierWhere(c.req.param("id")) });
  if (!thread) return c.json({ error: "Thread not found" }, 404);

  await db.delete(schema.threads).where(eq(schema.threads.id, thread.id));
  await db
    .update(schema.users)
    .set({ threadCount: sql`max(0, ${schema.users.threadCount} - 1)` })
    .where(eq(schema.users.id, thread.userId));

  return c.json({ ok: true });
});

app.patch("/:id/pin", requireRole("admin", "moderator"), async (c) => {
  const db = c.get("db");
  const thread = await db.query.threads.findFirst({ where: threadIdentifierWhere(c.req.param("id")) });
  if (!thread) return c.json({ error: "Not found" }, 404);
  await db.update(schema.threads).set({ pinned: !thread.pinned }).where(eq(schema.threads.id, thread.id));
  return c.json({ ok: true, pinned: !thread.pinned });
});

app.patch("/:id/lock", requireRole("admin", "moderator"), async (c) => {
  const db = c.get("db");
  const thread = await db.query.threads.findFirst({ where: threadIdentifierWhere(c.req.param("id")) });
  if (!thread) return c.json({ error: "Not found" }, 404);
  await db.update(schema.threads).set({ locked: !thread.locked }).where(eq(schema.threads.id, thread.id));
  return c.json({ ok: true, locked: !thread.locked });
});

app.patch("/:id/feature", requireRole("admin", "moderator"), async (c) => {
  const db = c.get("db");
  const thread = await db.query.threads.findFirst({ where: threadIdentifierWhere(c.req.param("id")) });
  if (!thread) return c.json({ error: "Not found" }, 404);
  await db.update(schema.threads).set({ featured: !thread.featured }).where(eq(schema.threads.id, thread.id));
  return c.json({ ok: true, featured: !thread.featured });
});

export default app;
