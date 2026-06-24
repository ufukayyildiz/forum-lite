import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, or, and, gte, lt } from "drizzle-orm";
import { setCookie, deleteCookie } from "hono/cookie";
import { schema } from "../db";
import {
  hashPassword,
  verifyPassword,
  generateToken,
  generatePublicId,
  secureRandomInt,
  SESSION_COOKIE,
  SESSION_TTL_MS,
} from "../lib/auth";
import { requireAuth } from "../lib/middleware";
import { toPublicUser, type AppEnv } from "../types";
import type { DB } from "../db";
import { newPasswordEmail, sendEmail, welcomeEmail } from "../lib/email";

const app = new Hono<AppEnv>();

const registerSchema = z.object({
  username: z
    .string()
    .min(3, "Kullanıcı adı en az 3 karakter olmalı")
    .max(12, "Kullanıcı adı en fazla 12 karakter olabilir")
    .regex(/^[a-z0-9]+$/, "Sadece küçük harf ve rakam (a-z, 0-9)"),
  email: z.string().email("Geçerli bir e-posta girin"),
  password: z.string().min(8, "Şifre en az 8 karakter olmalı"),
  displayName: z.string().min(2).max(60).optional(),
});

const loginSchema = z.object({
  identifier: z.string().min(1, "Kullanıcı adı veya e-posta girin"),
  password: z.string().min(1, "Şifre girin"),
});

const resetPasswordSchema = z.object({
  email: z.string().email("Geçerli bir e-posta girin"),
});

const LOGIN_MAX = 10;
const LOGIN_WINDOW_SECS = 30;
const REGISTER_MAX = 5;
const REGISTER_WINDOW_SECS = 60 * 60;
const RESET_MAX = 3;
const RESET_WINDOW_SECS = 60 * 60;
const PUBLIC_ID_ATTEMPTS = 20;

