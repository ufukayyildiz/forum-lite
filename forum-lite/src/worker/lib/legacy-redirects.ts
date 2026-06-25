import type { Context } from "hono";
import type { Bindings, Variables } from "../types";

type AppContext = Context<{ Bindings: Bindings; Variables: Variables }>;

type LegacyRoute =
  | { kind: "thread"; slug?: string; oldId?: number }
  | { kind: "category"; slug?: string; oldId?: number };

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function pathParts(pathname: string): string[] {
  return pathname
    .split("/")
    .filter(Boolean)
    .map((part) => safeDecode(part).trim().toLowerCase())
    .filter(Boolean);
}

function numericId(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

function legacyTopicPublicId(oldId: number): string {
  return String(100_000 + ((oldId * 48_271 + 12_345) % 900_000)).padStart(6, "0");
}

function legacyCategoryPublicId(oldId: number): string {
  return String(1_000 + ((oldId * 7_919 + 1_013) % 9_000)).padStart(4, "0");
}

function parseLegacyRoute(pathname: string): LegacyRoute | null {
  const parts = pathParts(pathname);
  if (parts[0] === "t") {
    if (parts.length === 2 && !numericId(parts[1])) return { kind: "thread", slug: parts[1] };
    if (parts.length >= 3) {
      const oldId = numericId(parts[2]);
      if (oldId && !numericId(parts[1])) return { kind: "thread", slug: parts[1], oldId };
    }
    return null;
  }

  if (parts[0] === "c") {
    if (parts.length === 2 && !numericId(parts[1])) return { kind: "category", slug: parts[1] };
    if (parts.length >= 3) {
      const oldId = numericId(parts[parts.length - 1]);
      const slug = [...parts].reverse().find((part) => !numericId(part));
      if (oldId && slug && slug !== "c") return { kind: "category", slug, oldId };
    }
  }

  return null;
}

async function findThreadPublicId(c: AppContext, route: Extract<LegacyRoute, { kind: "thread" }>): Promise<string | null> {
  if (route.slug) {
    const row = await c.env.DB.prepare("SELECT public_id AS publicId FROM threads WHERE slug = ? ORDER BY id LIMIT 1")
      .bind(route.slug)
      .first<{ publicId: string }>();
    if (row?.publicId) return row.publicId;
  }

  if (route.oldId) {
    const candidate = legacyTopicPublicId(route.oldId);
    const row = await c.env.DB.prepare("SELECT public_id AS publicId FROM threads WHERE public_id = ? LIMIT 1")
      .bind(candidate)
      .first<{ publicId: string }>();
    if (row?.publicId) return row.publicId;
  }

  return null;
}

async function findCategoryPublicId(c: AppContext, route: Extract<LegacyRoute, { kind: "category" }>): Promise<string | null> {
  if (route.slug) {
    const row = await c.env.DB.prepare("SELECT public_id AS publicId FROM categories WHERE slug = ? LIMIT 1")
      .bind(route.slug)
      .first<{ publicId: string }>();
    if (row?.publicId) return row.publicId;
  }

  if (route.oldId) {
    const candidate = legacyCategoryPublicId(route.oldId);
    const row = await c.env.DB.prepare("SELECT public_id AS publicId FROM categories WHERE public_id = ? LIMIT 1")
      .bind(candidate)
      .first<{ publicId: string }>();
    if (row?.publicId) return row.publicId;
  }

  return null;
}

export async function legacyCanonicalRedirect(c: AppContext): Promise<Response | null> {
  const url = new URL(c.req.url);
  const route = parseLegacyRoute(url.pathname);
  if (!route) return null;

  const publicId =
    route.kind === "thread" ? await findThreadPublicId(c, route) : await findCategoryPublicId(c, route);
  if (!publicId) return null;

  const targetPath = route.kind === "thread" ? `/t/${publicId}` : `/c/${publicId}`;
  if (url.pathname === targetPath) return null;

  const target = new URL(targetPath, url.origin);
  return c.redirect(target.toString(), 301);
}
