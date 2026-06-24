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

const SITE_NAME = "FSTDESK Forum";
const SITE_DESCRIPTION = "Food science, food safety, product development and food technology forum discussions.";
const HTML_LANG = "en";
const CONTENT_LANGUAGE = "en-US";
const OG_LOCALE = "en_US";
const DEFAULT_IMAGE = "/og/default.webp";

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

function seoBlock(title: string, body: string, rows: Array<{ title: string; path: string; text?: string }> = []): string {
  const items = rows
    .map((row) => {
      const text = row.text ? `<p>${escapeHtml(row.text)}</p>` : "";
      return `<li><a href="${escapeHtml(row.path)}">${escapeHtml(row.title)}</a>${text}</li>`;
    })
    .join("");
  return [
    '<main id="seo-content" data-server-rendered="seo">',
    `<h1>${escapeHtml(title)}</h1>`,
    body ? `<p>${escapeHtml(body)}</p>` : "",
    items ? `<ol>${items}</ol>` : "",
    "</main>",
  ].join("");
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
    ORDER BY t.pinned DESC, t.last_post_at DESC
    LIMIT 20`,
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
       ORDER BY p.created_at ASC
       LIMIT 8`,
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
     ORDER BY pinned DESC, last_post_at DESC
     LIMIT 20`,
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
     ORDER BY post_count DESC, id DESC
     LIMIT 24`,
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
    ORDER BY activityAt DESC
    LIMIT 12`,
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
     ORDER BY threadCount DESC, tags.name ASC
     LIMIT 100`,
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
     ORDER BY t.last_post_at DESC
     LIMIT 20`,
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

function injectHtml(indexHtml: string, payload: SeoPayload, base: string): string {
  const withCleanHead = stripFallbackHead(indexHtml);
  const seoMeta = metaHtml(payload, base);
  const withMeta = /<meta\s+name="theme-color"[^>]*>\s*/i.test(withCleanHead)
    ? withCleanHead.replace(/(<meta\s+name="theme-color"[^>]*>\s*)/i, `$1\n    ${seoMeta}\n`)
    : withCleanHead.replace("<head>", `<head>\n    ${seoMeta}`);
  const content = payload.contentHtml ?? seoBlock(SITE_NAME, payload.description);
  return withMeta.replace(/<div id="root"><\/div>/, `<div id="root">${content}</div>`);
}

export async function renderSeoHtml(c: AppContext): Promise<Response> {
  if (!shouldRenderHtml(c)) return c.env.ASSETS.fetch(c.req.raw);

  const assetResponse = await c.env.ASSETS.fetch(c.req.raw);
  const contentType = assetResponse.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return assetResponse;

  const url = new URL(c.req.url);
  const base = `${url.protocol}//${url.host}`;
  const payload = await payloadForPath(c, base, url.pathname);
  const html = injectHtml(await assetResponse.text(), payload, base);
  const headers = new Headers(assetResponse.headers);
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("cache-control", payload.robots?.startsWith("noindex") ? "public, max-age=0, must-revalidate" : "public, max-age=60");
  headers.set("vary", "Accept");
  return new Response(html, { status: payload.status ?? assetResponse.status, headers });
}
