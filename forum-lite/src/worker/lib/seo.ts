import type { Context } from "hono";
import type { Bindings, Variables } from "../types";

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
  schemas?: SeoSchema[];
  contentHtml?: string;
};

type SeoContentRow = {
  title: string;
  path: string;
  text?: string;
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

const SITE_NAME = "FSTDESK Forum";
const SITE_DESCRIPTION = "Food science, food safety, product development and food technology forum discussions.";
const HTML_LANG = "en";
const CONTENT_LANGUAGE = "en-US";
const OG_LOCALE = "en_US";
const DEFAULT_IMAGE = "/og/default.webp";
const CAT_COLORS = ["#b8bb26", "#83a598", "#fabd2f", "#d3869b", "#8ec07c", "#fe8019", "#fb4934", "#a89984"];

function cleanText(input: unknown, max = 160): string {
  const text = String(input ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[`*_>#|~=-]/g, " ")
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

function absoluteUrl(base: string, path: string): string {
  return new URL(path || "/", base).toString();
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

function numericId(value: string): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : -1;
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
  const page = Math.max(1, opts.page ?? 1);
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
      t.views, t.reply_count AS replyCount, t.created_at AS createdAt, t.last_post_at AS lastPostAt,
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
      t.views, t.reply_count AS replyCount, t.created_at AS createdAt, t.last_post_at AS lastPostAt,
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

  return {
    ...mapThreadApi(thread),
    content: String(thread.content ?? ""),
    tags: (tagRows.results ?? []).map((tag) => ({
      id: Number(tag.id),
      name: String(tag.name ?? ""),
      slug: String(tag.slug ?? ""),
    })),
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

async function loadMembersApi(c: AppContext, sort = "posts") {
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
     ${orderBy}`,
  ).all<Record<string, unknown>>();

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
    page: 1,
    perPage: Math.max(Number(total?.total ?? 0), 1),
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
          SELECT t.id, t.public_id AS publicId, t.title, t.slug, t.created_at AS createdAt,
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

function rootSchemas(base: string): SeoSchema[] {
  return [
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": `${base}/#website`,
      name: SITE_NAME,
      url: `${base}/`,
      inLanguage: CONTENT_LANGUAGE,
      publisher: {
        "@type": "Organization",
        "@id": `${base}/#organization`,
        name: "FSTDESK",
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
      name: "FSTDESK",
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

function seoBlock(title: string, body: string, rows: SeoContentRow[] = []): string {
  const descriptionAttr = body ? ' aria-describedby="seo-content-description"' : "";
  const items = rows
    .map((row, index) => {
      const text = row.text ? `          <p>${escapeHtml(row.text)}</p>` : "";
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

async function homePayload(c: AppContext, base: string): Promise<SeoPayload> {
  const rows = await c.env.DB.prepare(
    `SELECT t.id, t.public_id AS publicId, t.title, t.content, t.reply_count AS replyCount, t.views, t.last_post_at AS lastPostAt,
      c.name AS categoryName, c.public_id AS categoryPublicId, u.display_name AS authorName
    FROM threads t
    INNER JOIN categories c ON c.id = t.category_id
    INNER JOIN users u ON u.id = t.user_id
    ORDER BY t.pinned DESC, t.last_post_at DESC`,
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
    title: `Threads — ${SITE_NAME}`,
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
    ),
  };
}

async function threadPayload(c: AppContext, base: string, id: string): Promise<SeoPayload | null> {
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
      `SELECT p.content, p.created_at AS createdAt, u.username, u.display_name AS authorName
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
  const description = cleanText(thread.content, 160) || `${title} discussion in ${thread.categoryName}.`;
  const schemas: SeoSchema[] = [
    breadcrumbSchema(base, [
      { name: "Forum", path: "/" },
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
      articleSection: String(thread.categoryName),
      keywords: tags.map((tag) => String(tag.name)).join(", ") || undefined,
      datePublished: isoDate(thread.createdAt),
      dateModified: isoDate(thread.lastPostAt ?? thread.updatedAt ?? thread.createdAt),
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
      comment: replies.map((reply) => ({
        "@type": "Comment",
        text: cleanText(reply.content, 1000),
        dateCreated: isoDate(reply.createdAt),
        author: {
          "@type": "Person",
          name: String(reply.authorName),
          url: absoluteUrl(base, `/u/${reply.username}`),
        },
      })),
    },
  ];

  return {
    title: `${title} — ${SITE_NAME}`,
    description,
    canonicalPath: path,
    type: "article",
    imagePath: `/og/thread/${thread.publicId}.webp`,
    imageAlt: `${title} — ${SITE_NAME}`,
    schemas,
    contentHtml: seoBlock(
      title,
      description,
      replies.map((reply) => ({
        title: `${reply.authorName} reply`,
        path,
        text: cleanText(reply.content, 180),
      })),
    ),
  };
}

async function categoryPayload(c: AppContext, base: string, id: string): Promise<SeoPayload | null> {
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
  const description = cleanText(category.description, 160) || `${name} forum discussions and threads.`;
  const path = `/c/${category.publicId}`;
  const items = threads.map((thread) => ({ name: String(thread.title), path: `/t/${thread.publicId}` }));
  return {
    title: `${name} — ${SITE_NAME}`,
    description,
    canonicalPath: path,
    schemas: [
      breadcrumbSchema(base, [
        { name: "Forum", path: "/" },
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
    ),
  };
}

async function membersPayload(c: AppContext, base: string): Promise<SeoPayload> {
  const rows = await c.env.DB.prepare(
    `SELECT username, display_name AS displayName, bio, post_count AS postCount, thread_count AS threadCount
     FROM users
     ORDER BY post_count DESC, id DESC`,
  ).all<Record<string, unknown>>();
  const total = await c.env.DB.prepare("SELECT COUNT(*) AS total FROM users").first<{ total: number }>();
  const users = rows.results ?? [];
  const description = `Browse FSTDESK Forum members, authors, moderators and food technology contributors.`;
  const items = users.map((user) => ({ name: String(user.displayName), path: `/u/${user.username}` }));
  return {
    title: `Members — ${SITE_NAME}`,
    description,
    canonicalPath: "/members",
    schemas: [
      breadcrumbSchema(base, [
        { name: "Forum", path: "/" },
        { name: "Members", path: "/members" },
      ]),
      {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: "Forum Members",
        url: `${base}/members`,
        description,
        inLanguage: CONTENT_LANGUAGE,
        numberOfItems: Number(total?.total ?? users.length),
      },
      itemListSchema(base, items),
    ],
    contentHtml: seoBlock(
      "Forum Members",
      description,
      users.map((user) => ({
        title: `${user.displayName} (@${user.username})`,
        path: `/u/${user.username}`,
        text: cleanText(user.bio, 140) || `${user.postCount ?? 0} replies, ${user.threadCount ?? 0} threads.`,
      })),
    ),
  };
}

async function memberPayload(c: AppContext, base: string, username: string): Promise<SeoPayload | null> {
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
    `${displayName} (@${user.username}) on FSTDESK Forum: ${user.postCount ?? 0} replies and ${user.threadCount ?? 0} threads.`;
  return {
    title: `${displayName} — ${SITE_NAME}`,
    description,
    canonicalPath: path,
    type: "profile",
    schemas: [
      breadcrumbSchema(base, [
        { name: "Forum", path: "/" },
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
    ),
  };
}

async function tagsPayload(c: AppContext, base: string): Promise<SeoPayload> {
  const rows = await c.env.DB.prepare(
    `SELECT tags.name, tags.slug, COUNT(thread_tags.thread_id) AS threadCount
     FROM tags
     LEFT JOIN thread_tags ON thread_tags.tag_id = tags.id
     GROUP BY tags.id
     ORDER BY threadCount DESC, tags.name ASC`,
  ).all<Record<string, unknown>>();
  const tags = rows.results ?? [];
  const description = "Browse FSTDESK Forum tags across food science, food safety and product development topics.";
  return {
    title: `Tags — ${SITE_NAME}`,
    description,
    canonicalPath: "/tags",
    schemas: [
      breadcrumbSchema(base, [
        { name: "Forum", path: "/" },
        { name: "Tags", path: "/tags" },
      ]),
      {
        "@context": "https://schema.org",
        "@type": "DefinedTermSet",
        name: "Forum Tags",
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
      "Forum Tags",
      description,
      tags.map((tag) => ({
        title: `#${tag.name}`,
        path: `/tag/${tag.slug}`,
        text: `${tag.threadCount ?? 0} threads`,
      })),
    ),
  };
}

async function tagPayload(c: AppContext, base: string, slug: string): Promise<SeoPayload | null> {
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
  const description = `Forum discussions tagged ${name}. Browse ${Number(total?.total ?? threads.length)} related threads.`;
  return {
    title: `#${name} — ${SITE_NAME}`,
    description,
    canonicalPath: path,
    schemas: [
      breadcrumbSchema(base, [
        { name: "Forum", path: "/" },
        { name: "Tags", path: "/tags" },
        { name: `#${name}`, path },
      ]),
      {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: `#${name} Forum Threads`,
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
    ),
  };
}

async function payloadForPath(c: AppContext, base: string, pathname: string): Promise<SeoPayload> {
  const parts = pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
  if (pathname === "/") return homePayload(c, base);
  if (parts[0] === "t" && parts[1]) return (await threadPayload(c, base, parts[1])) ?? notFoundPayload(pathname, "Thread not found");
  if (parts[0] === "c" && parts[1]) return (await categoryPayload(c, base, parts[1])) ?? notFoundPayload(pathname, "Category not found");
  if (parts[0] === "members" && parts.length === 1) return membersPayload(c, base);
  if (parts[0] === "u" && parts[1]) return (await memberPayload(c, base, parts[1])) ?? notFoundPayload(pathname, "Member not found");
  if (parts[0] === "tags" && parts.length === 1) return tagsPayload(c, base);
  if (parts[0] === "tag" && parts[1]) return (await tagPayload(c, base, parts[1])) ?? notFoundPayload(pathname, "Tag not found");
  if (["admin", "login", "register", "new-thread", "search"].includes(parts[0] ?? "")) return noindexPayload(pathname);
  return notFoundPayload(pathname);
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
    .replace(/^[ \t]*<meta\s+(?:name|property)="(?:description|robots|application-name|twitter:card|twitter:title|twitter:description|twitter:image|twitter:image:alt|og:site_name|og:type|og:title|og:description|og:url|og:image|og:image:secure_url|og:image:type|og:image:width|og:image:height|og:image:alt|og:locale)"[^>]*>[ \t]*\r?\n?/gim, "")
    .replace(/^[ \t]*<meta\s+http-equiv="content-language"[^>]*>[ \t]*\r?\n?/gim, "")
    .replace(/^[ \t]*<link\s+rel="canonical"[^>]*>[ \t]*\r?\n?/gim, "")
    .replace(/\n{3,}/g, "\n\n");
}

function metaHtml(payload: SeoPayload, base: string): string {
  const canonical = absoluteUrl(base, payload.canonicalPath);
  const fullTitle = payload.title.includes(SITE_NAME) ? payload.title : `${payload.title} — ${SITE_NAME}`;
  const imagePath = payload.imagePath ?? DEFAULT_IMAGE;
  const image = absoluteUrl(base, imagePath);
  const imageType = imagePath.toLowerCase().endsWith(".webp") ? "image/webp" : "image/svg+xml";
  const imageAlt = payload.imageAlt ?? fullTitle;
  const schemas = [...rootSchemas(base), ...(payload.schemas ?? [])];
  return [
    `<title>${escapeHtml(fullTitle)}</title>`,
    `<meta name="description" content="${escapeHtml(payload.description)}" />`,
    `<meta name="robots" content="${escapeHtml(payload.robots ?? "index,follow")}" />`,
    `<meta name="application-name" content="${escapeHtml(SITE_NAME)}" />`,
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
    const threads = await loadThreadsApi(c, { sort: "recent", all: true });
    queries.push({ key: ["threads", "all", "recent", "all"], data: threads });
  } else if (parts[0] === "c" && parts[1]) {
    const sort = url.searchParams.get("sort") ?? "recent";
    const category = await loadCategoryApi(c, parts[1]);
    if (category) {
      const threads = await loadThreadsApi(c, { categoryId: category.id, sort, all: true });
      queries.push({ key: ["category", parts[1]], data: category });
      queries.push({ key: ["threads", "cat", parts[1], sort, "all"], data: threads });
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
    const members = await loadMembersApi(c, sort);
    queries.push({ key: ["members", sort, "all"], data: members });
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

function staticShellHtml(contentHtml: string, pathname: string, categories: ApiCategory[]): string {
  const page = pathname === "/" ? "threads" : pathname.replace("/", "").split("/")[0] || "threads";
  return [
    '<div class="gb-shell" data-server-rendered="seo-shell">',
    '<div class="gb-tabline">',
    '<div class="gb-tabline-left">',
    '<button class="gb-hamburger" title="Menu" aria-label="Open sidebar"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>',
    '<div class="gb-tab active" style="padding-left:12px"><a href="/" style="color:var(--gb-yellow);font-weight:700;text-decoration:none">FSTDESK</a></div>',
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

function injectHtml(indexHtml: string, payload: SeoPayload, base: string, url: URL, bootstrap: BootstrapBuild): string {
  const withCleanHead = stripFallbackHead(indexHtml);
  const seoMeta = metaHtml(payload, base);
  const bootstrapScript = `<script id="__FSTDESK_BOOTSTRAP__" type="application/json">${escapeJsonScript(bootstrap.payload)}</script>`;
  const withMeta = /<meta\s+name="theme-color"[^>]*>\s*/i.test(withCleanHead)
    ? withCleanHead.replace(/(<meta\s+name="theme-color"[^>]*>\s*)/i, `$1\n    ${seoMeta}\n`)
    : withCleanHead.replace("<head>", `<head>\n    ${seoMeta}`);
  const content = payload.contentHtml ?? seoBlock(SITE_NAME, payload.description);
  return withMeta.replace(
    /<div id="root"><\/div>/,
    `<div id="root">${staticShellHtml(content, url.pathname, bootstrap.categories)}</div>\n    ${bootstrapScript}`,
  );
}

export async function renderSeoHtml(c: AppContext): Promise<Response> {
  if (!shouldRenderHtml(c)) return c.env.ASSETS.fetch(c.req.raw);

  const assetResponse = await c.env.ASSETS.fetch(c.req.raw);
  const contentType = assetResponse.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return assetResponse;

  const url = new URL(c.req.url);
  const base = `${url.protocol}//${url.host}`;
  const [payload, bootstrap] = await Promise.all([
    payloadForPath(c, base, url.pathname),
    bootstrapForUrl(c, url),
  ]);
  const html = injectHtml(await assetResponse.text(), payload, base, url, bootstrap);
  const headers = new Headers(assetResponse.headers);
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("cache-control", payload.robots?.startsWith("noindex") ? "public, max-age=0, must-revalidate" : "public, max-age=60");
  headers.set("vary", "Accept");
  return new Response(html, { status: payload.status ?? assetResponse.status, headers });
}
