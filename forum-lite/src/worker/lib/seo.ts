import type { Context } from "hono";
import type { Bindings, Variables } from "../types";
import {
  WHAT_IS_FSTDESK_DESCRIPTION,
  WHAT_IS_FSTDESK_FAQS,
  WHAT_IS_FSTDESK_KEYWORDS,
  WHAT_IS_FSTDESK_PATH,
  WHAT_IS_FSTDESK_PUBLISHED,
  WHAT_IS_FSTDESK_SECTIONS,
  WHAT_IS_FSTDESK_TITLE,
  WHAT_IS_FSTDESK_TOPIC_EXAMPLES,
} from "../../shared/what-is-fstdesk";

type AppContext = Context<{ Bindings: Bindings; Variables: Variables }>;

type SeoSchema = Record<string, unknown>;

type SeoPayload = {
  title: string;
  description: string;
  canonicalPath: string;
  type?: "website" | "article" | "profile";
  robots?: string;
  status?: number;
  imagePath?: string;
  imageAlt?: string;
  articlePublishedTime?: string;
  articleModifiedTime?: string;
  articleSection?: string;
  articleTags?: string[];
  schemas?: SeoSchema[];
  contentHtml?: string;
};

type SeoContentRow = {
  title: string;
  path: string;
  text?: string;
};

type SeoAnchorLink = {
  id: number;
  term: string;
  title: string;
  url: string;
};

type PreparedSeoAnchorGroup = {
  key: string;
  term: string;
  pattern: RegExp;
  links: SeoAnchorLink[];
};

type BootstrapQuery = {
  key: unknown[];
  data: unknown;
  updatedAt?: number;
};

type BootstrapPayload = {
  queries: BootstrapQuery[];
};

type ApiCategory = {
  id: number;
  publicId: string;
  name: string;
  slug: string;
  description: string | null;
  color: string;
  icon: string;
  position: number;
  createdAt: string;
  threadCount: number;
  postCount: number;
};

type BootstrapBuild = {
  payload: BootstrapPayload;
  categories: ApiCategory[];
};

const SITE_NAME = "FSTDESK";
const SITE_TAGLINE = "Food Science and Technology Desk";
const SITE_DESCRIPTION = `${SITE_TAGLINE} for food science, food safety, product development and food technology discussions.`;
const HTML_LANG = "en";
const CONTENT_LANGUAGE = "en-US";
const OG_LOCALE = "en_US";
const DEFAULT_IMAGE = "/og/default.webp";
const CAT_COLORS = ["#b8bb26", "#83a598", "#fabd2f", "#d3869b", "#8ec07c", "#fe8019", "#fb4934", "#a89984"];
const MAX_SEO_ANCHOR_TERMS = 80;
const MAX_SEO_ANCHOR_TARGETS_PER_TERM = 20;
const MAX_SEO_ANCHORS_PER_BLOCK = 16;
const MEMBERS_SEO_LIMIT = 120;
const MEMBERS_BOOTSTRAP_PAGE_SIZE = 200;

