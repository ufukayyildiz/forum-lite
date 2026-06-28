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
import { accountCreatedPasswordEmail, newPasswordEmail } from "../lib/email";
import { notifyAdminLogin } from "../lib/admin-alerts";
import { isEmailSuppressed, normalizeEmailAddress } from "../lib/email-suppression";
import { loadEmailSettings, sendManagedEmail } from "../lib/notifications";

const app = new Hono<AppEnv>();

const registerSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(12, "Username can be at most 12 characters")
    .regex(/^[a-z0-9]+$/, "Use lowercase letters and numbers only (a-z, 0-9)"),
  email: z.string().email("Enter a valid email address"),
  displayName: z.string().min(2).max(60).optional(),
});

const loginSchema = z.object({
  identifier: z.string().min(1, "Enter your username or email"),
  password: z.string().min(1, "Enter your password"),
});

const resetPasswordSchema = z.object({
  email: z.string().email("Enter a valid email address"),
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

async function loadSettingsMap(db: DB): Promise<Record<string, string>> {
  const settingRows: { key: string; value: string }[] = await db.select().from(schema.settings);
  const settings: Record<string, string> = {};
  for (const row of settingRows) settings[row.key] = row.value;
  return settings;
}

async function findExistingUserIdentity(db: DB, username: string, email?: string) {
  return db.query.users.findFirst({
    where: email
      ? or(eq(schema.users.username, username), eq(schema.users.email, email))
      : eq(schema.users.username, username),
    columns: { id: true, username: true, email: true },
  });
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

app.get("/availability", async (c) => {
  const db = c.get("db");
  const username = (c.req.query("username") ?? "").trim().toLowerCase();
  const email = c.req.query("email") ? normalizeEmailAddress(c.req.query("email") ?? "") : "";

  const usernameValid = username.length >= 3 && username.length <= 12 && /^[a-z0-9]+$/.test(username);
  const emailValid = !email || z.string().email().safeParse(email).success;

  const existing = usernameValid
    ? await findExistingUserIdentity(db, username, emailValid && email ? email : undefined)
    : null;
  const suppressed = emailValid && email ? await isEmailSuppressed(db, email) : false;

  return c.json({
    usernameAvailable: usernameValid ? !existing || existing.username !== username : false,
    emailAvailable: email && emailValid ? !existing || existing.email !== email : true,
    emailSuppressed: suppressed,
  });
});

app.post("/register", zValidator("json", registerSchema), async (c) => {
  const ip = getClientIp(c);
  const db = c.get("db");

  const allowed = await checkRateLimit(db, ip, "register", REGISTER_MAX, REGISTER_WINDOW_SECS);
  if (!allowed) {
    return c.json({ error: "Too many registration attempts. Please try again later." }, 429);
  }

  const body = c.req.valid("json");
  const username = body.username.trim().toLowerCase();
  const email = normalizeEmailAddress(body.email);

  const existing = await findExistingUserIdentity(db, username, email);
  if (existing?.username === username) return c.json({ error: "That username is already in use" }, 409);
  if (existing?.email === email) return c.json({ error: "That email is already in use" }, 409);
  if (await isEmailSuppressed(db, email)) {
    return c.json({ error: "That email cannot receive forum emails. Use another email address." }, 409);
  }

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
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

  const emailSettings = await loadEmailSettings(db, c.req.url);
  const { siteUrl, from, provider, sesRegion, sesTransport, sesPort } = emailSettings;
  const mail = accountCreatedPasswordEmail(user.username, temporaryPassword, siteUrl);
  const sent = await sendManagedEmail({
    db,
    env: c.env,
    user,
    kind: "account",
    ...mail,
    siteUrl,
    from,
    provider,
    sesRegion,
    sesTransport,
    sesPort,
    relatedType: "user",
    relatedId: user.id,
    ignorePreferences: true,
    waitUntil: c.executionCtx.waitUntil.bind(c.executionCtx),
  });

  if (sent.status !== "sent") {
    await db.delete(schema.users).where(eq(schema.users.id, user.id));
    if (sent.status === "suppressed") {
      return c.json({ error: "That email is suppressed and cannot receive forum emails." }, 409);
    }
    return c.json({ error: "Could not send the account password email. Please try again later." }, 502);
  }

  await db.insert(schema.activityLog).values({
    userId: user.id,
    type: "register",
    summary: `Created account ${user.username}; password email sent`,
  });

  return c.json({ ok: true, message: "Account created. Your password has been emailed." }, 201);
});

app.post("/login", zValidator("json", loginSchema), async (c) => {
  const ip = getClientIp(c);
  const db = c.get("db");

  const allowed = await checkRateLimit(db, ip, "login", LOGIN_MAX, LOGIN_WINDOW_SECS);
  if (!allowed) {
    return c.json({ error: "Too many login attempts. Please try again in 30 seconds." }, 429);
  }

  const body = c.req.valid("json");
  const identifier = body.identifier.trim();
  const identifierLower = identifier.toLowerCase();

  const user = await db.query.users.findFirst({
    where: or(eq(schema.users.username, identifierLower), eq(schema.users.email, identifier), eq(schema.users.email, identifierLower)),
  });
  if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
    return c.json({ error: "Invalid username or password" }, 401);
  }
  if (user.banned) return c.json({ error: "Your account has been suspended" }, 403);

  const now = new Date();
  await db
    .update(schema.users)
    .set({
      lastLoginAt: now,
      emailVerifiedAt: user.emailVerifiedAt ?? now,
    })
    .where(eq(schema.users.id, user.id));

  const token = generateToken();
  await db.insert(schema.sessions).values({
    token,
    userId: user.id,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  setSessionCookie(c, token);
  notifyAdminLogin(db, c.env, c.executionCtx, c.req.url, {
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    ip,
    country: c.req.header("CF-IPCountry") ?? "",
    userAgent: c.req.header("user-agent") ?? "",
  });
  return c.json({ user: toPublicUser(user) });
});

app.post("/reset-password", zValidator("json", resetPasswordSchema), async (c) => {
  const ip = getClientIp(c);
  const db = c.get("db");

  const allowed = await checkRateLimit(db, ip, "reset_password", RESET_MAX, RESET_WINDOW_SECS);
  if (!allowed) {
    return c.json({ error: "Too many password reset attempts. Please try again later." }, 429);
  }

  const { email } = c.req.valid("json");
  const normalizedEmail = email.trim().toLowerCase();
  const user = await db.query.users.findFirst({
    where: eq(schema.users.email, normalizedEmail),
  });

  if (user && !user.banned) {
    if (await isEmailSuppressed(db, normalizedEmail)) {
      return c.json({ ok: true, message: "If that email exists, a new password has been sent." });
    }

    const emailSettings = await loadEmailSettings(db, c.req.url);
    const { siteUrl, from, provider, sesRegion, sesTransport, sesPort } = emailSettings;
    const nextPassword = generateTemporaryPassword();
    const mail = newPasswordEmail(user.username, nextPassword, siteUrl);
    const sent = await sendManagedEmail({
      db,
      env: c.env,
      user,
      kind: "account",
      ...mail,
      siteUrl,
      from,
      provider,
      sesRegion,
      sesTransport,
      sesPort,
      relatedType: "user",
      relatedId: user.id,
      ignorePreferences: true,
      waitUntil: c.executionCtx.waitUntil.bind(c.executionCtx),
    });

    if (sent.status === "sent") {
      await db
        .update(schema.users)
        .set({ passwordHash: await hashPassword(nextPassword) })
        .where(eq(schema.users.id, user.id));
      await db.delete(schema.sessions).where(eq(schema.sessions.userId, user.id));
    }
  }

  return c.json({ ok: true, message: "If that email exists, a new password has been sent." });
});

app.post("/logout", async (c) => {
  const token = c.req.header("cookie")?.match(/forum_session=([^;]+)/)?.[1];
  if (token) {
    await c.get("db").delete(schema.sessions).where(eq(schema.sessions.token, token));
  }
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

app.get("/me", async (c) => {
  const user = c.get("user");
  return c.json({ user: user ? toPublicUser(user) : null });
});

export default app;
