import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { schema } from "../db";
import { requireAuth } from "../lib/middleware";
import { generateToken } from "../lib/auth";
import type { AppEnv } from "../types";

const app = new Hono<AppEnv>();

const EXT_TO_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
};

async function getUploadConfig(db: any) {
  const rows: { key: string; value: string }[] = await db.select().from(schema.settings);
  const s: Record<string, string> = {};
  for (const r of rows) s[r.key] = r.value;

  const enabled = s["uploads_enabled"] !== "false";
  const maxMb = Math.min(50, Math.max(1, Number(s["max_attachment_size_mb"] || "10")));
  const exts = (s["allowed_file_types"] || "jpg,jpeg,png,gif,webp,pdf")
    .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  const allowedMime = [...new Set(exts.map((e) => EXT_TO_MIME[e]).filter(Boolean))];

  return { enabled, maxMb, maxBytes: maxMb * 1024 * 1024, allowedMime };
}

// Public: return upload config for the frontend
app.get("/config", async (c) => {
  const { enabled, maxMb, allowedMime } = await getUploadConfig(c.get("db"));
  return c.json({ enabled, maxMb, allowedMime });
});

app.post("/upload", requireAuth, async (c) => {
  const user = c.get("user")!;
  const db = c.get("db");
  const bucket = c.env.BUCKET;
  if (!bucket) return c.json({ error: "R2 bucket is not configured" }, 503);

  const { enabled, maxBytes, allowedMime } = await getUploadConfig(db);
  if (!enabled) return c.json({ error: "File uploads are disabled" }, 403);

  const formData = await c.req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return c.json({ error: "No file provided" }, 400);
  if (!allowedMime.includes(file.type)) return c.json({ error: `File type not allowed: ${file.type}` }, 415);
  if (file.size > maxBytes) return c.json({ error: `File exceeds ${maxBytes / 1024 / 1024} MB limit` }, 413);

  const key = `attachments/${user.id}/${generateToken()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  await bucket.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  const [att] = await db
    .insert(schema.attachments)
    .values({ key, userId: user.id, filename: file.name, mime: file.type, size: file.size })
    .returning();
  return c.json({ id: att.id, key, url: `/api/attachments/${att.id}`, filename: att.filename, mime: att.mime }, 201);
});

app.get("/:id", async (c) => {
  const db = c.get("db");
  const att = await db.query.attachments.findFirst({ where: eq(schema.attachments.id, Number(c.req.param("id"))) });
  if (!att) return c.json({ error: "File not found" }, 404);
  if (!c.env.BUCKET) return c.json({ error: "R2 bucket is not configured" }, 503);
  const obj = await c.env.BUCKET.get(att.key);
  if (!obj) return c.json({ error: "File not found in storage" }, 404);
  return new Response(obj.body, {
    headers: {
      "Content-Type": att.mime,
      "Content-Disposition": `inline; filename="${att.filename}"`,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Length": String(att.size),
    },
  });
});

export default app;