function cleanText(input: unknown, max = 160): string {
  const text = String(input ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[`*_>#|~=]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1)).trim()}…` : text;
}

function escapeHtml(input: unknown): string {
  return String(input ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeJsonLd(schema: SeoSchema): string {
  return JSON.stringify(schema).replace(/</g, "\\u003c");
}

function escapeJsonScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function fullSeoTitle(title: string): string {
  const cleaned = String(title ?? "").trim();
  if (!cleaned || cleaned === SITE_NAME) return SITE_NAME;
  return cleaned.endsWith(`— ${SITE_NAME}`) ? cleaned : `${cleaned} — ${SITE_NAME}`;
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function absoluteUrl(base: string, path: string): string {
  return new URL(path || "/", base).toString();
}

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function isSafeSeoAnchorUrl(url: string): boolean {
  if (url.startsWith("/") && !url.startsWith("//")) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeAnchorPath(url: string | undefined): string {
  if (!url) return "";
  try {
    if (url.startsWith("/") && !url.startsWith("//")) {
      const path = url.split("#")[0].split("?")[0];
      return path.length > 1 ? path.replace(/\/+$/, "") : path;
    }
    const parsed = new URL(url);
    return parsed.pathname.length > 1 ? parsed.pathname.replace(/\/+$/, "") : parsed.pathname;
  } catch {
    return "";
  }
}

function anchorTermPattern(term: string): RegExp {
  return new RegExp(`(^|[^A-Za-z0-9])(${escapeRegExp(term).replace(/\s+/g, "\\s+")})(?=$|[^A-Za-z0-9])`, "i");
}

function prepareSeoAnchorGroups(links: SeoAnchorLink[], currentPath?: string): PreparedSeoAnchorGroup[] {
  const seen = new Set<string>();
  const current = normalizeAnchorPath(currentPath);
  const prepared = links
    .map((link) => ({
      id: Number(link.id) || 0,
      term: String(link.term ?? "").trim(),
      title: String(link.title ?? "").trim(),
      url: String(link.url ?? "").trim(),
    }))
    .filter((link) => link.term.length >= 3 && isSafeSeoAnchorUrl(link.url))
    .filter((link) => normalizeAnchorPath(link.url) !== current)
    .filter((link) => {
      const key = `${link.term.toLowerCase()}:${link.url}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.term.length - a.term.length || a.term.localeCompare(b.term));

  const groups = new Map<string, SeoAnchorLink[]>();
  for (const link of prepared) {
    const key = link.term.toLowerCase();
    const bucket = groups.get(key) ?? [];
    if (bucket.length < MAX_SEO_ANCHOR_TARGETS_PER_TERM) {
      bucket.push(link);
      groups.set(key, bucket);
    }
  }

  return Array.from(groups.entries())
    .map(([key, bucket]) => ({
      key,
      term: bucket[0].term,
      pattern: anchorTermPattern(bucket[0].term),
      links: bucket,
    }))
    .sort((a, b) => b.term.length - a.term.length || a.term.localeCompare(b.term))
    .slice(0, MAX_SEO_ANCHOR_TERMS);
}

function linkSeoTextChunk(text: string, groups: PreparedSeoAnchorGroup[], usedTerms: Set<string>): string {
  let remaining = text;
  let out = "";

  while (remaining && usedTerms.size < MAX_SEO_ANCHORS_PER_BLOCK) {
    let best: { group: PreparedSeoAnchorGroup; start: number; end: number; text: string } | null = null;

    for (const group of groups) {
      if (usedTerms.has(group.key)) continue;
      const match = group.pattern.exec(remaining);
      if (!match) continue;
      const start = match.index + match[1].length;
      const end = start + match[2].length;
      if (!best || start < best.start || (start === best.start && match[2].length > best.text.length)) {
        best = { group, start, end, text: match[2] };
      }
    }

    if (!best) {
      out += escapeHtml(remaining);
      remaining = "";
      break;
    }

    usedTerms.add(best.group.key);
    const candidates = best.group.links;
    const link = candidates[hashString(`${text}:${best.text}:${best.start}`) % candidates.length];
    out += escapeHtml(remaining.slice(0, best.start));
    out += `<a class="gb-internal-anchor" href="${escapeHtml(link.url)}" title="${escapeHtml(link.title || link.term)}">${escapeHtml(best.text)}</a>`;
    remaining = remaining.slice(best.end);
  }

  if (remaining) out += escapeHtml(remaining);
  return out;
}

function seoTextHtml(input: string | undefined, groups: PreparedSeoAnchorGroup[], usedTerms: Set<string>): string {
  const text = String(input ?? "");
  if (!text) return "";
  if (!groups.length) return escapeHtml(text);
  return linkSeoTextChunk(text, groups, usedTerms);
}

function stripInlineMarkdown(input: string): string {
  return input
    .replace(/!\[([^\]]*)]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1");
}

function normalizeSeoBody(input: unknown): string {
  return String(input ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|blockquote|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function seoInlineTextHtml(input: string, groups: PreparedSeoAnchorGroup[], usedTerms: Set<string>): string {
  return seoTextHtml(stripInlineMarkdown(input).trim(), groups, usedTerms);
}

function seoParagraphHtml(input: string, groups: PreparedSeoAnchorGroup[], usedTerms: Set<string>): string {
  const lines = input
    .split(/\n+/)
    .map((line) => seoInlineTextHtml(line, groups, usedTerms))
    .filter(Boolean);
  return lines.length ? `<p>${lines.join("<br />\n")}</p>` : "";
}

function seoListHtml(lines: string[], ordered: boolean, groups: PreparedSeoAnchorGroup[], usedTerms: Set<string>): string {
  const tag = ordered ? "ol" : "ul";
  const items = lines
    .map((line) => {
      const text = ordered ? line.replace(/^\d+[.)]\s+/, "") : line.replace(/^[-*+]\s+/, "");
      const html = seoInlineTextHtml(text, groups, usedTerms);
      return html ? `<li>${html}</li>` : "";
    })
    .filter(Boolean)
    .join("\n");
  return items ? `<${tag}>${items}</${tag}>` : "";
}

function seoRichTextHtml(input: unknown, groups: PreparedSeoAnchorGroup[], usedTerms: Set<string>): string {
  const source = normalizeSeoBody(input);
  if (!source) return "";

  return source
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean);
      if (!lines.length) return "";

      if (lines.every((line) => /^>\s?/.test(line))) {
        const quoted = lines.map((line) => line.replace(/^>\s?/, "")).join("\n");
        const html = seoParagraphHtml(quoted, groups, usedTerms);
        return html ? `<blockquote>${html}</blockquote>` : "";
      }

      if (lines.every((line) => /^[-*+]\s+/.test(line))) {
        return seoListHtml(lines, false, groups, usedTerms);
      }

      if (lines.every((line) => /^\d+[.)]\s+/.test(line))) {
        return seoListHtml(lines, true, groups, usedTerms);
      }

      const heading = lines.length === 1 ? /^#{1,3}\s+(.+)/.exec(lines[0]) : null;
      if (heading) {
        const html = seoInlineTextHtml(heading[1], groups, usedTerms);
        return html ? `<h2>${html}</h2>` : "";
      }

      return seoParagraphHtml(lines.join("\n"), groups, usedTerms);
    })
    .filter(Boolean)
    .join("\n");
}

function isoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") {
    const ms = value > 1e10 ? value : value * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
  }
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n) && value.trim() !== "") return isoDate(n);
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
  }
  return new Date(0).toISOString();
}

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

function newestIsoDate(...values: unknown[]): string {
  let newest: unknown = values[0];
  let newestMs = dateMs(newest);
  for (const value of values.slice(1)) {
    const ms = dateMs(value);
    if (!Number.isNaN(ms) && (Number.isNaN(newestMs) || ms > newestMs)) {
      newest = value;
      newestMs = ms;
    }
  }
  return isoDate(newest);
}

function numericId(value: string): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : -1;
}

function positivePage(value: unknown): number {
  const page = Number(value ?? 1);
  return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
}

function apiDate(value: unknown): string {
  return isoDate(value);
}

function apiCategoryPath(category: Pick<ApiCategory, "publicId" | "slug" | "id">): string {
  return `/c/${category.publicId || category.slug || category.id}`;
}

function apiThreadPath(thread: { publicId?: unknown; slug?: unknown; id?: unknown }): string {
  return `/t/${thread.publicId || thread.slug || thread.id}`;
}

async function loadStatsApi(c: AppContext) {
  const stats = await c.env.DB.prepare(
    "SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM threads) AS threads, (SELECT COUNT(*) FROM posts) AS posts",
  ).first<Record<string, unknown>>();
  return {
    users: Number(stats?.users ?? 0),
    threads: Number(stats?.threads ?? 0),
    posts: Number(stats?.posts ?? 0),
  };
}

async function loadCategoriesApi(c: AppContext): Promise<ApiCategory[]> {
  const [rows, counts] = await Promise.all([
    c.env.DB.prepare("SELECT id, public_id AS publicId, name, slug, description, color, icon, position, created_at AS createdAt FROM categories ORDER BY position, id")
      .all<Record<string, unknown>>(),
    c.env.DB.prepare(
      `SELECT category_id AS categoryId, COUNT(*) AS threadCount, COALESCE(SUM(reply_count), 0) + COUNT(*) AS postCount
       FROM threads
       GROUP BY category_id`,
    ).all<Record<string, unknown>>(),
  ]);
  const countMap = new Map((counts.results ?? []).map((row) => [Number(row.categoryId), row]));
  return (rows.results ?? []).map((cat) => {
    const count = countMap.get(Number(cat.id));
    return {
      id: Number(cat.id),
      publicId: String(cat.publicId ?? ""),
      name: String(cat.name ?? ""),
      slug: String(cat.slug ?? ""),
      description: cat.description == null ? null : String(cat.description),
      color: String(cat.color ?? "#b8bb26"),
      icon: String(cat.icon ?? "Hash"),
      position: Number(cat.position ?? 0),
      createdAt: apiDate(cat.createdAt),
      threadCount: Number(count?.threadCount ?? 0),
      postCount: Number(count?.postCount ?? 0),
    };
  });
}

async function loadSeoAnchors(c: AppContext): Promise<SeoAnchorLink[]> {
  try {
    const rows = await c.env.DB.prepare(
      `SELECT id, term, url, title
       FROM anchor_links
       WHERE enabled = 1
       ORDER BY length(term) DESC, click_count DESC, term
       LIMIT 500`,
    ).all<Record<string, unknown>>();
    return (rows.results ?? [])
      .map((row) => ({
        id: Number(row.id ?? 0),
        term: String(row.term ?? ""),
        url: String(row.url ?? ""),
        title: String(row.title ?? ""),
      }))
      .filter((row) => row.id > 0 && row.term.trim().length >= 3 && isSafeSeoAnchorUrl(row.url.trim()));
  } catch (error) {
    console.warn("seo_anchors_unavailable", error instanceof Error ? error.message : error);
    return [];
  }
}

async function loadCategoryApi(c: AppContext, id: string): Promise<ApiCategory | null> {
  const category = await c.env.DB.prepare(
    "SELECT id, public_id AS publicId, name, slug, description, color, icon, position, created_at AS createdAt FROM categories WHERE public_id = ? OR id = ? OR slug = ? LIMIT 1",
  )
    .bind(id, numericId(id), id)
    .first<Record<string, unknown>>();
  if (!category) return null;

  const count = await c.env.DB.prepare(
    "SELECT COUNT(*) AS threadCount, COALESCE(SUM(reply_count), 0) + COUNT(*) AS postCount FROM threads WHERE category_id = ?",
  )
    .bind(Number(category.id))
    .first<Record<string, unknown>>();

  return {
    id: Number(category.id),
    publicId: String(category.publicId ?? ""),
    name: String(category.name ?? ""),
    slug: String(category.slug ?? ""),
    description: category.description == null ? null : String(category.description),
    color: String(category.color ?? "#b8bb26"),
    icon: String(category.icon ?? "Hash"),
    position: Number(category.position ?? 0),
    createdAt: apiDate(category.createdAt),
    threadCount: Number(count?.threadCount ?? 0),
    postCount: Number(count?.postCount ?? 0),
  };
}

function mapThreadApi(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    publicId: String(row.publicId ?? ""),
    title: String(row.title ?? ""),
    slug: String(row.slug ?? ""),
    pinned: !!row.pinned,
    locked: !!row.locked,
    featured: !!row.featured,
    views: Number(row.views ?? 0),
    replyCount: Number(row.replyCount ?? 0),
    createdAt: apiDate(row.createdAt),
    updatedAt: apiDate(row.updatedAt),
    lastPostAt: apiDate(row.lastPostAt),
    category: {
      id: Number(row.categoryId),
      publicId: String(row.categoryPublicId ?? ""),
      name: String(row.categoryName ?? ""),
      slug: String(row.categorySlug ?? ""),
      color: String(row.categoryColor ?? "#b8bb26"),
    },
    author: {
      id: Number(row.authorId),
      publicId: String(row.authorPublicId ?? ""),
      username: String(row.authorUsername ?? ""),
      displayName: String(row.authorDisplayName ?? ""),
      avatarUrl: row.authorAvatar == null ? null : String(row.authorAvatar),
      role: String(row.authorRole ?? "member"),
    },
    tags: [],
  };
}

async function loadThreadsApi(c: AppContext, opts: { categoryId?: number; sort?: string; page?: number; all?: boolean } = {}) {
  const sort = opts.sort ?? "recent";
  const page = positivePage(opts.page);
  const where = opts.categoryId ? "WHERE t.category_id = ?" : "";
  const orderBy =
    sort === "popular"
      ? "ORDER BY t.pinned DESC, t.views DESC"
      : sort === "replies"
        ? "ORDER BY t.pinned DESC, t.reply_count DESC"
        : "ORDER BY t.pinned DESC, t.last_post_at DESC";
  const totalRow = await c.env.DB.prepare(`SELECT COUNT(*) AS total FROM threads t ${where}`)
    .bind(...(opts.categoryId ? [opts.categoryId] : []))
    .first<Record<string, unknown>>();
  const total = Number(totalRow?.total ?? 0);
  const perPage = opts.all ? Math.max(total, 1) : 20;
  const offset = opts.all ? 0 : (page - 1) * perPage;
  const rows = await c.env.DB.prepare(
    `SELECT t.id, t.public_id AS publicId, t.title, t.slug, t.pinned, t.locked, t.featured,
      t.views, t.reply_count AS replyCount, t.created_at AS createdAt, t.updated_at AS updatedAt, t.last_post_at AS lastPostAt,
      c.id AS categoryId, c.public_id AS categoryPublicId, c.name AS categoryName, c.slug AS categorySlug, c.color AS categoryColor,
      u.id AS authorId, u.public_id AS authorPublicId, u.username AS authorUsername, u.display_name AS authorDisplayName,
      u.avatar_url AS authorAvatar, u.role AS authorRole
     FROM threads t
     INNER JOIN categories c ON c.id = t.category_id
     INNER JOIN users u ON u.id = t.user_id
     ${where}
     ${orderBy}
     LIMIT ? OFFSET ?`,
  )
    .bind(...(opts.categoryId ? [opts.categoryId] : []), perPage, offset)
    .all<Record<string, unknown>>();

  return {
    threads: (rows.results ?? []).map(mapThreadApi),
    total,
    page: opts.all ? 1 : page,
    perPage,
  };
}

async function loadThreadApi(c: AppContext, id: string) {
  const thread = await c.env.DB.prepare(
    `SELECT t.id, t.public_id AS publicId, t.title, t.slug, t.content, t.pinned, t.locked, t.featured,
      t.views, t.reply_count AS replyCount, t.created_at AS createdAt, t.updated_at AS updatedAt, t.last_post_at AS lastPostAt,
      c.id AS categoryId, c.public_id AS categoryPublicId, c.name AS categoryName, c.slug AS categorySlug, c.color AS categoryColor,
      u.id AS authorId, u.public_id AS authorPublicId, u.username AS authorUsername, u.display_name AS authorDisplayName,
      u.avatar_url AS authorAvatar, u.role AS authorRole
     FROM threads t
     INNER JOIN categories c ON c.id = t.category_id
     INNER JOIN users u ON u.id = t.user_id
     WHERE t.public_id = ? OR t.id = ? OR printf('%012d', 100000000000 + ((t.id * 982451653 + 57885161) % 900000000000)) = ?
     LIMIT 1`,
  )
    .bind(id, numericId(id), id)
    .first<Record<string, unknown>>();
  if (!thread) return null;

  const tagRows = await c.env.DB.prepare(
    `SELECT tags.id, tags.name, tags.slug
     FROM tags
     INNER JOIN thread_tags tt ON tt.tag_id = tags.id
     WHERE tt.thread_id = ?
     ORDER BY tags.name`,
  )
    .bind(Number(thread.id))
    .all<Record<string, unknown>>();

  const tags = (tagRows.results ?? []).map((tag) => ({
    id: Number(tag.id),
    name: String(tag.name ?? ""),
    slug: String(tag.slug ?? ""),
  }));
  return {
    ...mapThreadApi(thread),
    content: String(thread.content ?? ""),
    tags,
  };
}

async function loadPostsApi(c: AppContext, threadId: number, opts: { page?: number; all?: boolean } = {}) {
  const page = Math.max(1, opts.page ?? 1);
  const total = await c.env.DB.prepare("SELECT COUNT(*) AS total FROM posts WHERE thread_id = ?")
    .bind(threadId)
    .first<Record<string, unknown>>();
  const totalCount = Number(total?.total ?? 0);
  const perPage = opts.all ? Math.max(totalCount, 1) : 20;
  const offset = opts.all ? 0 : (page - 1) * perPage;
  const rows = await c.env.DB.prepare(
    `SELECT p.id, p.content, p.like_count AS likeCount, p.edited_at AS editedAt, p.created_at AS createdAt,
      u.id AS authorId, u.username AS authorUsername, u.display_name AS authorDisplayName, u.avatar_url AS authorAvatar,
      u.role AS authorRole, u.post_count AS authorPostCount, u.thread_count AS authorThreadCount,
      u.created_at AS authorCreatedAt, u.bio AS authorBio
     FROM posts p
     INNER JOIN users u ON u.id = p.user_id
     WHERE p.thread_id = ?
     ORDER BY p.created_at ASC
     LIMIT ? OFFSET ?`,
  )
    .bind(threadId, perPage, offset)
    .all<Record<string, unknown>>();

  return {
    posts: (rows.results ?? []).map((post) => ({
      id: Number(post.id),
      content: String(post.content ?? ""),
      likeCount: Number(post.likeCount ?? 0),
      likedByMe: false,
      editedAt: post.editedAt == null ? null : apiDate(post.editedAt),
      createdAt: apiDate(post.createdAt),
      author: {
        id: Number(post.authorId),
        username: String(post.authorUsername ?? ""),
        displayName: String(post.authorDisplayName ?? ""),
        avatarUrl: post.authorAvatar == null ? null : String(post.authorAvatar),
        role: String(post.authorRole ?? "member"),
        postCount: Number(post.authorPostCount ?? 0),
        threadCount: Number(post.authorThreadCount ?? 0),
        createdAt: apiDate(post.authorCreatedAt),
        bio: post.authorBio == null ? null : String(post.authorBio),
      },
    })),
    total: totalCount,
    page: opts.all ? 1 : page,
    perPage,
  };
}

async function loadMembersApi(c: AppContext, sort = "posts", page = 1, perPage = MEMBERS_BOOTSTRAP_PAGE_SIZE) {
  const safePage = Math.max(1, Math.floor(page));
  const safePerPage = Math.max(1, Math.min(200, Math.floor(perPage)));
  const orderBy =
    sort === "newest"
      ? "ORDER BY created_at DESC"
      : sort === "threads"
        ? "ORDER BY thread_count DESC, id DESC"
        : "ORDER BY post_count DESC, id DESC";
  const total = await c.env.DB.prepare("SELECT COUNT(*) AS total FROM users").first<Record<string, unknown>>();
  const rows = await c.env.DB.prepare(
    `SELECT id, public_id AS publicId, username, display_name AS displayName, avatar_url AS avatarUrl, bio, role,
      banned, post_count AS postCount, thread_count AS threadCount, created_at AS createdAt
     FROM users
     ${orderBy}
     LIMIT ? OFFSET ?`,
  ).bind(safePerPage, (safePage - 1) * safePerPage).all<Record<string, unknown>>();

  return {
    members: (rows.results ?? []).map((user) => ({
      id: Number(user.id),
      publicId: String(user.publicId ?? ""),
      username: String(user.username ?? ""),
      displayName: String(user.displayName ?? ""),
      avatarUrl: user.avatarUrl == null ? null : String(user.avatarUrl),
      bio: user.bio == null ? null : String(user.bio),
      role: String(user.role ?? "member"),
      banned: !!user.banned,
      postCount: Number(user.postCount ?? 0),
      threadCount: Number(user.threadCount ?? 0),
      createdAt: apiDate(user.createdAt),
    })),
    total: Number(total?.total ?? 0),
    page: safePage,
    perPage: safePerPage,
  };
}

async function loadMemberActivityApi(c: AppContext, username: string, tab = "threads") {
  const user = await c.env.DB.prepare(
    `SELECT id, public_id AS publicId, username, display_name AS displayName, avatar_url AS avatarUrl, bio, role,
      banned, post_count AS postCount, thread_count AS threadCount, created_at AS createdAt
     FROM users
     WHERE username = ?
     LIMIT 1`,
  )
    .bind(username.toLowerCase())
    .first<Record<string, unknown>>();
  if (!user) return null;

  const userId = Number(user.id);
  const [authoredThreadCount, activityThreadCount, replyCount] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) AS total FROM threads WHERE user_id = ?").bind(userId).first<Record<string, unknown>>(),
    c.env.DB.prepare(
      `WITH ids AS (
        SELECT id AS threadId FROM threads WHERE user_id = ?
        UNION
        SELECT thread_id AS threadId FROM posts WHERE user_id = ?
      )
      SELECT COUNT(*) AS total FROM ids`,
    ).bind(userId, userId).first<Record<string, unknown>>(),
    c.env.DB.prepare("SELECT COUNT(*) AS total FROM posts WHERE user_id = ?").bind(userId).first<Record<string, unknown>>(),
  ]);

  const selectedTab = tab === "replies" ? "replies" : "threads";
  const [threadRows, replyRows] = await Promise.all([
    selectedTab === "threads"
      ? c.env.DB.prepare(
          `WITH activity AS (
            SELECT id AS threadId, created_at AS activityAt, 1 AS authored
            FROM threads
            WHERE user_id = ?
            UNION ALL
            SELECT thread_id AS threadId, MAX(created_at) AS activityAt, 0 AS authored
            FROM posts
            WHERE user_id = ?
            GROUP BY thread_id
          ),
          ranked AS (
            SELECT threadId, MAX(activityAt) AS activityAt, MAX(authored) AS authored
            FROM activity
            GROUP BY threadId
          )
          SELECT t.id, t.public_id AS publicId, t.title, t.slug, t.created_at AS createdAt, t.updated_at AS updatedAt,
            t.last_post_at AS lastPostAt, t.reply_count AS replyCount,
            c.id AS categoryId, c.name AS categoryName, c.slug AS categorySlug, c.public_id AS categoryPublicId,
            ranked.activityAt AS activityAt, ranked.authored AS authored
          FROM ranked
          INNER JOIN threads t ON t.id = ranked.threadId
          INNER JOIN categories c ON c.id = t.category_id
          ORDER BY ranked.activityAt DESC, t.id DESC`,
        ).bind(userId, userId).all<Record<string, unknown>>()
      : Promise.resolve({ results: [] as Record<string, unknown>[] }),
    selectedTab === "replies"
      ? c.env.DB.prepare(
          `SELECT p.id, p.content, p.like_count AS likeCount, p.created_at AS createdAt,
            t.id AS threadId, t.public_id AS threadPublicId, t.title AS threadTitle, t.slug AS threadSlug,
            t.reply_count AS threadReplyCount,
            c.id AS categoryId, c.name AS categoryName, c.slug AS categorySlug, c.public_id AS categoryPublicId
           FROM posts p
           INNER JOIN threads t ON t.id = p.thread_id
           INNER JOIN categories c ON c.id = t.category_id
           WHERE p.user_id = ?
           ORDER BY p.created_at DESC`,
        ).bind(userId).all<Record<string, unknown>>()
      : Promise.resolve({ results: [] as Record<string, unknown>[] }),
  ]);

  const publicUser = {
    id: userId,
    publicId: String(user.publicId ?? ""),
    username: String(user.username ?? ""),
    displayName: String(user.displayName ?? ""),
    avatarUrl: user.avatarUrl == null ? null : String(user.avatarUrl),
    bio: user.bio == null ? null : String(user.bio),
    role: String(user.role ?? "member"),
    banned: !!user.banned,
    postCount: Number(replyCount?.total ?? 0),
    threadCount: Number(activityThreadCount?.total ?? 0),
    createdAt: apiDate(user.createdAt),
  };

  const activeTotal = selectedTab === "replies" ? publicUser.postCount : publicUser.threadCount;
  return {
    user: publicUser,
    threads: (threadRows.results ?? []).map((thread) => ({
      ...thread,
      authored: !!thread.authored,
      createdAt: apiDate(thread.createdAt),
      updatedAt: apiDate(thread.updatedAt),
      lastPostAt: apiDate(thread.lastPostAt),
      activityAt: apiDate(thread.activityAt),
    })),
    replies: (replyRows.results ?? []).map((reply) => ({ ...reply, createdAt: apiDate(reply.createdAt) })),
    totals: {
      threads: Number(activityThreadCount?.total ?? 0),
      authoredThreads: Number(authoredThreadCount?.total ?? 0),
      replies: Number(replyCount?.total ?? 0),
    },
    page: 1,
    perPage: Math.max(activeTotal, 1),
    tab: selectedTab,
  };
}

async function loadTagThreadsApi(c: AppContext, slug: string, sort = "recent") {
  const tag = await c.env.DB.prepare("SELECT id, name, slug FROM tags WHERE slug = ? LIMIT 1")
    .bind(slug)
    .first<Record<string, unknown>>();
  if (!tag) return null;

  const orderBy =
    sort === "popular"
      ? "ORDER BY t.views DESC"
      : sort === "replies"
        ? "ORDER BY t.reply_count DESC"
        : "ORDER BY t.last_post_at DESC";
  const total = await c.env.DB.prepare("SELECT COUNT(*) AS total FROM thread_tags WHERE tag_id = ?")
    .bind(Number(tag.id))
    .first<Record<string, unknown>>();
  const rows = await c.env.DB.prepare(
    `SELECT t.id, t.public_id AS publicId, t.title, t.slug, t.pinned, t.locked, t.featured,
      t.views, t.reply_count AS replyCount, t.created_at AS createdAt, t.last_post_at AS lastPostAt,
      c.id AS categoryId, c.public_id AS categoryPublicId, c.name AS categoryName, c.slug AS categorySlug, c.color AS categoryColor,
      u.id AS authorId, u.public_id AS authorPublicId, u.username AS authorUsername, u.display_name AS authorDisplayName,
      u.avatar_url AS authorAvatar, u.role AS authorRole
     FROM thread_tags tt
     INNER JOIN threads t ON t.id = tt.thread_id
     INNER JOIN categories c ON c.id = t.category_id
     INNER JOIN users u ON u.id = t.user_id
     WHERE tt.tag_id = ?
     ${orderBy}`,
  )
    .bind(Number(tag.id))
    .all<Record<string, unknown>>();

  return {
    tag: { id: Number(tag.id), name: String(tag.name ?? ""), slug: String(tag.slug ?? "") },
    threads: (rows.results ?? []).map((thread) => ({
      ...mapThreadApi(thread),
      tags: [{ id: Number(tag.id), name: String(tag.name ?? ""), slug: String(tag.slug ?? "") }],
    })),
    total: Number(total?.total ?? 0),
    page: 1,
    perPage: Math.max(Number(total?.total ?? 0), 1),
  };
}

async function loadTagsApi(c: AppContext) {
  const rows = await c.env.DB.prepare(
    `SELECT tags.id, tags.name, tags.slug, COUNT(thread_tags.thread_id) AS threadCount
     FROM tags
     LEFT JOIN thread_tags ON thread_tags.tag_id = tags.id
     GROUP BY tags.id
     ORDER BY threadCount DESC, tags.name ASC`,
  ).all<Record<string, unknown>>();

  return (rows.results ?? []).map((tag) => ({
    id: Number(tag.id),
    name: String(tag.name ?? ""),
    slug: String(tag.slug ?? ""),
    threadCount: Number(tag.threadCount ?? 0),
  }));
}

function rootSchemas(base: string): SeoSchema[] {
  return [
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": `${base}/#website`,
      name: SITE_NAME,
      alternateName: SITE_TAGLINE,
      description: SITE_DESCRIPTION,
      url: `${base}/`,
      inLanguage: CONTENT_LANGUAGE,
      publisher: {
        "@type": "Organization",
        "@id": `${base}/#organization`,
        name: SITE_NAME,
        alternateName: SITE_TAGLINE,
        url: `${base}/`,
      },
      potentialAction: {
        "@type": "SearchAction",
        target: {
          "@type": "EntryPoint",
          urlTemplate: `${base}/search?q={search_term_string}`,
        },
        "query-input": "required name=search_term_string",
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": `${base}/#organization`,
      name: SITE_NAME,
      alternateName: SITE_TAGLINE,
      slogan: SITE_TAGLINE,
      description: SITE_DESCRIPTION,
      url: `${base}/`,
    },
  ];
}

function breadcrumbSchema(base: string, items: Array<{ name: string; path: string }>): SeoSchema {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(base, item.path),
    })),
  };
}

function itemListSchema(base: string, items: Array<{ name: string; path: string }>): SeoSchema {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      url: absoluteUrl(base, item.path),
    })),
  };
}

