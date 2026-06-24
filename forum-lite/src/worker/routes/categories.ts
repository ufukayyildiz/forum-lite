import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, or, sql } from "drizzle-orm";
import { schema } from "../db";
import { requireRole } from "../lib/middleware";
import { slugify, safeISO, generateShortId } from "../lib/auth";
import type { AppEnv } from "../types";

const app = new Hono<AppEnv>();

function numericId(value: string): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function categoryIdentifierWhere(identifier: string) {
  const n = numericId(identifier);
  return n
    ? or(eq(schema.categories.publicId, identifier), eq(schema.categories.id, n), eq(schema.categories.slug, identifier))
    : or(eq(schema.categories.publicId, identifier), eq(schema.categories.slug, identifier));
}

const categoryBody = z.object({
  name: z.string().min(2).max(60),
  description: z.string().max(400).optional(),
  color: z.string().optional(),
  icon: z.string().optional(),
  position: z.number().int().optional(),
});

app.get("/", async (c) => {
  const db = c.get("db");
  const rows = await db.select().from(schema.categories).orderBy(schema.categories.position, schema.categories.id);

  const counts = await db
    .select({
      categoryId: schema.threads.categoryId,
      threadCount: sql<number>`count(*)`.as("thread_count"),
      postCount: sql<number>`coalesce(sum(${schema.threads.replyCount}),0) + count(*)`.as("post_count"),
    })
    .from(schema.threads)
    .groupBy(schema.threads.categoryId);

  const countMap = new Map(counts.map((x) => [x.categoryId, x]));
  return c.json(
    rows.map((cat) => ({
      ...cat,
      createdAt: safeISO(cat.createdAt),
      threadCount: countMap.get(cat.id)?.threadCount ?? 0,
      postCount: countMap.get(cat.id)?.postCount ?? 0,
    })),
  );
});

app.get("/:id", async (c) => {
  const db = c.get("db");
  const cat = await db.query.categories.findFirst({
    where: categoryIdentifierWhere(c.req.param("id")),
  });
  if (!cat) return c.json({ error: "Kategori bulunamadı" }, 404);
  return c.json({ ...cat, createdAt: safeISO(cat.createdAt) });
});

app.post("/", requireRole("admin"), zValidator("json", categoryBody), async (c) => {
  const body = c.req.valid("json");
  const db = c.get("db");
  const [cat] = await db
    .insert(schema.categories)
    .values({
      publicId: generateShortId(),
      name: body.name,
      slug: slugify(body.name),
      description: body.description,
      color: body.color ?? "#b8bb26",
      icon: body.icon ?? "Hash",
      position: body.position ?? 0,
    })
    .returning();
  return c.json({ ...cat, createdAt: safeISO(cat.createdAt) }, 201);
});

app.patch("/:id", requireRole("admin"), zValidator("json", categoryBody.partial()), async (c) => {
  const body = c.req.valid("json");
  const db = c.get("db");
  const id = Number(c.req.param("id"));
  const [cat] = await db.update(schema.categories).set(body).where(eq(schema.categories.id, id)).returning();
  if (!cat) return c.json({ error: "Kategori bulunamadı" }, 404);
  return c.json({ ...cat, createdAt: safeISO(cat.createdAt) });
});

app.delete("/:id", requireRole("admin"), async (c) => {
  const db = c.get("db");
  await db.delete(schema.categories).where(eq(schema.categories.id, Number(c.req.param("id"))));
  return c.json({ ok: true });
});

export default app;
