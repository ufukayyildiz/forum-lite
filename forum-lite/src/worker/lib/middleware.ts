import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../db";
import { SESSION_COOKIE } from "./auth";
import type { AppEnv } from "../types";

export const withDb: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("db", getDb(c.env));
  await next();
};

export const loadUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("user", null);
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    const db = c.get("db");
    const session = await db.query.sessions.findFirst({
      where: eq(schema.sessions.token, token),
    });
    if (session) {
      const exp = session.expiresAt;
      const expMs = exp instanceof Date ? exp.getTime() : typeof exp === "number" ? (exp > 1e10 ? exp : exp * 1000) : 0;
      if (expMs > Date.now()) {
        const user = await db.query.users.findFirst({ where: eq(schema.users.id, session.userId) });
        if (user && !user.banned) c.set("user", user);
      }
    }
  }
  await next();
};

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get("user")) return c.json({ error: "Giriş yapmanız gerekiyor" }, 401);
  await next();
};

export function requireRole(...roles: Array<"admin" | "moderator">): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Giriş yapmanız gerekiyor" }, 401);
    if (!roles.includes(user.role as "admin" | "moderator")) {
      return c.json({ error: "Bu işlem için yetkiniz yok" }, 403);
    }
    await next();
  };
}