function seoBlock(
  title: string,
  body: string,
  rows: SeoContentRow[] = [],
  options: { anchors?: SeoAnchorLink[]; currentPath?: string } = {},
): string {
  const descriptionAttr = body ? ' aria-describedby="seo-content-description"' : "";
  const anchorGroups = prepareSeoAnchorGroups(options.anchors ?? [], options.currentPath ?? "");
  const usedAnchorTerms = new Set<string>();
  const items = rows
    .map((row, index) => {
      const text = row.text ? `          <p>${seoTextHtml(row.text, anchorGroups, usedAnchorTerms)}</p>` : "";
      return [
        `      <li class="seo-content__row" value="${index + 1}">`,
        "        <article class=\"seo-content__item\">",
        `          <h2><a href="${escapeHtml(row.path)}">${escapeHtml(row.title)}</a></h2>`,
        text,
        "        </article>",
        "      </li>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  return [
    `<main id="seo-content" class="seo-content" data-server-rendered="seo" data-count="${rows.length}" aria-labelledby="seo-content-title"${descriptionAttr}>`,
    '  <header class="seo-content__header">',
    `    <h1 id="seo-content-title">${escapeHtml(title)}</h1>`,
    body ? `    <p id="seo-content-description">${escapeHtml(body)}</p>` : "",
    "  </header>",
    items
      ? [
          '  <section class="seo-content__list" aria-label="Server-rendered forum content">',
          "    <ol>",
          items,
          "    </ol>",
          "  </section>",
        ].join("\n")
      : "",
    "</main>",
  ]
    .filter(Boolean)
    .join("\n");
}

function seoDateHtml(value: unknown): string {
  const iso = isoDate(value);
  return `<time datetime="${escapeHtml(iso)}">${escapeHtml(iso.slice(0, 10))}</time>`;
}

function seoUserPath(username: unknown): string {
  const name = String(username ?? "").trim();
  return name ? `/u/${encodeURIComponent(name)}` : "/members";
}

function seoTagLinksHtml(tags: Record<string, unknown>[]): string {
  const links = tags
    .map((tag) => {
      const name = String(tag.name ?? "").trim();
      const slug = String(tag.slug ?? name).trim();
      if (!name || !slug) return "";
      const href = `/tag/${encodeURIComponent(slug)}`;
      return `<a href="${escapeHtml(href)}" rel="tag">#${escapeHtml(name)}</a>`;
    })
    .filter(Boolean)
    .join("\n      ");

  return links ? `    <nav class="seo-content__tags" aria-label="Thread tags">\n      ${links}\n    </nav>` : "";
}

function seoThreadBlock(
  title: string,
  description: string,
  thread: {
    path: string;
    categoryName: unknown;
    categoryPath: string;
    authorName: unknown;
    authorUsername: unknown;
    createdAt: unknown;
    updatedAt: unknown;
    views: unknown;
    replyCount: unknown;
    content: unknown;
    tags: Record<string, unknown>[];
    replies: Record<string, unknown>[];
  },
  options: { anchors?: SeoAnchorLink[]; currentPath?: string } = {},
): string {
  const descriptionAttr = description ? ' aria-describedby="seo-content-description"' : "";
  const anchorGroups = prepareSeoAnchorGroups(options.anchors ?? [], options.currentPath ?? thread.path);
  const usedAnchorTerms = new Set<string>();
  const authorName = String(thread.authorName ?? "Forum member");
  const authorPath = seoUserPath(thread.authorUsername);
  const categoryName = String(thread.categoryName ?? "Forum");
  const originalBody =
    seoRichTextHtml(thread.content, anchorGroups, usedAnchorTerms) ||
    (description ? `<p>${seoTextHtml(description, anchorGroups, usedAnchorTerms)}</p>` : "");
  const replyItems = thread.replies
    .map((reply, index) => {
      const replyAuthor = String(reply.authorName ?? "Forum member");
      const replyAuthorPath = seoUserPath(reply.username);
      const replyId = Number(reply.id ?? 0) > 0 ? `post-${Number(reply.id)}` : `reply-${index + 1}`;
      const replyBody = seoRichTextHtml(reply.content, anchorGroups, usedAnchorTerms);
      if (!replyBody) return "";
      return [
        `    <article class="seo-content__comment" id="${escapeHtml(replyId)}">`,
        "      <header class=\"seo-content__comment-header\">",
        `        <h2><a href="${escapeHtml(replyAuthorPath)}">${escapeHtml(replyAuthor)}</a> reply</h2>`,
        `        <span>posted ${seoDateHtml(reply.createdAt)}</span>`,
        "      </header>",
        `      <div class="seo-content__body">${replyBody}</div>`,
        "    </article>",
      ].join("\n");
    })
    .filter(Boolean)
    .join("\n");

  return [
    `<main id="seo-content" class="seo-content seo-content--thread" data-server-rendered="seo" data-count="${thread.replies.length + 1}" aria-labelledby="seo-content-title"${descriptionAttr}>`,
    '  <article class="seo-content__thread" itemscope itemtype="https://schema.org/DiscussionForumPosting">',
    '    <header class="seo-content__header">',
    `      <h1 id="seo-content-title" itemprop="headline">${escapeHtml(title)}</h1>`,
    description ? `      <p id="seo-content-description">${escapeHtml(description)}</p>` : "",
    '      <div class="seo-content__meta">',
    `        <a href="${escapeHtml(thread.categoryPath)}">${escapeHtml(categoryName)}</a>`,
    `        <span>by <a href="${escapeHtml(authorPath)}">${escapeHtml(authorName)}</a></span>`,
    `        <span>published ${seoDateHtml(thread.createdAt)}</span>`,
    `        <span>updated ${seoDateHtml(thread.updatedAt)}</span>`,
    `        <span>${escapeHtml(Number(thread.replyCount ?? 0))} replies</span>`,
    `        <span>${escapeHtml(Number(thread.views ?? 0))} views</span>`,
    "      </div>",
    seoTagLinksHtml(thread.tags),
    "    </header>",
    '    <section class="seo-content__post" aria-label="Original post" itemprop="articleBody">',
    `      <div class="seo-content__body">${originalBody}</div>`,
    "    </section>",
    replyItems
      ? [
          '    <section class="seo-content__comments" aria-label="Replies">',
          replyItems,
          "    </section>",
        ].join("\n")
      : "",
    "  </article>",
    "</main>",
  ]
    .filter(Boolean)
    .join("\n");
}

function noindexPayload(pathname: string): SeoPayload {
  const section = pathname.replace(/^\/+/, "").split("/")[0] || "page";
  const labels: Record<string, string> = {
    t: "Thread not found",
    c: "Category not found",
    u: "Member not found",
    tag: "Tag not found",
    admin: "Admin",
    login: "Login",
    register: "Register",
    search: "Search",
    "new-thread": "New Thread",
  };
  const name = labels[section] ?? `${section.charAt(0).toUpperCase()}${section.slice(1)}`;
  return {
    title: `${name} — ${SITE_NAME}`,
    description: SITE_DESCRIPTION,
    canonicalPath: pathname || "/",
    robots: "noindex,nofollow",
    contentHtml: seoBlock(name, SITE_DESCRIPTION),
  };
}

function notFoundPayload(pathname: string, label = "Page not found"): SeoPayload {
  return {
    title: `404 ${label} — ${SITE_NAME}`,
    description: "The requested forum page could not be found.",
    canonicalPath: pathname || "/404",
    robots: "noindex,nofollow",
    status: 404,
    contentHtml: seoBlock("404", `error: ${label.toLowerCase()}`, [
      { title: "Threads", path: "/", text: "Return to recent forum threads." },
      { title: "Members", path: "/members", text: "Browse forum members." },
      { title: "Tags", path: "/tags", text: "Explore forum tags." },
    ]),
  };
}

async function homePayload(c: AppContext, base: string, anchors: SeoAnchorLink[]): Promise<SeoPayload> {
  const rows = await c.env.DB.prepare(
    `SELECT t.id, t.public_id AS publicId, t.title, t.content, t.reply_count AS replyCount, t.views, t.last_post_at AS lastPostAt,
      c.name AS categoryName, c.public_id AS categoryPublicId, u.display_name AS authorName
    FROM threads t
    INNER JOIN categories c ON c.id = t.category_id
    INNER JOIN users u ON u.id = t.user_id
    ORDER BY t.pinned DESC, t.last_post_at DESC
    LIMIT 50`,
  ).all<Record<string, unknown>>();
  const threads = rows.results ?? [];
  const stats = await c.env.DB.prepare(
    "SELECT (SELECT COUNT(*) FROM threads) AS threadCount, (SELECT COUNT(*) FROM users) AS userCount",
  ).first<{ threadCount: number; userCount: number }>();
  const description = `${SITE_DESCRIPTION} Browse ${Number(stats?.threadCount ?? 0)} threads from ${Number(stats?.userCount ?? 0)} members.`;
  const items = threads.map((thread) => ({
    name: String(thread.title),
    path: `/t/${thread.publicId}`,
  }));
  return {
    title: SITE_TAGLINE,
    description,
    canonicalPath: "/",
    schemas: [
      {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        "@id": `${base}/#webpage`,
        name: SITE_NAME,
        url: `${base}/`,
        description,
        inLanguage: CONTENT_LANGUAGE,
        numberOfItems: Number(stats?.threadCount ?? threads.length),
      },
      itemListSchema(base, items),
    ],
    contentHtml: seoBlock(
      SITE_NAME,
      description,
      threads.map((thread) => ({
        title: String(thread.title),
        path: `/t/${thread.publicId}`,
        text: `${cleanText(thread.content, 120)} ${thread.categoryName ? `Category: ${thread.categoryName}.` : ""}`.trim(),
      })),
      { anchors, currentPath: "/" },
    ),
  };
}

async function threadPayload(c: AppContext, base: string, id: string, anchors: SeoAnchorLink[]): Promise<SeoPayload | null> {
  const thread = await c.env.DB.prepare(
    `SELECT t.id, t.public_id AS publicId, t.title, t.slug, t.content, t.reply_count AS replyCount, t.views,
      t.created_at AS createdAt, t.updated_at AS updatedAt, t.last_post_at AS lastPostAt,
      c.id AS categoryId, c.public_id AS categoryPublicId, c.name AS categoryName, c.slug AS categorySlug,
      u.username AS authorUsername, u.display_name AS authorName, u.avatar_url AS authorImage
    FROM threads t
    INNER JOIN categories c ON c.id = t.category_id
    INNER JOIN users u ON u.id = t.user_id
    WHERE t.public_id = ? OR t.id = ? OR printf('%012d', 100000000000 + ((t.id * 982451653 + 57885161) % 900000000000)) = ?
    LIMIT 1`,
  )
    .bind(id, numericId(id), id)
    .first<Record<string, unknown>>();
  if (!thread) return null;

  const [tagRows, replyRows] = await Promise.all([
    c.env.DB.prepare(
      `SELECT tags.name, tags.slug
       FROM tags
       INNER JOIN thread_tags tt ON tt.tag_id = tags.id
       WHERE tt.thread_id = ?
       ORDER BY tags.name`,
    )
      .bind(Number(thread.id))
      .all<Record<string, unknown>>(),
    c.env.DB.prepare(
      `SELECT p.id, p.content, p.created_at AS createdAt, u.username, u.display_name AS authorName
       FROM posts p
       INNER JOIN users u ON u.id = p.user_id
       WHERE p.thread_id = ?
       ORDER BY p.created_at ASC`,
    )
      .bind(Number(thread.id))
      .all<Record<string, unknown>>(),
  ]);

  const tags = tagRows.results ?? [];
  const replies = replyRows.results ?? [];
  const title = String(thread.title);
  const path = `/t/${thread.publicId}`;
  const url = absoluteUrl(base, path);
  const articleTags = tags.map((tag) => String(tag.name)).filter(Boolean);
  const articleSection = String(thread.categoryName);
  const articlePublishedTime = isoDate(thread.createdAt);
  const articleModifiedTime = newestIsoDate(thread.updatedAt, thread.lastPostAt, thread.createdAt);
  const description = cleanText(thread.content, 160) || `${title} discussion in ${thread.categoryName}.`;
  const comments = replies
    .map((reply) => {
      const text = cleanText(reply.content, 1000);
      if (!text) return null;
      return {
        "@type": "Comment",
        "@id": `${url}#post-${reply.id}`,
        url: `${url}#post-${reply.id}`,
        text,
        datePublished: isoDate(reply.createdAt),
        author: {
          "@type": "Person",
          name: String(reply.authorName),
          url: absoluteUrl(base, `/u/${reply.username}`),
        },
      };
    })
    .filter(Boolean);
  const schemas: SeoSchema[] = [
    breadcrumbSchema(base, [
      { name: SITE_NAME, path: "/" },
      { name: String(thread.categoryName), path: `/c/${thread.categoryPublicId}` },
      { name: title, path },
    ]),
    {
      "@context": "https://schema.org",
      "@type": "DiscussionForumPosting",
      "@id": `${url}#posting`,
      url,
      mainEntityOfPage: url,
      headline: title,
      text: cleanText(thread.content, 4000),
      articleSection,
      keywords: articleTags.join(", ") || undefined,
      datePublished: articlePublishedTime,
      dateModified: articleModifiedTime,
      inLanguage: CONTENT_LANGUAGE,
      author: {
        "@type": "Person",
        name: String(thread.authorName),
        url: absoluteUrl(base, `/u/${thread.authorUsername}`),
        image: thread.authorImage || undefined,
      },
      interactionStatistic: [
        {
          "@type": "InteractionCounter",
          interactionType: "https://schema.org/CommentAction",
          userInteractionCount: Number(thread.replyCount ?? 0),
        },
        {
          "@type": "InteractionCounter",
          interactionType: "https://schema.org/ViewAction",
          userInteractionCount: Number(thread.views ?? 0),
        },
      ],
      commentCount: Number(thread.replyCount ?? 0),
      comment: comments.length ? comments : undefined,
    },
  ];
  return {
    title: `${title} — ${SITE_NAME}`,
    description,
    canonicalPath: path,
    type: "article",
    imagePath: `/og/thread/${thread.publicId}.webp`,
    imageAlt: `${title} — ${SITE_NAME}`,
    articlePublishedTime,
    articleModifiedTime,
    articleSection,
    articleTags,
    schemas,
    contentHtml: seoThreadBlock(
      title,
      description,
      {
        path,
        categoryName: thread.categoryName,
        categoryPath: `/c/${thread.categoryPublicId}`,
        authorName: thread.authorName,
        authorUsername: thread.authorUsername,
        createdAt: thread.createdAt,
        updatedAt: newestIsoDate(thread.updatedAt, thread.lastPostAt, thread.createdAt),
        views: thread.views,
        replyCount: thread.replyCount,
        content: thread.content,
        tags,
        replies,
      },
      { anchors, currentPath: path },
    ),
  };
}

async function categoryPayload(c: AppContext, base: string, id: string, anchors: SeoAnchorLink[]): Promise<SeoPayload | null> {
  const category = await c.env.DB.prepare(
    "SELECT id, public_id AS publicId, name, slug, description FROM categories WHERE public_id = ? OR id = ? OR slug = ? LIMIT 1",
  )
    .bind(id, numericId(id), id)
    .first<Record<string, unknown>>();
  if (!category) return null;

  const rows = await c.env.DB.prepare(
    `SELECT id, public_id AS publicId, title, content, reply_count AS replyCount
     FROM threads
     WHERE category_id = ?
     ORDER BY pinned DESC, last_post_at DESC`,
  )
    .bind(Number(category.id))
    .all<Record<string, unknown>>();
  const total = await c.env.DB.prepare("SELECT COUNT(*) AS total FROM threads WHERE category_id = ?")
    .bind(Number(category.id))
    .first<{ total: number }>();
  const threads = rows.results ?? [];
  const name = String(category.name);
  const description = cleanText(category.description, 160) || `${name} discussions and threads on ${SITE_NAME}.`;
  const path = `/c/${category.publicId}`;
  const items = threads.map((thread) => ({ name: String(thread.title), path: `/t/${thread.publicId}` }));
  return {
    title: `${name} — ${SITE_NAME}`,
    description,
    canonicalPath: path,
    schemas: [
      breadcrumbSchema(base, [
        { name: SITE_NAME, path: "/" },
        { name, path },
      ]),
      {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        "@id": `${absoluteUrl(base, path)}#webpage`,
        name,
        url: absoluteUrl(base, path),
        description,
        inLanguage: CONTENT_LANGUAGE,
        numberOfItems: Number(total?.total ?? threads.length),
      },
      itemListSchema(base, items),
    ],
    contentHtml: seoBlock(
      name,
      description,
      threads.map((thread) => ({
        title: String(thread.title),
        path: `/t/${thread.publicId}`,
        text: cleanText(thread.content, 140),
      })),
      { anchors, currentPath: path },
    ),
  };
}

async function membersPayload(c: AppContext, base: string, anchors: SeoAnchorLink[]): Promise<SeoPayload> {
  const rows = await c.env.DB.prepare(
    `SELECT username, display_name AS displayName, bio, post_count AS postCount, thread_count AS threadCount
     FROM users
     ORDER BY post_count DESC, id DESC
     LIMIT ?`,
  ).bind(MEMBERS_SEO_LIMIT).all<Record<string, unknown>>();
  const total = await c.env.DB.prepare("SELECT COUNT(*) AS total FROM users").first<{ total: number }>();
  const users = rows.results ?? [];
  const description = `Browse ${SITE_NAME} members, authors, moderators and food technology contributors on the ${SITE_TAGLINE}.`;
  const items = users.map((user) => ({ name: String(user.displayName), path: `/u/${user.username}` }));
  const totalUsers = Number(total?.total ?? users.length);
  const listDescription =
    totalUsers > users.length
      ? `${description} Showing the top ${users.length} active public profiles from ${totalUsers.toLocaleString("en-US")} members.`
      : description;
  return {
    title: `Members — ${SITE_NAME}`,
    description,
    canonicalPath: "/members",
    schemas: [
      breadcrumbSchema(base, [
        { name: SITE_NAME, path: "/" },
        { name: "Members", path: "/members" },
      ]),
      {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: `${SITE_NAME} Members`,
        url: `${base}/members`,
        description,
        inLanguage: CONTENT_LANGUAGE,
        numberOfItems: totalUsers,
      },
      itemListSchema(base, items),
    ],
    contentHtml: seoBlock(
      `${SITE_NAME} Members`,
      listDescription,
      users.map((user) => ({
        title: `${user.displayName} (@${user.username})`,
        path: `/u/${user.username}`,
        text: cleanText(user.bio, 140) || `${user.postCount ?? 0} replies, ${user.threadCount ?? 0} threads.`,
      })),
      { anchors, currentPath: "/members" },
    ),
  };
}

async function memberPayload(c: AppContext, base: string, username: string, anchors: SeoAnchorLink[]): Promise<SeoPayload | null> {
  const user = await c.env.DB.prepare(
    `SELECT id, username, display_name AS displayName, avatar_url AS avatarUrl, bio, role,
      post_count AS postCount, thread_count AS threadCount, created_at AS createdAt
     FROM users
     WHERE username = ?
     LIMIT 1`,
  )
    .bind(username.toLowerCase())
    .first<Record<string, unknown>>();
  if (!user) return null;

  const rows = await c.env.DB.prepare(
    `WITH activity AS (
      SELECT id AS threadId, created_at AS activityAt
      FROM threads
      WHERE user_id = ?
      UNION
      SELECT thread_id AS threadId, MAX(created_at) AS activityAt
      FROM posts
      WHERE user_id = ?
      GROUP BY thread_id
    )
    SELECT t.id, t.public_id AS publicId, t.title, t.content, MAX(activity.activityAt) AS activityAt
    FROM activity
    INNER JOIN threads t ON t.id = activity.threadId
    GROUP BY t.id
    ORDER BY activityAt DESC`,
  )
    .bind(Number(user.id), Number(user.id))
    .all<Record<string, unknown>>();

  const threads = rows.results ?? [];
  const displayName = String(user.displayName);
  const path = `/u/${encodeURIComponent(String(user.username))}`;
  const url = absoluteUrl(base, path);
  const description =
    cleanText(user.bio, 160) ||
    `${displayName} (@${user.username}) on ${SITE_NAME}: ${user.postCount ?? 0} replies and ${user.threadCount ?? 0} threads.`;
  return {
    title: `${displayName} — ${SITE_NAME}`,
    description,
    canonicalPath: path,
    type: "profile",
    schemas: [
      breadcrumbSchema(base, [
        { name: SITE_NAME, path: "/" },
        { name: "Members", path: "/members" },
        { name: displayName, path },
      ]),
      {
        "@context": "https://schema.org",
        "@type": "ProfilePage",
        "@id": `${url}#profile`,
        url,
        name: displayName,
        description,
        inLanguage: CONTENT_LANGUAGE,
        dateCreated: isoDate(user.createdAt),
        mainEntity: {
          "@type": "Person",
          "@id": `${url}#person`,
          name: displayName,
          alternateName: String(user.username),
          url,
          image: user.avatarUrl || undefined,
          description: user.bio || undefined,
        },
      },
      itemListSchema(
        base,
        threads.map((thread) => ({ name: String(thread.title), path: `/t/${thread.publicId}` })),
      ),
    ],
    contentHtml: seoBlock(
      displayName,
      description,
      threads.map((thread) => ({
        title: String(thread.title),
        path: `/t/${thread.publicId}`,
        text: cleanText(thread.content, 140),
      })),
      { anchors, currentPath: path },
    ),
  };
}

async function tagsPayload(c: AppContext, base: string, anchors: SeoAnchorLink[]): Promise<SeoPayload> {
  const rows = await c.env.DB.prepare(
    `SELECT tags.name, tags.slug, COUNT(thread_tags.thread_id) AS threadCount
     FROM tags
     LEFT JOIN thread_tags ON thread_tags.tag_id = tags.id
     GROUP BY tags.id
     ORDER BY threadCount DESC, tags.name ASC`,
  ).all<Record<string, unknown>>();
  const tags = rows.results ?? [];
  const description = `Browse ${SITE_NAME} tags across food science, food safety and product development topics.`;
  return {
    title: `Tags — ${SITE_NAME}`,
    description,
    canonicalPath: "/tags",
    schemas: [
      breadcrumbSchema(base, [
        { name: SITE_NAME, path: "/" },
        { name: "Tags", path: "/tags" },
      ]),
      {
        "@context": "https://schema.org",
        "@type": "DefinedTermSet",
        name: `${SITE_NAME} Tags`,
        url: `${base}/tags`,
        inLanguage: CONTENT_LANGUAGE,
        hasDefinedTerm: tags.slice(0, 50).map((tag) => ({
          "@type": "DefinedTerm",
          name: String(tag.name),
          url: absoluteUrl(base, `/tag/${tag.slug}`),
        })),
      },
      itemListSchema(
        base,
        tags.map((tag) => ({ name: String(tag.name), path: `/tag/${tag.slug}` })),
      ),
    ],
    contentHtml: seoBlock(
      `${SITE_NAME} Tags`,
      description,
      tags.map((tag) => ({
        title: `#${tag.name}`,
        path: `/tag/${tag.slug}`,
        text: `${tag.threadCount ?? 0} threads`,
      })),
      { anchors, currentPath: "/tags" },
    ),
  };
}

async function tagPayload(c: AppContext, base: string, slug: string, anchors: SeoAnchorLink[]): Promise<SeoPayload | null> {
  const tag = await c.env.DB.prepare("SELECT id, name, slug FROM tags WHERE slug = ? LIMIT 1")
    .bind(slug)
    .first<Record<string, unknown>>();
  if (!tag) return null;
  const rows = await c.env.DB.prepare(
    `SELECT t.id, t.public_id AS publicId, t.title, t.content
     FROM thread_tags tt
     INNER JOIN threads t ON t.id = tt.thread_id
     WHERE tt.tag_id = ?
     ORDER BY t.last_post_at DESC`,
  )
    .bind(Number(tag.id))
    .all<Record<string, unknown>>();
  const total = await c.env.DB.prepare("SELECT COUNT(*) AS total FROM thread_tags WHERE tag_id = ?")
    .bind(Number(tag.id))
    .first<{ total: number }>();
  const threads = rows.results ?? [];
  const name = String(tag.name);
  const path = `/tag/${encodeURIComponent(String(tag.slug))}`;
  const description = `Discussions tagged ${name} on ${SITE_NAME}. Browse ${Number(total?.total ?? threads.length)} related threads.`;
  return {
    title: `#${name} — ${SITE_NAME}`,
    description,
    canonicalPath: path,
    schemas: [
      breadcrumbSchema(base, [
        { name: SITE_NAME, path: "/" },
        { name: "Tags", path: "/tags" },
        { name: `#${name}`, path },
      ]),
      {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: `#${name} ${SITE_NAME} Threads`,
        url: absoluteUrl(base, path),
        description,
        inLanguage: CONTENT_LANGUAGE,
        numberOfItems: Number(total?.total ?? threads.length),
      },
      itemListSchema(
        base,
        threads.map((thread) => ({ name: String(thread.title), path: `/t/${thread.publicId}` })),
      ),
    ],
    contentHtml: seoBlock(
      `#${name}`,
      description,
      threads.map((thread) => ({
        title: String(thread.title),
        path: `/t/${thread.publicId}`,
        text: cleanText(thread.content, 140),
      })),
      { anchors, currentPath: path },
    ),
  };
}

function aboutPayload(base: string, anchors: SeoAnchorLink[]): SeoPayload {
  const description = `Learn how ${SITE_NAME}, the ${SITE_TAGLINE}, helps members browse food science, food safety, product development and food technology discussions.`;
  const rows = [
    { title: "Threads", path: "/", text: "Browse practical food science and product development conversations." },
    { title: "Categories", path: "/", text: "Follow focused areas such as ingredients, food safety, nutrition, packaging and regulations." },
    { title: "Tags", path: "/tags", text: "Find recurring technical topics and related discussions by tag." },
    { title: "Members", path: "/members", text: "Open member profiles to view their threads, replies and forum history." },
    { title: "Contact", path: "/contact", text: "Reach the FSTDESK team for account, content and community requests." },
  ];
  return {
    title: `About — ${SITE_NAME}`,
    description,
    canonicalPath: "/about",
    schemas: [
      breadcrumbSchema(base, [
        { name: SITE_NAME, path: "/" },
        { name: "About", path: "/about" },
      ]),
      {
        "@context": "https://schema.org",
        "@type": "AboutPage",
        name: `About ${SITE_NAME}`,
        url: `${base}/about`,
        description,
        inLanguage: CONTENT_LANGUAGE,
      },
      itemListSchema(base, rows.map((row) => ({ name: row.title, path: row.path }))),
    ],
    contentHtml: seoBlock(`About ${SITE_NAME}`, description, rows, { anchors, currentPath: "/about" }),
  };
}

function whatIsFstdeskPayload(base: string, anchors: SeoAnchorLink[]): SeoPayload {
  const rows = [
    ...WHAT_IS_FSTDESK_SECTIONS.map((section) => ({
      title: section.title,
      path: WHAT_IS_FSTDESK_PATH,
      text: section.paragraphs.join(" "),
    })),
    ...WHAT_IS_FSTDESK_TOPIC_EXAMPLES.map((topic) => ({
      title: topic.title,
      path: topic.href,
      text: `${topic.area}: ${topic.summary}`,
    })),
  ];

  return {
    title: WHAT_IS_FSTDESK_TITLE,
    description: WHAT_IS_FSTDESK_DESCRIPTION,
    canonicalPath: WHAT_IS_FSTDESK_PATH,
    type: "article",
    articlePublishedTime: WHAT_IS_FSTDESK_PUBLISHED,
    articleModifiedTime: WHAT_IS_FSTDESK_PUBLISHED,
    articleSection: "Food Science and Technology",
    articleTags: [...WHAT_IS_FSTDESK_KEYWORDS],
    schemas: [
      breadcrumbSchema(base, [
        { name: SITE_NAME, path: "/" },
        { name: WHAT_IS_FSTDESK_TITLE, path: WHAT_IS_FSTDESK_PATH },
      ]),
      {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: WHAT_IS_FSTDESK_TITLE,
        description: WHAT_IS_FSTDESK_DESCRIPTION,
        url: absoluteUrl(base, WHAT_IS_FSTDESK_PATH),
        datePublished: WHAT_IS_FSTDESK_PUBLISHED,
        dateModified: WHAT_IS_FSTDESK_PUBLISHED,
        inLanguage: CONTENT_LANGUAGE,
        articleSection: "Food Science and Technology",
        keywords: [...WHAT_IS_FSTDESK_KEYWORDS].join(", "),
        publisher: { "@id": `${base}/#organization` },
        mainEntityOfPage: {
          "@type": "WebPage",
          "@id": absoluteUrl(base, WHAT_IS_FSTDESK_PATH),
        },
      },
      {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: WHAT_IS_FSTDESK_FAQS.map((item) => ({
          "@type": "Question",
          name: item.question,
          acceptedAnswer: {
            "@type": "Answer",
            text: item.answer,
          },
        })),
      },
      itemListSchema(
        base,
        WHAT_IS_FSTDESK_TOPIC_EXAMPLES.map((topic) => ({ name: topic.title, path: topic.href })),
      ),
    ],
    contentHtml: seoBlock(WHAT_IS_FSTDESK_TITLE, WHAT_IS_FSTDESK_DESCRIPTION, rows, {
      anchors,
      currentPath: WHAT_IS_FSTDESK_PATH,
    }),
  };
}

function contactPayload(base: string, anchors: SeoAnchorLink[]): SeoPayload {
  const description = `Contact the ${SITE_NAME} team for account, content and community requests.`;
  return {
    title: `Contact — ${SITE_NAME}`,
    description,
    canonicalPath: "/contact",
    schemas: [
      breadcrumbSchema(base, [
        { name: SITE_NAME, path: "/" },
        { name: "Contact", path: "/contact" },
      ]),
      {
        "@context": "https://schema.org",
        "@type": "ContactPage",
        name: `Contact ${SITE_NAME}`,
        url: `${base}/contact`,
        description,
        inLanguage: CONTENT_LANGUAGE,
        about: { "@id": `${base}/#organization` },
      },
    ],
    contentHtml: seoBlock(`Contact ${SITE_NAME}`, description, [
      { title: "Send a message", path: "/contact", text: "Use the contact form to send a direct message to the FSTDESK team." },
      { title: "Forum", path: "/", text: "Return to recent food science discussions." },
      { title: "Members", path: "/members", text: "Browse community member profiles." },
    ], { anchors, currentPath: "/contact" }),
  };
}

async function payloadForPath(c: AppContext, base: string, pathname: string, anchors: SeoAnchorLink[]): Promise<SeoPayload> {
  const parts = pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
  if (pathname === "/") return homePayload(c, base, anchors);
  if (parts[0] === "t" && parts[1]) return (await threadPayload(c, base, parts[1], anchors)) ?? notFoundPayload(pathname, "Thread not found");
  if (parts[0] === "c" && parts[1]) return (await categoryPayload(c, base, parts[1], anchors)) ?? notFoundPayload(pathname, "Category not found");
  if (parts[0] === "members" && parts.length === 1) return membersPayload(c, base, anchors);
  if (parts[0] === "u" && parts[1]) return (await memberPayload(c, base, parts[1], anchors)) ?? notFoundPayload(pathname, "Member not found");
  if (parts[0] === "tags" && parts.length === 1) return tagsPayload(c, base, anchors);
  if (parts[0] === "tag" && parts[1]) return (await tagPayload(c, base, parts[1], anchors)) ?? notFoundPayload(pathname, "Tag not found");
  if (parts[0] === "what-is-fstdesk" && parts.length === 1) return whatIsFstdeskPayload(base, anchors);
  if (parts[0] === "contact" && parts.length === 1) return contactPayload(base, anchors);
  if (parts[0] === "about" && parts.length === 1) return aboutPayload(base, anchors);
  if (["admin", "login", "register", "new-thread", "search"].includes(parts[0] ?? "")) return noindexPayload(pathname);
  return notFoundPayload(pathname);
}

function shouldLoadSeoAnchors(pathname: string): boolean {
  const section = pathname.split("/").filter(Boolean)[0] ?? "";
  return !["admin", "login", "register", "new-thread", "search"].includes(section);
}

function shouldRenderHtml(c: AppContext): boolean {
  if (c.req.method !== "GET") return false;
  const url = new URL(c.req.url);
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/assets/") || url.pathname.startsWith("/cdn-cgi/")) {
    return false;
  }
  if (/\.[a-zA-Z0-9]{2,8}$/.test(url.pathname)) return false;
  const accept = c.req.header("accept") ?? "";
  return !accept || accept.includes("text/html") || accept.includes("*/*");
}

function stripFallbackHead(html: string): string {
  return html
    .replace(/<html\s+lang="[^"]*"/i, `<html lang="${HTML_LANG}"`)
    .replace(/^[ \t]*<title>[\s\S]*?<\/title>[ \t]*\r?\n?/im, "")
    .replace(/^[ \t]*<meta\s+(?:name|property)="(?:description|robots|application-name|apple-mobile-web-app-title|author|publisher|keywords|twitter:card|twitter:title|twitter:description|twitter:image|twitter:image:alt|og:site_name|og:type|og:title|og:description|og:url|og:image|og:image:secure_url|og:image:type|og:image:width|og:image:height|og:image:alt|og:locale|article:published_time|article:modified_time|article:section|article:tag)"[^>]*>[ \t]*\r?\n?/gim, "")
    .replace(/^[ \t]*<meta\s+http-equiv="content-language"[^>]*>[ \t]*\r?\n?/gim, "")
    .replace(/^[ \t]*<link\s+rel="canonical"[^>]*>[ \t]*\r?\n?/gim, "")
    .replace(/\n{3,}/g, "\n\n");
}

function seoKeywords(payload: SeoPayload): string {
  return Array.from(
    new Set(
      [
        SITE_NAME,
        SITE_TAGLINE,
        "food science",
        "food technology",
        "food safety",
        "product development",
        payload.articleSection,
        ...(payload.articleTags ?? []),
      ]
        .map((item) => String(item ?? "").trim())
        .filter(Boolean),
    ),
  ).join(", ");
}

function metaHtml(payload: SeoPayload, base: string): string {
  const canonical = absoluteUrl(base, payload.canonicalPath);
  const fullTitle = fullSeoTitle(payload.title);
  const imagePath = payload.imagePath ?? DEFAULT_IMAGE;
  const image = absoluteUrl(base, imagePath);
  const imageType = imagePath.toLowerCase().endsWith(".webp") ? "image/webp" : "image/svg+xml";
  const imageAlt = payload.imageAlt ?? fullTitle;
  const schemas = [...rootSchemas(base), ...(payload.schemas ?? [])];
  const articleMeta =
    payload.type === "article"
      ? [
          payload.articlePublishedTime ? `<meta property="article:published_time" content="${escapeHtml(payload.articlePublishedTime)}" />` : "",
          payload.articleModifiedTime ? `<meta property="article:modified_time" content="${escapeHtml(payload.articleModifiedTime)}" />` : "",
          payload.articleSection ? `<meta property="article:section" content="${escapeHtml(payload.articleSection)}" />` : "",
          ...(payload.articleTags ?? []).map((tag) => `<meta property="article:tag" content="${escapeHtml(tag)}" />`),
        ].filter(Boolean)
      : [];
  return [
    `<title>${escapeHtml(fullTitle)}</title>`,
    `<meta name="description" content="${escapeHtml(payload.description)}" />`,
    `<meta name="robots" content="${escapeHtml(payload.robots ?? "index,follow")}" />`,
    `<meta name="application-name" content="${escapeHtml(SITE_NAME)}" />`,
    `<meta name="apple-mobile-web-app-title" content="${escapeHtml(SITE_NAME)}" />`,
    `<meta name="author" content="${escapeHtml(SITE_NAME)}" />`,
    `<meta name="publisher" content="${escapeHtml(SITE_NAME)}" />`,
    `<meta name="keywords" content="${escapeHtml(seoKeywords(payload))}" />`,
    `<meta http-equiv="content-language" content="${CONTENT_LANGUAGE}" />`,
    `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
    `<meta property="og:site_name" content="${escapeHtml(SITE_NAME)}" />`,
    `<meta property="og:type" content="${payload.type === "article" ? "article" : payload.type === "profile" ? "profile" : "website"}" />`,
    `<meta property="og:title" content="${escapeHtml(fullTitle)}" />`,
    `<meta property="og:description" content="${escapeHtml(payload.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(canonical)}" />`,
    `<meta property="og:image" content="${escapeHtml(image)}" />`,
    `<meta property="og:image:secure_url" content="${escapeHtml(image)}" />`,
    `<meta property="og:image:type" content="${escapeHtml(imageType)}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${escapeHtml(imageAlt)}" />`,
    `<meta property="og:locale" content="${OG_LOCALE}" />`,
    ...articleMeta,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(fullTitle)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(payload.description)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(image)}" />`,
    `<meta name="twitter:image:alt" content="${escapeHtml(imageAlt)}" />`,
    ...schemas.map((schema) => `<script type="application/ld+json">${escapeJsonLd(schema)}</script>`),
  ].join("\n    ");
}

async function bootstrapForUrl(c: AppContext, url: URL): Promise<BootstrapBuild> {
  const pathname = url.pathname;
  const parts = pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
  const queries: BootstrapQuery[] = [];

  const [categories, stats] = await Promise.all([loadCategoriesApi(c), loadStatsApi(c)]);
  queries.push({ key: ["categories"], data: categories });
  queries.push({ key: ["stats"], data: stats });

  if (pathname === "/") {
    const threads = await loadThreadsApi(c, { sort: "recent", page: 1 });
    queries.push({ key: ["threads", "all", "recent", "page", 1], data: threads });
  } else if (parts[0] === "c" && parts[1]) {
    const sort = url.searchParams.get("sort") ?? "recent";
    const page = positivePage(url.searchParams.get("page"));
    const category = await loadCategoryApi(c, parts[1]);
    if (category) {
      const threads = await loadThreadsApi(c, { categoryId: category.id, sort, page });
      queries.push({ key: ["category", parts[1]], data: category });
      queries.push({ key: ["threads", "cat", parts[1], sort, "page", page], data: threads });
    }
  } else if (parts[0] === "t" && parts[1]) {
    const thread = await loadThreadApi(c, parts[1]);
    if (thread) {
      const posts = await loadPostsApi(c, thread.id, { all: true });
      queries.push({ key: ["thread", parts[1]], data: thread });
      queries.push({ key: ["posts", thread.id, "all"], data: posts, updatedAt: 0 });
    }
  } else if (parts[0] === "members" && parts.length === 1) {
    const sort = url.searchParams.get("sort") ?? "posts";
    const members = await loadMembersApi(c, sort, 1, MEMBERS_BOOTSTRAP_PAGE_SIZE);
    queries.push({
      key: ["members", sort, "pages"],
      data: { pages: [members], pageParams: [1] },
    });
  } else if (parts[0] === "tags" && parts.length === 1) {
    const tags = await loadTagsApi(c);
    queries.push({ key: ["tags"], data: tags });
  } else if (parts[0] === "u" && parts[1]) {
    const tab = url.searchParams.get("tab") === "replies" ? "replies" : "threads";
    const member = await loadMemberActivityApi(c, parts[1], tab);
    if (member) queries.push({ key: ["member", parts[1], tab, "all"], data: member });
  } else if (parts[0] === "tag" && parts[1]) {
    const sort = url.searchParams.get("sort") ?? "recent";
    const tagThreads = await loadTagThreadsApi(c, parts[1], sort);
    if (tagThreads) queries.push({ key: ["tag-threads", parts[1], sort, "all"], data: tagThreads });
  }

  return { categories, payload: { queries } };
}

function staticSidebarHtml(pathname: string, categories: ApiCategory[]): string {
  const nav = [
    { href: "/", label: "threads", exact: true },
    { href: "/members", label: "members" },
    { href: "/tags", label: "tags" },
    { href: "/what-is-fstdesk", label: "what is fstdesk" },
    { href: "/contact", label: "contact" },
    { href: "/about", label: "about" },
  ];
  const navHtml = nav
    .map((item) => {
      const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
      return [
        `<a class="gb-tree-item${active ? " active" : ""}" href="${escapeHtml(item.href)}">`,
        `<span style="color:${active ? "var(--gb-yellow)" : "var(--gb-gray)"};width:16px;flex-shrink:0">#</span>`,
        `<span style="flex:1;overflow:hidden;text-overflow:ellipsis">${escapeHtml(item.label)}</span>`,
        "</a>",
      ].join("");
    })
    .join("");

  const categoryHtml = categories
    .map((cat, index) => {
      const href = apiCategoryPath(cat);
      const active = pathname === href || pathname === `/c/${cat.id}`;
      return [
        `<a class="gb-tree-item${active ? " active" : ""}" href="${escapeHtml(href)}">`,
        `<span style="color:${CAT_COLORS[index % CAT_COLORS.length]};width:16px;flex-shrink:0;font-size:14px">${active ? "&gt;" : "#"}</span>`,
        `<span style="flex:1;overflow:hidden;text-overflow:ellipsis">${escapeHtml(cat.name.toLowerCase())}</span>`,
        cat.threadCount > 0 ? `<span class="gb-tree-count">${escapeHtml(cat.threadCount)}</span>` : "",
        "</a>",
      ].join("");
    })
    .join("");

  return [
    '<div style="display:flex;flex-direction:column;height:100%">',
    '<div class="gb-sidebar-scroll">',
    '<div class="gb-section">NAVIGATION</div>',
    navHtml,
    '<div class="gb-section" style="display:flex;align-items:center;gap:6px"><span>CATEGORIES</span></div>',
    categoryHtml || '<div style="padding:3px 16px 3px 38px;font-size:12px;color:var(--gb-gray)">no categories</div>',
    "</div>",
    '<div class="gb-sidebar-bottom">',
    '<div style="display:flex;gap:6px;flex-wrap:wrap">',
    '<a href="/login?next=/new-thread" class="gb-btn gb-btn-new" style="flex:1 1 100%;justify-content:center;font-size:12px">+ new</a>',
    '<a href="/login" class="gb-btn" style="flex:1;justify-content:center;font-size:12px">login</a>',
    '<a href="/register" class="gb-btn gb-btn-primary" style="flex:1;justify-content:center;font-size:12px">register</a>',
    "</div>",
    "</div>",
    "</div>",
  ].join("");
}

function staticShellHtml(contentHtml: string, pathname: string, categories: ApiCategory[], embedded = false): string {
  const page = pathname === "/" ? "threads" : pathname.replace("/", "").split("/")[0] || "threads";
  if (embedded) {
    return [
      '<div class="gb-shell gb-shell-embedded" data-server-rendered="seo-shell">',
      `<div class="gb-main gb-main-embedded">${contentHtml}</div>`,
      "</div>",
    ].join("");
  }

  return [
    '<div class="gb-shell" data-server-rendered="seo-shell">',
    '<div class="gb-tabline">',
    '<div class="gb-tabline-left">',
    '<button class="gb-hamburger" title="Menu" aria-label="Open sidebar"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>',
    '<div class="gb-tab active" style="padding-left:12px"><a href="/" style="color:var(--gb-yellow);font-weight:700;text-decoration:none">FSTDESK</a></div>',
    '<nav class="gb-header-nav" aria-label="Primary">',
    '<a class="gb-header-link" href="/">threads</a>',
    '<a class="gb-header-link" href="/members">members</a>',
    '<a class="gb-header-link" href="/tags">tags</a>',
    '<a class="gb-header-link" href="/what-is-fstdesk">what is fstdesk</a>',
    "</nav>",
    "</div>",
    '<div class="gb-tabline-right">utf-8 | unix</div>',
    "</div>",
    '<div class="gb-body">',
    `<div class="gb-sidebar">${staticSidebarHtml(pathname, categories)}</div>`,
    `<div class="gb-main">${contentHtml}</div>`,
    "</div>",
    '<div class="gb-statusbar">',
    '<span class="gb-statusbar-mode">NORMAL &nbsp; guest</span>',
    '<span style="flex:1"></span>',
    `<span class="gb-statusbar-right">${escapeHtml(page)} &nbsp; 100%</span>`,
    "</div>",
    "</div>",
  ].join("");
}

function criticalShellCss(): string {
  return [
    '<style id="fstdesk-critical-css">',
    ":root{--gb-bg:#282828;--gb-bg1:#3c3836;--gb-bg2:#504945;--gb-fg:#ebdbb2;--gb-fg4:#c7b99e;--gb-gray:#bdae93;--gb-yellow:#fabd2f;--gb-green:#b8bb26;--gb-blue:#95c7c0;--gb-red:#fb4934}",
    "*,*::before,*::after{box-sizing:border-box}",
    "html,body,#root{width:100%;height:100%;margin:0;overflow:hidden;background:var(--gb-bg);color:var(--gb-fg)}",
    "body{font-family:'JetBrains Mono','Fira Code','Courier New',monospace;font-size:13px;line-height:1.4;-webkit-font-smoothing:antialiased}",
    "a{color:var(--gb-blue);text-decoration:none}",
    ".gb-shell{position:fixed;inset:0;display:flex;flex-direction:column;width:100vw;height:100vh;height:100dvh;overflow:hidden;background:var(--gb-bg);color:var(--gb-fg)}",
    ".gb-tabline{display:flex;align-items:center;justify-content:space-between;height:36px;padding:0 16px 0 0;flex-shrink:0;background:var(--gb-bg1);border-bottom:1px solid var(--gb-bg2)}",
    ".gb-tab{display:flex;align-items:center;height:100%;padding:0 18px;color:var(--gb-fg4);border-right:1px solid var(--gb-bg2);font-size:12px}.gb-tab.active{color:var(--gb-yellow);font-weight:700}",
    ".gb-header-nav{display:flex;align-items:center;height:100%;min-width:0}.gb-header-link{display:flex;align-items:center;height:100%;padding:0 14px;border-right:1px solid var(--gb-bg2);color:var(--gb-fg4);font-size:12px;font-weight:700;text-decoration:none;white-space:nowrap}.gb-header-link:hover{background:var(--gb-bg);color:var(--gb-yellow);text-decoration:none}",
    ".gb-body{display:flex;flex:1 1 auto;min-height:0;overflow:hidden}.gb-sidebar{width:240px;flex:0 0 240px;overflow:hidden;background:var(--gb-bg1);border-right:1px solid var(--gb-bg2)}.gb-main{flex:1 1 auto;min-width:0;overflow:auto;background:var(--gb-bg)}",
    ".gb-shell-embedded{background:var(--gb-bg)}.gb-main-embedded{width:100%;height:100%;max-width:none;overflow:auto}",
    ".gb-statusbar{display:flex;height:22px;align-items:center;gap:8px;padding:0 8px;flex-shrink:0;background:var(--gb-bg1);border-top:1px solid var(--gb-bg2);color:var(--gb-gray);font-size:11px}",
    "</style>",
  ].join("");
}

function prioritizeStylesheets(indexHtml: string): string {
  const stylesheetTags: string[] = [];
  let html = indexHtml.replace(/\s*<link\s+[^>]*rel=["']stylesheet["'][^>]*>\s*/gi, (tag) => {
    stylesheetTags.push(tag.trim());
    return "\n";
  });
  const hasCriticalCss = /id=["']fstdesk-critical-css["']/i.test(html);
  const preloadTags = stylesheetTags
    .map((tag) => {
      const href = /href=["']([^"']+)["']/i.exec(tag)?.[1];
      if (!href) return "";
      const crossorigin = /\scrossorigin(?:\s|=|>)/i.test(tag) ? " crossorigin" : "";
      return `<link rel="preload" as="style" href="${escapeHtml(href)}"${crossorigin} />`;
    })
    .filter(Boolean);
  const block = [hasCriticalCss ? "" : criticalShellCss(), ...preloadTags, ...stylesheetTags].filter(Boolean).join("\n    ");
  return html.replace("<head>", `<head>\n    ${block}`);
}

function injectHtml(indexHtml: string, payload: SeoPayload, base: string, url: URL, bootstrap: BootstrapBuild): string {
  const withCleanHead = prioritizeStylesheets(stripFallbackHead(indexHtml));
  const seoMeta = metaHtml(payload, base);
  const bootstrapScript = `<script id="__FSTDESK_BOOTSTRAP__" type="application/json">${escapeJsonScript(bootstrap.payload)}</script>`;
  const withMeta = /<meta\s+name="theme-color"[^>]*>\s*/i.test(withCleanHead)
    ? withCleanHead.replace(/(<meta\s+name="theme-color"[^>]*>\s*)/i, `$1\n    ${seoMeta}\n`)
    : withCleanHead.replace("<head>", `<head>\n    ${seoMeta}`);
  const content = payload.contentHtml ?? seoBlock(SITE_NAME, payload.description);
  return withMeta.replace(
    /<div id="root"><\/div>/,
    `<div id="root">${staticShellHtml(content, url.pathname, bootstrap.categories, url.searchParams.get("embed") === "1")}</div>\n    ${bootstrapScript}`,
  );
}

export async function renderSeoHtml(c: AppContext): Promise<Response> {
  if (!shouldRenderHtml(c)) return c.env.ASSETS.fetch(c.req.raw);

  const assetResponse = await c.env.ASSETS.fetch(c.req.raw);
  const contentType = assetResponse.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return assetResponse;

  const fallbackResponse = assetResponse.clone();
  try {
    const url = new URL(c.req.url);
    const base = `${url.protocol}//${url.host}`;
    const [anchors, bootstrap] = await Promise.all([
      shouldLoadSeoAnchors(url.pathname) ? loadSeoAnchors(c) : Promise.resolve([]),
      bootstrapForUrl(c, url),
    ]);
    const payload = await payloadForPath(c, base, url.pathname, anchors);
    const html = injectHtml(await assetResponse.text(), payload, base, url, bootstrap);
    const headers = new Headers(assetResponse.headers);
    headers.set("content-type", "text/html; charset=utf-8");
    headers.set("cache-control", "no-store, max-age=0, must-revalidate");
    headers.set("cdn-cache-control", "no-store");
    headers.set("cloudflare-cdn-cache-control", "no-store");
    headers.set("vary", "Accept");
    return new Response(html, { status: payload.status ?? assetResponse.status, headers });
  } catch (error) {
    console.warn("seo_render_fallback", error instanceof Error ? error.message : String(error));
    return fallbackResponse;
  }
}
