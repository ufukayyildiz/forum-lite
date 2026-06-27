import { Hono } from "hono";
import { eq, desc, sql } from "drizzle-orm";
import { schema } from "../db";
import { safeISO } from "../lib/auth";
import type { AppEnv } from "../types";

const app = new Hono<AppEnv>();

function mapAnchor(row: typeof schema.anchorLinks.$inferSelect) {
  return {
    id: row.id,
    term: row.term,
    url: row.url,
    title: row.title,
    enabled: row.enabled,
    clickCount: row.clickCount,
    createdAt: safeISO(row.createdAt),
    updatedAt: safeISO(row.updatedAt),
  };
}

app.get("/", async (c) => {
  try {
    const db = c.get("db");
    const rows = await db
      .select()
      .from(schema.anchorLinks)
      .where(eq(schema.anchorLinks.enabled, true))
      .orderBy(sql`length(${schema.anchorLinks.term}) desc`, desc(schema.anchorLinks.clickCount), schema.anchorLinks.term)
      .limit(500);
    c.header("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    return c.json(rows.map(mapAnchor));
  } catch (error) {
    console.error("anchors_unavailable", error);
    c.header("Cache-Control", "public, max-age=30, stale-while-revalidate=300");
    return c.json([]);
  }
});

app.post("/:id/click", async (c) => {
  try {
    const db = c.get("db");
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: "Invalid anchor" }, 400);
    await db
      .update(schema.anchorLinks)
      .set({
        clickCount: sql`${schema.anchorLinks.clickCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(schema.anchorLinks.id, id));
    return c.json({ ok: true });
  } catch (error) {
    console.error("anchor_click_skipped", error);
    return c.json({ ok: false, skipped: true });
  }
});

export default app;