function getClientIp(c: any): string {
  return (
    c.req.header("CF-Connecting-IP") ||
    c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

async function checkRateLimit(
  db: DB,
  ip: string,
  action: "login" | "register" | "reset_password",
  max: number,
  windowSecs: number,
): Promise<boolean> {
  const nowSecs = Math.floor(Date.now() / 1000);
  const windowStart = nowSecs - windowSecs;
  const pruneOlderThan = nowSecs - windowSecs * 2;

  await db
    .delete(schema.authAttempts)
    .where(lt(schema.authAttempts.createdAt, pruneOlderThan));

  const count = await db.$count(
    schema.authAttempts,
    and(
      eq(schema.authAttempts.ip, ip),
      eq(schema.authAttempts.action, action),
      gte(schema.authAttempts.createdAt, windowStart),
    ),
  );

  if (count >= max) return false;

  await db.insert(schema.authAttempts).values({ action, ip, createdAt: nowSecs });
  return true;
}

async function createUserPublicId(db: DB): Promise<string> {
  for (let attempt = 0; attempt < PUBLIC_ID_ATTEMPTS; attempt++) {
    const publicId = generatePublicId();
    const existing = await db.query.users.findFirst({
      where: eq(schema.users.publicId, publicId),
      columns: { id: true },
    });
    if (!existing) return publicId;
  }
  throw new Error("Could not allocate a unique user public_id");
}

export function generateTemporaryPassword(): string {
  const digits = Array.from({ length: 6 }, () => String(secureRandomInt(10))).join("");
  const upper = String.fromCharCode(65 + secureRandomInt(26));
  const lower = String.fromCharCode(97 + secureRandomInt(26));
  return `${digits}${upper}${lower}`;
}

function setSessionCookie(c: any, token: string) {
  const isHttps = new URL(c.req.url).protocol === "https:";
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    secure: isHttps,
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

app.post("/register", zValidator("json", registerSchema), async (c) => {
  const ip = getClientIp(c);
  const db = c.get("db");

  const allowed = await checkRateLimit(db, ip, "register", REGISTER_MAX, REGISTER_WINDOW_SECS);
  if (!allowed) {
    return c.json({ error: "Çok fazla kayıt denemesi. Lütfen daha sonra tekrar deneyin." }, 429);
  }

  const body = c.req.valid("json");
  const username = body.username.toLowerCase();
  const email = body.email.toLowerCase();

  const existing = await db.query.users.findFirst({
    where: or(eq(schema.users.username, username), eq(schema.users.email, email)),
  });
  if (existing) return c.json({ error: "Bu kullanıcı adı veya e-posta zaten kullanımda" }, 409);

  const passwordHash = await hashPassword(body.password);
  const publicId = await createUserPublicId(db);
  const [user] = await db
    .insert(schema.users)
    .values({
      publicId,
      username,
      email,
      passwordHash,
      displayName: body.displayName || username,
      role: "member",
    })
    .returning();

  const token = generateToken();
  await db.insert(schema.sessions).values({
    token,
    userId: user.id,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  setSessionCookie(c, token);

  // Welcome email — fire-and-forget, never blocks the response
  c.executionCtx.waitUntil((async () => {
    const settingRows: { key: string; value: string }[] = await db.select().from(schema.settings);
    const s: Record<string, string> = {};
    for (const r of settingRows) s[r.key] = r.value;
    const siteUrl = s["site_url"] || new URL(c.req.url).origin;
    const from = s["email_from"] || undefined;
    const welcome = welcomeEmail(user.username, siteUrl);
    await sendEmail(c.env, { to: user.email, ...welcome, from });
  })());

  return c.json({ user: toPublicUser(user) }, 201);
});

app.post("/login", zValidator("json", loginSchema), async (c) => {
  const ip = getClientIp(c);
  const db = c.get("db");

  const allowed = await checkRateLimit(db, ip, "login", LOGIN_MAX, LOGIN_WINDOW_SECS);
  if (!allowed) {
    return c.json({ error: "Çok fazla giriş denemesi. Lütfen 30 saniye sonra tekrar deneyin." }, 429);
  }

  const body = c.req.valid("json");
  const identifier = body.identifier.trim();
  const identifierLower = identifier.toLowerCase();

  const user = await db.query.users.findFirst({
    where: or(eq(schema.users.username, identifierLower), eq(schema.users.email, identifier), eq(schema.users.email, identifierLower)),
  });
  if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
    return c.json({ error: "Kullanıcı adı veya şifre hatalı" }, 401);
  }
  if (user.banned) return c.json({ error: "Hesabınız askıya alınmış" }, 403);

  const token = generateToken();
  await db.insert(schema.sessions).values({
    token,
    userId: user.id,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  setSessionCookie(c, token);
  return c.json({ user: toPublicUser(user) });
});

app.post("/reset-password", zValidator("json", resetPasswordSchema), async (c) => {
  const ip = getClientIp(c);
  const db = c.get("db");

  const allowed = await checkRateLimit(db, ip, "reset_password", RESET_MAX, RESET_WINDOW_SECS);
  if (!allowed) {
    return c.json({ error: "Çok fazla sıfırlama denemesi. Lütfen daha sonra tekrar deneyin." }, 429);
  }

  const { email } = c.req.valid("json");
  const normalizedEmail = email.trim().toLowerCase();
  const user = await db.query.users.findFirst({
    where: eq(schema.users.email, normalizedEmail),
  });

  if (user && !user.banned) {
    const settingRows: { key: string; value: string }[] = await db.select().from(schema.settings);
    const s: Record<string, string> = {};
    for (const r of settingRows) s[r.key] = r.value;

    const siteUrl = s["site_url"] || new URL(c.req.url).origin;
    const from = s["email_from"] || "noreply@devfox.net";
    const nextPassword = generateTemporaryPassword();
    const mail = newPasswordEmail(user.username, nextPassword, siteUrl);
    const sent = await sendEmail(c.env, { to: user.email, ...mail, from });

    if (sent) {
      await db
        .update(schema.users)
        .set({ passwordHash: await hashPassword(nextPassword) })
        .where(eq(schema.users.id, user.id));
      await db.delete(schema.sessions).where(eq(schema.sessions.userId, user.id));
    }
  }

  return c.json({ ok: true, message: "E-posta sistemde kayıtlıysa yeni şifre gönderildi." });
});

app.post("/logout", async (c) => {
  const token = c.req.header("cookie")?.match(/forum_session=([^;]+)/)?.[1];
  if (token) {
    await c.get("db").delete(schema.sessions).where(eq(schema.sessions.token, token));
  }
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

app.get("/me", requireAuth, async (c) => {
  return c.json({ user: toPublicUser(c.get("user")!) });
});

export default app;
