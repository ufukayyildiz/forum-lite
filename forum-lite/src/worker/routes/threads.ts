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

function numericId(value: string): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
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
  const page = Math.max(1, Number(c.req.query("page") ?? 1));
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

  notifyAdminNewThread(c.env, c.executionCtx, {
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

  const tagRows = await db
    .select({ id: schema.tags.id, name: schema.tags.name, slug: schema.tags.slug })
    .from(schema.tags)
    .innerJoin(schema.threadTags, eq(schema.threadTags.tagId, schema.tags.id))
    .where(eq(schema.threadTags.threadId, t.id));

  return c.json({
    ...mapThread(t),
    content: thread?.content ?? "",
    tags: tagRows,
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
