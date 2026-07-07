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
import {
  LOCALIZED_LOCALES,
  LOCALE_DETAILS,
  localizedAlternates,
  localizePath,
  parseLocalePath,
  shouldLocalizePath,
  type SupportedLocale,
} from "../../shared/locales";

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
  localized?: {
    locale: SupportedLocale;
    translated: boolean;
    status: "complete" | "queued" | "running" | "error" | "disabled" | "missing";
    sourceHash?: string;
    error?: string | null;
  };
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
const CONTENT_LANGUAGE = LOCALE_DETAILS.en.contentLanguage;
const DEFAULT_IMAGE = "/og/default.webp";
const CAT_COLORS = ["#b8bb26", "#83a598", "#fabd2f", "#d3869b", "#8ec07c", "#fe8019", "#fb4934", "#a89984"];
const MAX_SEO_ANCHOR_TERMS = 80;
const MAX_SEO_ANCHOR_TARGETS_PER_TERM = 20;
const MAX_SEO_ANCHORS_PER_BLOCK = 16;
const MEMBERS_SEO_LIMIT = 120;
const MEMBERS_BOOTSTRAP_PAGE_SIZE = 200;
const VALUABLE_THREAD_MIN_AGE_DAYS = 180;
const VALUABLE_THREAD_MIN_VIEWS = 500;
const VALUABLE_THREAD_MIN_REPLIES = 3;
const BEST_DISCUSSIONS_LIMIT = 8;
const PUBLIC_HTML_BROWSER_TTL = 30;
const PUBLIC_HTML_EDGE_TTL = 180;
const TRANSLATION_DEFAULT_API_URL = "https://api.openai.com/v1/chat/completions";
const TRANSLATION_DEFAULT_MODEL = "gpt-4o-mini";
const TRANSLATION_JOB_LOCK_SECONDS = 300;
const TRANSLATION_MAX_ATTEMPTS = 3;
const TRANSLATION_MAX_TEXTS_PER_PAGE = 240;
const TRANSLATION_TEXT_CHUNK_SIZE = 32;
const TRANSLATION_STATIC_PATHS = ["/", "/members", "/tags", "/what-is-fstdesk", "/contact", "/about"];

type TranslationJobMessage = { jobId?: string; locale?: string; path?: string };

type TranslationSettings = {
  enabled: boolean;
  provider: string;
  apiUrl: string;
  model: string;
  batchLimit: number;
  configured: boolean;
};

type TranslationRow = {
  locale: string;
  path: string;
  source_hash: string;
  title: string;
  description: string;
  content_html: string;
  schemas_json: string | null;
  article_section: string | null;
  article_tags_json: string | null;
  status: string;
  error: string | null;
};

type TranslationJobRow = {
  id: string;
  locale: string;
  path: string;
  source_hash: string;
  status: string;
  attempts: number;
};

let translationSchemaReady = false;
let translationSchemaPromise: Promise<void> | null = null;

const nowSeconds = () => Math.floor(Date.now() / 1000);

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

function absoluteLocalizedUrl(base: string, path: string, locale: SupportedLocale): string {
  return absoluteUrl(base, localizePath(path || "/", locale));
}

function safeDecodePathParts(pathname: string): string[] {
  return pathname.split("/").filter(Boolean).map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  });
}

function localizeHtmlLinks(html: string, locale: SupportedLocale): string {
  if (!html || locale === "en") return html;
  return html.replace(/\s(href|action)="(\/[^"]*)"/g, (match, attr: string, raw: string) => {
    if (raw.startsWith("//") || !shouldLocalizePath(raw)) return match;
    return ` ${attr}="${escapeHtml(localizePath(raw, locale))}"`;
  });
}

function localizeSchemaValue(value: unknown, base: string, locale: SupportedLocale): unknown {
  if (Array.isArray(value)) return value.map((item) => localizeSchemaValue(item, base, locale));
  if (!value || typeof value !== "object") {
    if (typeof value !== "string") return value;
    if (value.startsWith(`${base}/`)) {
      try {
        const url = new URL(value);
        return `${url.origin}${localizePath(`${url.pathname}${url.search}${url.hash}`, locale)}`;
      } catch {
        return value;
      }
    }
    if (value.startsWith("/") && !value.startsWith("//")) return localizePath(value, locale);
    return value;
  }
  const details = LOCALE_DETAILS[locale];
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => {
      if (key === "inLanguage") return [key, details.contentLanguage];
      return [key, localizeSchemaValue(item, base, locale)];
    }),
  );
}

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function translationSourceHash(payload: SeoPayload): string {
  return hashString([
    payload.title,
    payload.description,
    payload.articleSection ?? "",
    ...(payload.articleTags ?? []),
    payload.contentHtml ?? "",
    JSON.stringify(payload.schemas ?? []),
  ].join("\n")).toString(16).padStart(8, "0");
}

async function ensureTranslationSchema(db: D1Database): Promise<void> {
  if (translationSchemaReady) return;
  if (translationSchemaPromise) return translationSchemaPromise;
  translationSchemaPromise = (async () => {
    await db.prepare(`CREATE TABLE IF NOT EXISTS content_translations (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      locale text NOT NULL,
      path text NOT NULL,
      source_hash text NOT NULL,
      title text NOT NULL,
      description text NOT NULL,
      content_html text NOT NULL,
      schemas_json text,
      article_section text,
      article_tags_json text,
      provider text,
      model text,
      status text NOT NULL DEFAULT 'complete',
      error text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    )`).run();
    await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS content_translations_locale_path_hash_idx ON content_translations(locale, path, source_hash)").run();
    await db.prepare("CREATE INDEX IF NOT EXISTS content_translations_locale_path_status_idx ON content_translations(locale, path, status)").run();
    await db.prepare("CREATE INDEX IF NOT EXISTS content_translations_updated_at_idx ON content_translations(updated_at)").run();
    await db.prepare(`CREATE TABLE IF NOT EXISTS translation_jobs (
      id text PRIMARY KEY NOT NULL,
      locale text NOT NULL,
      path text NOT NULL,
      source_hash text NOT NULL,
      status text NOT NULL DEFAULT 'queued',
      attempts integer NOT NULL DEFAULT 0,
      locked_until integer,
      error_message text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      finished_at integer
    )`).run();
    await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS translation_jobs_locale_path_hash_idx ON translation_jobs(locale, path, source_hash)").run();
    await db.prepare("CREATE INDEX IF NOT EXISTS translation_jobs_status_idx ON translation_jobs(status, updated_at)").run();
    await db.prepare("CREATE INDEX IF NOT EXISTS translation_jobs_locked_until_idx ON translation_jobs(locked_until)").run();
    translationSchemaReady = true;
  })().finally(() => {
    translationSchemaPromise = null;
  });
  return translationSchemaPromise;
}

async function translationSettings(env: Bindings): Promise<TranslationSettings> {
  const rows = await env.DB.prepare("SELECT key, value FROM settings WHERE key LIKE 'translation_%'").all<Record<string, unknown>>();
  const settings: Record<string, string> = {};
  for (const row of rows.results ?? []) settings[String(row.key ?? "")] = String(row.value ?? "");
  const provider = (settings.translation_provider || "openai_compatible").trim().toLowerCase();
  const apiUrl = (settings.translation_api_url || env.TRANSLATION_API_URL || TRANSLATION_DEFAULT_API_URL).trim();
  const model = (settings.translation_model || env.TRANSLATION_MODEL || TRANSLATION_DEFAULT_MODEL).trim();
  const batchLimit = Math.max(1, Math.min(25, Number(settings.translation_batch_limit || 4) || 4));
  const enabled = settings.translation_enabled !== "false" && provider !== "disabled";
  return {
    enabled,
    provider,
    apiUrl,
    model,
    batchLimit,
    configured: enabled && Boolean(env.TRANSLATION_API_KEY && apiUrl && model),
  };
}

async function translationSiteBase(env: Bindings): Promise<string> {
  if (env.SITE_URL) return env.SITE_URL.replace(/\/+$/, "");
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'site_url' LIMIT 1").first<{ value: string }>();
  return (row?.value || "https://fstdesk.com").replace(/\/+$/, "");
}

function translationJobId(locale: SupportedLocale, path: string, sourceHash: string): string {
  return `tr_${locale}_${hashString(`${locale}:${path}:${sourceHash}:${Date.now()}:${Math.random()}`).toString(16)}`;
}

function decodeHtmlText(input: string): string {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'");
}

function significantTranslatableText(input: string): string {
  const text = decodeHtmlText(input).replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (/^[\d\s,.:;!?()[\]{}#+/@|→←$%&*'"-]+$/.test(text)) return "";
  return text;
}

type HtmlTextSegment = {
  partIndex: number;
  leading: string;
  trailing: string;
  text: string;
};

function splitHtmlTextSegments(html: string): { parts: string[]; segments: HtmlTextSegment[] } {
  const parts = html.split(/(<[^>]+>)/g);
  const segments: HtmlTextSegment[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part || part.startsWith("<")) continue;
    const text = significantTranslatableText(part);
    if (!text) continue;
    const leading = part.match(/^\s*/)?.[0] ?? "";
    const trailing = part.match(/\s*$/)?.[0] ?? "";
    const core = part.slice(leading.length, Math.max(leading.length, part.length - trailing.length));
    segments.push({ partIndex: i, leading, trailing, text: decodeHtmlText(core).trim() });
  }
  return { parts, segments };
}

function rebuildHtmlWithTranslations(parts: string[], segments: HtmlTextSegment[], translations: Map<string, string>): string {
  for (const segment of segments) {
    const translated = translations.get(segment.text);
    if (translated) parts[segment.partIndex] = `${segment.leading}${escapeHtml(translated)}${segment.trailing}`;
  }
  return parts.join("");
}

function isSchemaTranslatableString(value: string): boolean {
  if (!significantTranslatableText(value)) return false;
  if (/^(https?:)?\/\//i.test(value) || value.startsWith("/") || value.startsWith("#")) return false;
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return false;
  if (/^https:\/\/schema\.org\//i.test(value)) return false;
  if (/^[A-Za-z]+Page$|^[A-Za-z]+Posting$|^ListItem$|^Person$|^Organization$|^Comment$|^EntryPoint$/.test(value)) return false;
  return true;
}

function collectSchemaTexts(value: unknown, out: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectSchemaTexts(item, out);
    return;
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && isSchemaTranslatableString(value)) out.add(value);
    return;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key.startsWith("@") || key === "url" || key === "item" || key === "image" || key === "inLanguage") continue;
    collectSchemaTexts(item, out);
  }
}

function translateSchemaTexts(value: unknown, translations: Map<string, string>): unknown {
  if (Array.isArray(value)) return value.map((item) => translateSchemaTexts(item, translations));
  if (!value || typeof value !== "object") {
    if (typeof value === "string") return translations.get(value) ?? value;
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => {
      if (key.startsWith("@") || key === "url" || key === "item" || key === "image" || key === "inLanguage") return [key, item];
      return [key, translateSchemaTexts(item, translations)];
    }),
  );
}

function parseTranslationContent(raw: string): string[] {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const parsed = JSON.parse(cleaned);
  const items = Array.isArray(parsed?.items) ? parsed.items : Array.isArray(parsed) ? parsed : [];
  return items.map((item: unknown) => String(item ?? ""));
}

async function translateTextChunk(env: Bindings, settings: TranslationSettings, locale: SupportedLocale, texts: string[]): Promise<string[]> {
  if (!texts.length) return [];
  const details = LOCALE_DETAILS[locale];
  const response = await fetch(settings.apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.TRANSLATION_API_KEY}`,
    },
    body: JSON.stringify({
      model: settings.model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            `Translate FSTDESK forum content to ${details.label}.`,
            "Return only JSON with an items array matching the input length and order.",
            "Preserve HTML-free text only; do not add markup.",
            "Preserve URLs, emails, numbers, hashtags, usernames, product names, FSTDESK, ManuFox and Brix.",
            "Use natural technical food-science language.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({ locale, language: details.label, items: texts }),
        },
      ],
    }),
  });
  const json = await response.json().catch(() => null) as any;
  if (!response.ok) {
    const message = json?.error?.message || json?.message || `translation provider ${response.status}`;
    throw new Error(String(message).slice(0, 1000));
  }
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("translation provider returned no content");
  const translated = parseTranslationContent(content);
  if (translated.length !== texts.length) throw new Error(`translation count mismatch: ${translated.length}/${texts.length}`);
  return translated;
}

async function translateTexts(env: Bindings, settings: TranslationSettings, locale: SupportedLocale, texts: string[]) {
  const translated = new Map<string, string>();
  const unique = Array.from(new Set(texts.map((text) => text.trim()).filter(Boolean))).slice(0, TRANSLATION_MAX_TEXTS_PER_PAGE);
  for (let i = 0; i < unique.length; i += TRANSLATION_TEXT_CHUNK_SIZE) {
    const chunk = unique.slice(i, i + TRANSLATION_TEXT_CHUNK_SIZE);
    const result = await translateTextChunk(env, settings, locale, chunk);
    chunk.forEach((source, index) => translated.set(source, result[index] || source));
  }
  return translated;
}

async function translatePayload(env: Bindings, payload: SeoPayload, locale: SupportedLocale, settings: TranslationSettings): Promise<SeoPayload> {
  const html = payload.contentHtml ?? "";
  const { parts, segments } = splitHtmlTextSegments(html);
  const schemaTexts = new Set<string>();
  for (const schema of payload.schemas ?? []) collectSchemaTexts(schema, schemaTexts);
  const texts = [
    payload.title,
    payload.description,
    payload.articleSection ?? "",
    ...(payload.articleTags ?? []),
    ...segments.map((segment) => segment.text),
    ...schemaTexts,
  ].filter(Boolean);
  const translations = await translateTexts(env, settings, locale, texts);
  const translatedSchemas = (payload.schemas ?? []).map((schema) => translateSchemaTexts(schema, translations) as SeoSchema);
  return {
    ...payload,
    title: translations.get(payload.title) ?? payload.title,
    description: translations.get(payload.description) ?? payload.description,
    articleSection: payload.articleSection ? translations.get(payload.articleSection) ?? payload.articleSection : payload.articleSection,
    articleTags: (payload.articleTags ?? []).map((tag) => translations.get(tag) ?? tag),
    schemas: translatedSchemas,
    contentHtml: rebuildHtmlWithTranslations(parts, segments, translations),
    localized: { locale, translated: true, status: "complete", sourceHash: translationSourceHash(payload) },
  };
}

function applyStoredTranslation(payload: SeoPayload, locale: SupportedLocale, row: TranslationRow): SeoPayload {
  let schemas = payload.schemas;
  let articleTags = payload.articleTags;
  try {
    if (row.schemas_json) schemas = JSON.parse(row.schemas_json);
  } catch {
    schemas = payload.schemas;
  }
  try {
    if (row.article_tags_json) articleTags = JSON.parse(row.article_tags_json);
  } catch {
    articleTags = payload.articleTags;
  }
  return {
    ...payload,
    title: row.title,
    description: row.description,
    contentHtml: row.content_html,
    schemas,
    articleSection: row.article_section ?? payload.articleSection,
    articleTags,
    localized: { locale, translated: true, status: "complete", sourceHash: row.source_hash },
  };
}

async function storePayloadTranslation(
  env: Bindings,
  locale: SupportedLocale,
  path: string,
  sourceHash: string,
  payload: SeoPayload,
  settings: TranslationSettings,
): Promise<void> {
  const now = nowSeconds();
  await env.DB.prepare(
    `INSERT INTO content_translations (
      locale, path, source_hash, title, description, content_html, schemas_json, article_section, article_tags_json,
      provider, model, status, error, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'complete', NULL, ?, ?)
    ON CONFLICT(locale, path, source_hash) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      content_html = excluded.content_html,
      schemas_json = excluded.schemas_json,
      article_section = excluded.article_section,
      article_tags_json = excluded.article_tags_json,
      provider = excluded.provider,
      model = excluded.model,
      status = 'complete',
      error = NULL,
      updated_at = excluded.updated_at`,
  ).bind(
    locale,
    path,
    sourceHash,
    payload.title,
    payload.description,
    payload.contentHtml ?? "",
    JSON.stringify(payload.schemas ?? []),
    payload.articleSection ?? null,
    JSON.stringify(payload.articleTags ?? []),
    settings.provider,
    settings.model,
    now,
    now,
  ).run();
}

async function queueTranslationJob(
  env: Bindings,
  ctx: ExecutionContext,
  locale: SupportedLocale,
  path: string,
  sourceHash: string,
): Promise<void> {
  const now = nowSeconds();
  const id = translationJobId(locale, path, sourceHash);
  await env.DB.prepare(
    `INSERT INTO translation_jobs (id, locale, path, source_hash, status, attempts, locked_until, error_message, created_at, updated_at, finished_at)
     VALUES (?, ?, ?, ?, 'queued', 0, NULL, NULL, ?, ?, NULL)
     ON CONFLICT(locale, path, source_hash) DO UPDATE SET
       status = CASE WHEN translation_jobs.status = 'complete' THEN translation_jobs.status ELSE 'queued' END,
       attempts = CASE WHEN translation_jobs.status = 'complete' THEN translation_jobs.attempts ELSE 0 END,
       locked_until = CASE WHEN translation_jobs.status = 'complete' THEN translation_jobs.locked_until ELSE NULL END,
       error_message = CASE WHEN translation_jobs.status = 'complete' THEN translation_jobs.error_message ELSE NULL END,
       finished_at = CASE WHEN translation_jobs.status = 'complete' THEN translation_jobs.finished_at ELSE NULL END,
       updated_at = excluded.updated_at`,
  ).bind(id, locale, path, sourceHash, now, now).run();

  const message: TranslationJobMessage = { locale, path };
  if (env.TRANSLATION_QUEUE) {
    ctx.waitUntil(
      env.TRANSLATION_QUEUE.send(message).catch((error) => {
        console.warn("translation_queue_send_failed", locale, path, error instanceof Error ? error.message : String(error));
        return processTranslationJobs(env, ctx, { locale, path, limit: 1 });
      }),
    );
  } else {
    ctx.waitUntil(processTranslationJobs(env, ctx, { locale, path, limit: 1 }));
  }
}

async function applyTranslationOrQueue(
  c: AppContext,
  payload: SeoPayload,
  locale: SupportedLocale,
  path: string,
): Promise<SeoPayload> {
  if (locale === "en" || payload.status === 404 || payload.robots?.includes("noindex")) {
    return payload;
  }
  await ensureTranslationSchema(c.env.DB);
  const sourceHash = translationSourceHash(payload);
  const row = await c.env.DB.prepare(
    `SELECT locale, path, source_hash, title, description, content_html, schemas_json, article_section, article_tags_json, status, error
     FROM content_translations
     WHERE locale = ? AND path = ? AND source_hash = ? AND status = 'complete'
     LIMIT 1`,
  ).bind(locale, path, sourceHash).first<TranslationRow>();
  if (row) return applyStoredTranslation(payload, locale, row);

  const settings = await translationSettings(c.env);
  if (settings.configured) {
    await queueTranslationJob(c.env, c.executionCtx, locale, path, sourceHash);
    return { ...payload, localized: { locale, translated: false, status: "queued", sourceHash } };
  }
  return {
    ...payload,
    localized: {
      locale,
      translated: false,
      status: settings.enabled ? "missing" : "disabled",
      sourceHash,
      error: settings.enabled ? "translation provider is not configured" : null,
    },
  };
}

async function loadQueuedTranslationJobs(
  env: Bindings,
  opts: { locale?: string; path?: string; jobId?: string; limit?: number } = {},
): Promise<TranslationJobRow[]> {
  const now = nowSeconds();
  const limit = Math.max(1, Math.min(25, Number(opts.limit || 4) || 4));
  if (opts.jobId) {
    const row = await env.DB.prepare(
      `SELECT id, locale, path, source_hash, status, attempts
       FROM translation_jobs
       WHERE id = ? AND status <> 'complete'
       LIMIT 1`,
    ).bind(opts.jobId).first<TranslationJobRow>();
    return row ? [row] : [];
  }
  if (opts.locale && opts.path) {
    const rows = await env.DB.prepare(
      `SELECT id, locale, path, source_hash, status, attempts
       FROM translation_jobs
       WHERE locale = ? AND path = ? AND status <> 'complete'
       ORDER BY updated_at ASC
       LIMIT ?`,
    ).bind(opts.locale, opts.path, limit).all<TranslationJobRow>();
    return rows.results ?? [];
  }
  const rows = await env.DB.prepare(
    `SELECT id, locale, path, source_hash, status, attempts
     FROM translation_jobs
     WHERE status IN ('queued', 'error')
       AND attempts < ?
       AND (locked_until IS NULL OR locked_until < ?)
     ORDER BY updated_at ASC
     LIMIT ?`,
  ).bind(TRANSLATION_MAX_ATTEMPTS, now, limit).all<TranslationJobRow>();
  return rows.results ?? [];
}

export async function processTranslationJobs(
  env: Bindings,
  ctx?: ExecutionContext,
  opts: { jobId?: string; locale?: string; path?: string; limit?: number } = {},
) {
  await ensureTranslationSchema(env.DB);
  const settings = await translationSettings(env);
  if (!settings.configured) return { ok: false, processed: 0, complete: 0, error: 0, reason: "translation provider is not configured" };

  const jobs = await loadQueuedTranslationJobs(env, { ...opts, limit: opts.limit ?? settings.batchLimit });
  if (!jobs.length) return { ok: true, processed: 0, complete: 0, error: 0 };

  const base = await translationSiteBase(env);
  let complete = 0;
  let error = 0;
  for (const job of jobs) {
    const locale = job.locale as SupportedLocale;
    if (!LOCALIZED_LOCALES.includes(locale)) {
      await env.DB.prepare("UPDATE translation_jobs SET status = 'error', error_message = ?, updated_at = ? WHERE id = ?")
        .bind(`unsupported locale ${job.locale}`, nowSeconds(), job.id).run();
      error += 1;
      continue;
    }
    const now = nowSeconds();
    await env.DB.prepare(
      "UPDATE translation_jobs SET status = 'running', attempts = attempts + 1, locked_until = ?, updated_at = ? WHERE id = ?",
    ).bind(now + TRANSLATION_JOB_LOCK_SECONDS, now, job.id).run();
    try {
      const fakeContext = { env } as AppContext;
      const sourcePayload = await payloadForPath(fakeContext, base, job.path, []);
      const sourceHash = translationSourceHash(sourcePayload);
      const translated = await translatePayload(env, sourcePayload, locale, settings);
      await storePayloadTranslation(env, locale, job.path, sourceHash, translated, settings);
      await env.DB.prepare(
        "UPDATE translation_jobs SET status = 'complete', locked_until = NULL, error_message = NULL, updated_at = ?, finished_at = ? WHERE id = ?",
      ).bind(nowSeconds(), nowSeconds(), job.id).run();
      complete += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await env.DB.prepare(
        "UPDATE translation_jobs SET status = 'error', locked_until = NULL, error_message = ?, updated_at = ? WHERE id = ?",
      ).bind(message.slice(0, 1000), nowSeconds(), job.id).run();
      console.warn("translation_job_failed", locale, job.path, message);
      error += 1;
    }
  }
  return { ok: error === 0, processed: jobs.length, complete, error };
}

export async function translationPipelineStatus(env: Bindings) {
  await ensureTranslationSchema(env.DB);
  const settings = await translationSettings(env);
  const [jobs, translations, recentErrors, jobsByLocale, recentJobs] = await Promise.all([
    env.DB.prepare("SELECT status, COUNT(*) AS count FROM translation_jobs GROUP BY status").all<Record<string, unknown>>(),
    env.DB.prepare("SELECT locale, COUNT(*) AS count FROM content_translations WHERE status = 'complete' GROUP BY locale").all<Record<string, unknown>>(),
    env.DB.prepare(
      `SELECT locale, path, error_message AS error, updated_at AS updatedAt
       FROM translation_jobs
       WHERE status = 'error'
       ORDER BY updated_at DESC
       LIMIT 8`,
    ).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT locale, status, COUNT(*) AS count FROM translation_jobs GROUP BY locale, status").all<Record<string, unknown>>(),
    env.DB.prepare(
      `SELECT locale, path, status, attempts, error_message AS error, created_at AS createdAt, updated_at AS updatedAt, finished_at AS finishedAt
       FROM translation_jobs
       ORDER BY updated_at DESC
       LIMIT 24`,
    ).all<Record<string, unknown>>(),
  ]);
  const jobCounts: Record<string, number> = {};
  for (const row of jobs.results ?? []) jobCounts[String(row.status ?? "unknown")] = Number(row.count ?? 0);
  const completeByLocale: Record<string, number> = {};
  for (const row of translations.results ?? []) completeByLocale[String(row.locale ?? "")] = Number(row.count ?? 0);
  const localeJobCounts: Record<string, Record<string, number>> = {};
  for (const row of jobsByLocale.results ?? []) {
    const locale = String(row.locale ?? "");
    const status = String(row.status ?? "unknown");
    localeJobCounts[locale] = localeJobCounts[locale] ?? {};
    localeJobCounts[locale][status] = Number(row.count ?? 0);
  }
  const byLocale = LOCALIZED_LOCALES.map((locale) => ({
    locale,
    label: LOCALE_DETAILS[locale].label,
    queued: localeJobCounts[locale]?.queued ?? 0,
    running: localeJobCounts[locale]?.running ?? 0,
    complete: localeJobCounts[locale]?.complete ?? 0,
    error: localeJobCounts[locale]?.error ?? 0,
    translated: completeByLocale[locale] ?? 0,
  }));
  return {
    enabled: settings.enabled,
    configured: settings.configured,
    provider: settings.provider,
    model: settings.model,
    batchLimit: settings.batchLimit,
    queueBinding: Boolean(env.TRANSLATION_QUEUE),
    locales: LOCALIZED_LOCALES.map((locale) => ({
      locale,
      label: LOCALE_DETAILS[locale].label,
      complete: completeByLocale[locale] ?? 0,
    })),
    byLocale,
    jobs: {
      queued: jobCounts.queued ?? 0,
      running: jobCounts.running ?? 0,
      complete: jobCounts.complete ?? 0,
      error: jobCounts.error ?? 0,
    },
    errors: (recentErrors.results ?? []).map((row) => ({
      locale: String(row.locale ?? ""),
      path: String(row.path ?? ""),
      error: String(row.error ?? ""),
      updatedAt: Number(row.updatedAt ?? 0),
    })),
    recentJobs: (recentJobs.results ?? []).map((row) => ({
      locale: String(row.locale ?? ""),
      path: String(row.path ?? ""),
      status: String(row.status ?? ""),
      attempts: Number(row.attempts ?? 0),
      error: row.error == null ? null : String(row.error),
      createdAt: Number(row.createdAt ?? 0),
      updatedAt: Number(row.updatedAt ?? 0),
      finishedAt: row.finishedAt == null ? null : Number(row.finishedAt),
    })),
  };
}

async function candidateTranslationPaths(env: Bindings, limit: number): Promise<string[]> {
  const paths = new Set(TRANSLATION_STATIC_PATHS);
  const threadLimit = Math.max(1, limit);
  const [threads, categories, tags, users] = await Promise.all([
    env.DB.prepare(
      `SELECT public_id AS publicId
       FROM threads
       ORDER BY (COALESCE(views, 0) + COALESCE(reply_count, 0) * 80 + CASE WHEN featured THEN 500 ELSE 0 END) DESC, last_post_at DESC
       LIMIT ?`,
    ).bind(threadLimit).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT public_id AS publicId FROM categories ORDER BY position, id LIMIT 100").all<Record<string, unknown>>(),
    env.DB.prepare(
      `SELECT tags.slug
       FROM tags
       LEFT JOIN thread_tags ON thread_tags.tag_id = tags.id
       GROUP BY tags.id
       ORDER BY COUNT(thread_tags.thread_id) DESC, tags.name ASC
       LIMIT 100`,
    ).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT username FROM users ORDER BY post_count DESC, thread_count DESC, id DESC LIMIT 50").all<Record<string, unknown>>(),
  ]);
  for (const row of threads.results ?? []) if (row.publicId) paths.add(`/t/${row.publicId}`);
  for (const row of categories.results ?? []) if (row.publicId) paths.add(`/c/${row.publicId}`);
  for (const row of tags.results ?? []) if (row.slug) paths.add(`/tag/${encodeURIComponent(String(row.slug))}`);
  for (const row of users.results ?? []) if (row.username) paths.add(`/u/${encodeURIComponent(String(row.username))}`);
  return [...paths].slice(0, Math.max(1, limit + TRANSLATION_STATIC_PATHS.length + 250));
}

export async function queueMissingTranslations(
  env: Bindings,
  ctx: ExecutionContext,
  opts: { locale?: string; limit?: number } = {},
) {
  await ensureTranslationSchema(env.DB);
  const settings = await translationSettings(env);
  if (!settings.configured) return { ok: false, queued: 0, skipped: 0, total: 0, reason: "translation provider is not configured" };
  const locales = opts.locale && LOCALIZED_LOCALES.includes(opts.locale as SupportedLocale)
    ? [opts.locale as SupportedLocale]
    : [...LOCALIZED_LOCALES];
  const limit = Math.max(1, Math.min(500, Number(opts.limit || 100) || 100));
  const paths = await candidateTranslationPaths(env, limit);
  const base = await translationSiteBase(env);
  const fakeContext = { env } as AppContext;
  let queued = 0;
  let skipped = 0;
  for (const locale of locales) {
    for (const path of paths) {
      const payload = await payloadForPath(fakeContext, base, path, []);
      if (payload.status === 404 || payload.robots?.includes("noindex")) {
        skipped += 1;
        continue;
      }
      const sourceHash = translationSourceHash(payload);
      const existing = await env.DB.prepare(
        "SELECT 1 FROM content_translations WHERE locale = ? AND path = ? AND source_hash = ? AND status = 'complete' LIMIT 1",
      ).bind(locale, path, sourceHash).first();
      if (existing) {
        skipped += 1;
        continue;
      }
      await queueTranslationJob(env, ctx, locale, path, sourceHash);
      queued += 1;
    }
  }
  return { ok: true, queued, skipped, total: queued + skipped, locales, paths: paths.length };
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

function reviewedAtForThreadRow(row: Record<string, unknown>): string | null {
  const createdMs = dateMs(row.createdAt);
  if (Number.isNaN(createdMs)) return null;
  const ageDays = (Date.now() - createdMs) / 86_400_000;
  const views = Number(row.views ?? 0);
  const replies = Number(row.replyCount ?? 0);
  const featured = Boolean(row.featured);
  if (ageDays < VALUABLE_THREAD_MIN_AGE_DAYS) return null;
  if (!featured && views < VALUABLE_THREAD_MIN_VIEWS && replies < VALUABLE_THREAD_MIN_REPLIES) return null;
  return newestIsoDate(row.updatedAt, row.lastPostAt, row.createdAt);
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

async function loadAdsConfigApi(c: AppContext) {
  const rows = await c.env.DB.prepare("SELECT key, value FROM settings").all<Record<string, unknown>>();
  const settings: Record<string, string> = {};
  for (const row of rows.results ?? []) settings[String(row.key ?? "")] = String(row.value ?? "");

  const interval = (key: string, fallback: number) => {
    const value = Number(settings[key] || fallback);
    return Math.max(1, Math.min(50, Number.isFinite(value) ? value : fallback));
  };
  const desktopHtml = settings["ad_desktop_html"] || settings["ad_thread_html"] || "";
  const mobileHtml = settings["ad_mobile_html"] || desktopHtml;
  const sidebarHtml = settings["ad_sidebar_html"] || "";
  const disableAdsenseForAdmins = settings["ads_disable_adsense_for_admins"] !== "false";
  const postInterval = interval("ads_post_interval", 3);
  const desktopIntervals = {
    post: postInterval,
    topic: interval("ads_topic_interval", 7),
    user: interval("ads_user_interval", 7),
    tag: interval("ads_tag_interval", 7),
  };
  const mobileIntervals = {
    post: interval("ads_mobile_post_interval", desktopIntervals.post),
    topic: interval("ads_mobile_topic_interval", desktopIntervals.topic),
    user: interval("ads_mobile_user_interval", desktopIntervals.user),
    tag: interval("ads_mobile_tag_interval", desktopIntervals.tag),
  };

  return {
    enabled: settings["ads_enabled"] === "true",
    disableAdsenseForAdmins,
    adsenseSuppressedForAdmin: false,
    postInterval,
    adsenseClient: "",
    adsenseSlot: "",
    adsenseFormat: "",
    fullWidthResponsive: true,
    html: desktopHtml,
    desktop: { html: desktopHtml, intervals: desktopIntervals },
    mobile: { html: mobileHtml, intervals: mobileIntervals },
    sidebar: { html: sidebarHtml, width: 200, height: 200 },
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
    reviewedAt: reviewedAtForThreadRow(row),
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

async function loadRelatedThreadApi(c: AppContext, threadId: number, categoryId: number) {
  const selectSql = `SELECT t.id, t.public_id AS publicId, t.title, t.slug, t.pinned, t.locked, t.featured,
      t.views, t.reply_count AS replyCount, t.created_at AS createdAt, t.updated_at AS updatedAt, t.last_post_at AS lastPostAt,
      c.id AS categoryId, c.public_id AS categoryPublicId, c.name AS categoryName, c.slug AS categorySlug, c.color AS categoryColor,
      u.id AS authorId, u.public_id AS authorPublicId, u.username AS authorUsername, u.display_name AS authorDisplayName,
      u.avatar_url AS authorAvatar, u.role AS authorRole`;

  const tagged = await c.env.DB.prepare(
    `${selectSql}, COUNT(tt.tag_id) AS matchCount
     FROM thread_tags current_tags
     INNER JOIN thread_tags tt ON tt.tag_id = current_tags.tag_id
     INNER JOIN threads t ON t.id = tt.thread_id
     INNER JOIN categories c ON c.id = t.category_id
     INNER JOIN users u ON u.id = t.user_id
     WHERE current_tags.thread_id = ? AND t.id <> ?
     GROUP BY t.id
     ORDER BY matchCount DESC, t.last_post_at DESC
     LIMIT 1`,
  )
    .bind(threadId, threadId)
    .first<Record<string, unknown>>();

  if (tagged) return mapThreadApi(tagged);

  const categoryFallback = await c.env.DB.prepare(
    `${selectSql}
     FROM threads t
     INNER JOIN categories c ON c.id = t.category_id
     INNER JOIN users u ON u.id = t.user_id
     WHERE t.category_id = ? AND t.id <> ?
     ORDER BY t.last_post_at DESC
     LIMIT 1`,
  )
    .bind(categoryId, threadId)
    .first<Record<string, unknown>>();

  return categoryFallback ? mapThreadApi(categoryFallback) : null;
}

async function loadBestCategoryDiscussions(c: AppContext, categoryId: number, limit = BEST_DISCUSSIONS_LIMIT) {
  const rows = await c.env.DB.prepare(
    `SELECT t.id, t.public_id AS publicId, t.title, t.slug, t.content, t.pinned, t.locked, t.featured,
      t.views, t.reply_count AS replyCount, t.created_at AS createdAt, t.updated_at AS updatedAt, t.last_post_at AS lastPostAt,
      c.id AS categoryId, c.public_id AS categoryPublicId, c.name AS categoryName, c.slug AS categorySlug, c.color AS categoryColor,
      u.id AS authorId, u.public_id AS authorPublicId, u.username AS authorUsername, u.display_name AS authorDisplayName,
      u.avatar_url AS authorAvatar, u.role AS authorRole,
      (COALESCE(t.views, 0) + COALESCE(t.reply_count, 0) * 80 + CASE WHEN t.featured THEN 500 ELSE 0 END) AS score
     FROM threads t
     INNER JOIN categories c ON c.id = t.category_id
     INNER JOIN users u ON u.id = t.user_id
     WHERE t.category_id = ?
     ORDER BY score DESC, t.last_post_at DESC
     LIMIT ?`,
  )
    .bind(categoryId, limit)
    .all<Record<string, unknown>>();

  return (rows.results ?? []).map((row) => ({ ...mapThreadApi(row), content: String(row.content ?? "") }));
}

async function loadBestTagDiscussions(c: AppContext, tagId: number, limit = BEST_DISCUSSIONS_LIMIT) {
  const rows = await c.env.DB.prepare(
    `SELECT t.id, t.public_id AS publicId, t.title, t.slug, t.content, t.pinned, t.locked, t.featured,
      t.views, t.reply_count AS replyCount, t.created_at AS createdAt, t.updated_at AS updatedAt, t.last_post_at AS lastPostAt,
      c.id AS categoryId, c.public_id AS categoryPublicId, c.name AS categoryName, c.slug AS categorySlug, c.color AS categoryColor,
      u.id AS authorId, u.public_id AS authorPublicId, u.username AS authorUsername, u.display_name AS authorDisplayName,
      u.avatar_url AS authorAvatar, u.role AS authorRole,
      (COALESCE(t.views, 0) + COALESCE(t.reply_count, 0) * 80 + CASE WHEN t.featured THEN 500 ELSE 0 END) AS score
     FROM thread_tags tt
     INNER JOIN threads t ON t.id = tt.thread_id
     INNER JOIN categories c ON c.id = t.category_id
     INNER JOIN users u ON u.id = t.user_id
     WHERE tt.tag_id = ?
     ORDER BY score DESC, t.last_post_at DESC
     LIMIT ?`,
  )
    .bind(tagId, limit)
    .all<Record<string, unknown>>();

  return (rows.results ?? []).map((row) => ({ ...mapThreadApi(row), content: String(row.content ?? "") }));
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

  const [tagRows, relatedThread] = await Promise.all([
    c.env.DB.prepare(
      `SELECT tags.id, tags.name, tags.slug
       FROM tags
       INNER JOIN thread_tags tt ON tt.tag_id = tags.id
       WHERE tt.thread_id = ?
       ORDER BY tags.name`,
    )
      .bind(Number(thread.id))
      .all<Record<string, unknown>>(),
    loadRelatedThreadApi(c, Number(thread.id), Number(thread.categoryId)),
  ]);

  const tags = (tagRows.results ?? []).map((tag) => ({
    id: Number(tag.id),
    name: String(tag.name ?? ""),
    slug: String(tag.slug ?? ""),
  }));
  return {
    ...mapThreadApi(thread),
    content: String(thread.content ?? ""),
    tags,
    relatedThread,
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

function rootSchemas(base: string, locale: SupportedLocale): SeoSchema[] {
  const details = LOCALE_DETAILS[locale];
  const rootUrl = absoluteLocalizedUrl(base, "/", locale);
  return [
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": `${rootUrl}#website`,
      name: SITE_NAME,
      alternateName: SITE_TAGLINE,
      description: SITE_DESCRIPTION,
      url: rootUrl,
      inLanguage: details.contentLanguage,
      publisher: {
        "@type": "Organization",
        "@id": `${rootUrl}#organization`,
        name: SITE_NAME,
        alternateName: SITE_TAGLINE,
        url: rootUrl,
      },
      potentialAction: {
        "@type": "SearchAction",
        target: {
          "@type": "EntryPoint",
          urlTemplate: `${absoluteLocalizedUrl(base, "/search", locale)}?q={search_term_string}`,
        },
        "query-input": "required name=search_term_string",
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": `${rootUrl}#organization`,
      name: SITE_NAME,
      alternateName: SITE_TAGLINE,
      slogan: SITE_TAGLINE,
      description: SITE_DESCRIPTION,
      url: rootUrl,
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

function appendSeoSection(mainHtml: string, sectionHtml: string): string {
  const section = sectionHtml.trim();
  if (!section) return mainHtml;
  return mainHtml.includes("</main>") ? mainHtml.replace("</main>", `${section}\n</main>`) : `${mainHtml}\n${section}`;
}

function seoBestDiscussionsSection(
  title: string,
  body: string,
  threads: Array<ReturnType<typeof mapThreadApi> & { content?: string }>,
  options: { anchors?: SeoAnchorLink[]; currentPath?: string } = {},
): string {
  if (!threads.length) return "";
  const anchorGroups = prepareSeoAnchorGroups(options.anchors ?? [], options.currentPath ?? "");
  const usedAnchorTerms = new Set<string>();
  const items = threads
    .map((thread, index) => {
      const updatedAt = thread.reviewedAt || newestIsoDate(thread.updatedAt, thread.lastPostAt, thread.createdAt);
      const meta = [
        thread.category?.name ? String(thread.category.name) : "",
        `${Number(thread.replyCount ?? 0)} replies`,
        `${Number(thread.views ?? 0)} views`,
        `updated ${isoDate(updatedAt).slice(0, 10)}`,
      ]
        .filter(Boolean)
        .join(" · ");
      const text = cleanText(thread.content, 180);
      return [
        `      <li class="seo-content__row seo-content__row--best" value="${index + 1}">`,
        '        <article class="seo-content__item">',
        `          <h3><a href="${escapeHtml(apiThreadPath(thread))}">${escapeHtml(thread.title)}</a></h3>`,
        `          <p class="seo-content__meta-line">${escapeHtml(meta)}</p>`,
        text ? `          <p>${seoTextHtml(text, anchorGroups, usedAnchorTerms)}</p>` : "",
        "        </article>",
        "      </li>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  return [
    '  <section class="seo-content__list seo-content__best" aria-label="Best discussions">',
    `    <h2>${escapeHtml(title)}</h2>`,
    body ? `    <p>${escapeHtml(body)}</p>` : "",
    "    <ol>",
    items,
    "    </ol>",
    "  </section>",
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
    reviewedAt?: unknown;
    views: unknown;
    replyCount: unknown;
    content: unknown;
    tags: Record<string, unknown>[];
    replies: Record<string, unknown>[];
    relatedThread?: ReturnType<typeof mapThreadApi> | null;
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
  const relatedThread = thread.relatedThread;
  const reviewedAt = thread.reviewedAt ? isoDate(thread.reviewedAt) : "";
  const relatedHtml = relatedThread
    ? [
        '    <aside class="seo-content__related" aria-label="Related topic">',
        "      <h2>Related topic</h2>",
        `      <p><a href="${escapeHtml(apiThreadPath(relatedThread))}">${escapeHtml(relatedThread.title)}</a> <span>${escapeHtml(relatedThread.category.name)} · ${escapeHtml(relatedThread.replyCount)} replies · ${escapeHtml(relatedThread.views)} views</span></p>`,
        "    </aside>",
      ].join("\n")
    : "";

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
    reviewedAt ? `        <span>last reviewed ${seoDateHtml(reviewedAt)}</span>` : "",
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
    relatedHtml,
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
  const reviewedAt = reviewedAtForThreadRow(thread);

  const [tagRows, replyRows, relatedThread] = await Promise.all([
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
    loadRelatedThreadApi(c, Number(thread.id), Number(thread.categoryId)),
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
  const discussionPosting = schemas[1];
  if (relatedThread) {
    discussionPosting.isRelatedTo = {
      "@type": "DiscussionForumPosting",
      headline: relatedThread.title,
      url: absoluteUrl(base, apiThreadPath(relatedThread)),
    };
  }
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
        reviewedAt,
        views: thread.views,
        replyCount: thread.replyCount,
        content: thread.content,
        tags,
        replies,
        relatedThread,
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
  const bestThreads = await loadBestCategoryDiscussions(c, Number(category.id));
  const threads = rows.results ?? [];
  const name = String(category.name);
  const description = cleanText(category.description, 160) || `${name} discussions and threads on ${SITE_NAME}.`;
  const path = `/c/${category.publicId}`;
  const items = threads.map((thread) => ({ name: String(thread.title), path: `/t/${thread.publicId}` }));
  const contentHtml = appendSeoSection(
    seoBlock(
      name,
      description,
      threads.map((thread) => ({
        title: String(thread.title),
        path: `/t/${thread.publicId}`,
        text: cleanText(thread.content, 140),
      })),
      { anchors, currentPath: path },
    ),
    seoBestDiscussionsSection(
      `Best discussions in ${name}`,
      `High-signal ${name} discussions selected from replies, views and recent activity.`,
      bestThreads,
      { anchors, currentPath: path },
    ),
  );
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
    contentHtml,
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
  const bestThreads = await loadBestTagDiscussions(c, Number(tag.id));
  const threads = rows.results ?? [];
  const name = String(tag.name);
  const path = `/tag/${encodeURIComponent(String(tag.slug))}`;
  const description = `Discussions tagged ${name} on ${SITE_NAME}. Browse ${Number(total?.total ?? threads.length)} related threads.`;
  const contentHtml = appendSeoSection(
    seoBlock(
      `#${name}`,
      description,
      threads.map((thread) => ({
        title: String(thread.title),
        path: `/t/${thread.publicId}`,
        text: cleanText(thread.content, 140),
      })),
      { anchors, currentPath: path },
    ),
    seoBestDiscussionsSection(
      `Best discussions tagged ${name}`,
      `High-signal #${name} discussions selected from replies, views and recent activity.`,
      bestThreads,
      { anchors, currentPath: path },
    ),
  );
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
    contentHtml,
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
  const parts = safeDecodePathParts(pathname);
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
  const section = parseLocalePath(pathname).path.split("/").filter(Boolean)[0] ?? "";
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

function isPublicHtmlCacheable(c: AppContext, url: URL): boolean {
  if (c.req.header("cookie")) return false;
  const section = parseLocalePath(url.pathname).path.split("/").filter(Boolean)[0] ?? "";
  if (["admin", "login", "register", "new-thread", "search"].includes(section)) return false;
  return true;
}

function publicHtmlCacheKey(url: URL): Request {
  return new Request(url.toString(), {
    method: "GET",
    headers: { Accept: "text/html" },
  });
}

function publicHtmlCacheControl() {
  return `public, max-age=${PUBLIC_HTML_BROWSER_TTL}, stale-while-revalidate=${PUBLIC_HTML_EDGE_TTL}`;
}

function effectiveMetaLocale(payload: SeoPayload, locale: SupportedLocale): SupportedLocale {
  return locale !== "en" && payload.localized?.translated === false ? "en" : locale;
}

function effectiveRobots(payload: SeoPayload, locale: SupportedLocale): string {
  if (locale !== "en" && payload.localized?.translated === false && !payload.robots?.includes("noindex")) return "noindex,follow";
  return payload.robots ?? "index,follow";
}

function isPayloadReadyForLocale(payload: SeoPayload, locale: SupportedLocale): boolean {
  return locale === "en" || payload.localized?.translated !== false;
}

function stripFallbackHead(html: string, locale: SupportedLocale, translated = true): string {
  const details = LOCALE_DETAILS[locale];
  return html
    .replace(/<html\s+lang="[^"]*"[^>]*>/i, `<html lang="${details.htmlLang}" dir="${details.dir}" data-fstdesk-translated="${translated ? "1" : "0"}">`)
    .replace(/^[ \t]*<title>[\s\S]*?<\/title>[ \t]*\r?\n?/im, "")
    .replace(/^[ \t]*<meta\s+(?:name|property)="(?:description|robots|application-name|apple-mobile-web-app-title|author|publisher|keywords|twitter:card|twitter:title|twitter:description|twitter:image|twitter:image:alt|og:site_name|og:type|og:title|og:description|og:url|og:image|og:image:secure_url|og:image:type|og:image:width|og:image:height|og:image:alt|og:locale|og:locale:alternate|article:published_time|article:modified_time|article:section|article:tag)"[^>]*>[ \t]*\r?\n?/gim, "")
    .replace(/^[ \t]*<meta\s+http-equiv="content-language"[^>]*>[ \t]*\r?\n?/gim, "")
    .replace(/^[ \t]*<link\s+rel="canonical"[^>]*>[ \t]*\r?\n?/gim, "")
    .replace(/^[ \t]*<link\s+rel="alternate"[^>]*>[ \t]*\r?\n?/gim, "")
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

function metaHtml(payload: SeoPayload, base: string, locale: SupportedLocale): string {
  const metaLocale = effectiveMetaLocale(payload, locale);
  const details = LOCALE_DETAILS[metaLocale];
  const canonicalPath = localizePath(payload.canonicalPath, metaLocale);
  const canonical = absoluteUrl(base, canonicalPath);
  const fullTitle = fullSeoTitle(payload.title);
  const imagePath = payload.imagePath ?? DEFAULT_IMAGE;
  const image = absoluteUrl(base, imagePath);
  const imageType = imagePath.toLowerCase().endsWith(".webp") ? "image/webp" : "image/svg+xml";
  const imageAlt = payload.imageAlt ?? fullTitle;
  const robots = effectiveRobots(payload, locale);
  const alternates = robots.includes("noindex") ? [] : localizedAlternates(payload.canonicalPath);
  const schemas = [...rootSchemas(base, metaLocale), ...(payload.schemas ?? [])]
    .map((schema) => localizeSchemaValue(schema, base, metaLocale) as SeoSchema);
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
    `<meta name="robots" content="${escapeHtml(robots)}" />`,
    `<meta name="application-name" content="${escapeHtml(SITE_NAME)}" />`,
    `<meta name="apple-mobile-web-app-title" content="${escapeHtml(SITE_NAME)}" />`,
    `<meta name="author" content="${escapeHtml(SITE_NAME)}" />`,
    `<meta name="publisher" content="${escapeHtml(SITE_NAME)}" />`,
    `<meta name="keywords" content="${escapeHtml(seoKeywords(payload))}" />`,
    `<meta http-equiv="content-language" content="${escapeHtml(details.contentLanguage)}" />`,
    `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
    ...alternates.map((alternate) => `<link rel="alternate" hreflang="${escapeHtml(alternate.hreflang)}" href="${escapeHtml(absoluteUrl(base, alternate.path))}" />`),
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
    `<meta property="og:locale" content="${escapeHtml(details.ogLocale)}" />`,
    ...alternates
      .filter((alternate) => alternate.locale !== "x-default" && alternate.locale !== metaLocale)
      .map((alternate) => `<meta property="og:locale:alternate" content="${escapeHtml(LOCALE_DETAILS[alternate.locale as SupportedLocale].ogLocale)}" />`),
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
  const parts = safeDecodePathParts(pathname);
  const queries: BootstrapQuery[] = [];

  const [categories, stats, adsConfig] = await Promise.all([loadCategoriesApi(c), loadStatsApi(c), loadAdsConfigApi(c)]);
  queries.push({ key: ["categories"], data: categories });
  queries.push({ key: ["stats"], data: stats });
  queries.push({ key: ["ads-config"], data: adsConfig });

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

function staticSidebarHtml(pathname: string, categories: ApiCategory[], locale: SupportedLocale): string {
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
      const href = localizePath(item.href, locale);
      return [
        `<a class="gb-tree-item${active ? " active" : ""}" href="${escapeHtml(href)}">`,
        `<span style="color:${active ? "var(--gb-yellow)" : "var(--gb-gray)"};width:16px;flex-shrink:0">#</span>`,
        `<span style="flex:1;overflow:hidden;text-overflow:ellipsis">${escapeHtml(item.label)}</span>`,
        "</a>",
      ].join("");
    })
    .join("");

  const categoryHtml = categories
    .map((cat, index) => {
      const rawHref = apiCategoryPath(cat);
      const href = localizePath(rawHref, locale);
      const active = pathname === rawHref || pathname === `/c/${cat.id}`;
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

function staticShellHtml(contentHtml: string, pathname: string, categories: ApiCategory[], embedded = false, locale: SupportedLocale = "en"): string {
  const page = pathname === "/" ? "threads" : pathname.replace("/", "").split("/")[0] || "threads";
  const languageOptions = (["en", ...LOCALIZED_LOCALES] as SupportedLocale[])
    .map((option) => {
      const selected = option === locale ? " selected" : "";
      const value = escapeHtml(option);
      return `<option value="${value}"${selected}>${escapeHtml(option.toUpperCase())} · ${escapeHtml(LOCALE_DETAILS[option].label)}</option>`;
    })
    .join("");
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
    `<div class="gb-tab active" style="padding-left:12px"><a href="${escapeHtml(localizePath("/", locale))}" style="color:var(--gb-yellow);font-weight:700;text-decoration:none">FSTDESK</a></div>`,
    '<nav class="gb-header-nav" aria-label="Primary">',
    `<a class="gb-header-link" href="${escapeHtml(localizePath("/", locale))}">threads</a>`,
    `<a class="gb-header-link" href="${escapeHtml(localizePath("/members", locale))}">members</a>`,
    `<a class="gb-header-link" href="${escapeHtml(localizePath("/tags", locale))}">tags</a>`,
    `<a class="gb-header-link" href="${escapeHtml(localizePath("/what-is-fstdesk", locale))}">what is fstdesk</a>`,
    "</nav>",
    "</div>",
    '<div class="gb-tabline-right">',
    '<label class="gb-language" title="Language">',
    '<span class="gb-language-prefix">lang</span>',
    `<select class="gb-language-select" aria-label="Language">${languageOptions}</select>`,
    "</label>",
    "</div>",
    "</div>",
    '<div class="gb-body">',
    `<div class="gb-sidebar">${staticSidebarHtml(pathname, categories, locale)}</div>`,
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
    ".gb-language{display:inline-flex;align-items:center;height:24px;border:1px solid var(--gb-bg2);background:var(--gb-bg);color:var(--gb-gray)}.gb-language-prefix{padding:0 7px;color:var(--gb-yellow);font-size:10px;font-weight:700;line-height:22px;border-right:1px solid var(--gb-bg2);text-transform:uppercase}.gb-language-select{width:128px;height:22px;padding:0 22px 0 8px;border:0;border-radius:0;outline:0;background:var(--gb-bg1);color:var(--gb-fg);font-family:inherit;font-size:11px;font-weight:700}",
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

function injectHtml(indexHtml: string, payload: SeoPayload, base: string, url: URL, contentPathname: string, bootstrap: BootstrapBuild, locale: SupportedLocale): string {
  const metaLocale = effectiveMetaLocale(payload, locale);
  const translated = isPayloadReadyForLocale(payload, locale);
  const withCleanHead = prioritizeStylesheets(stripFallbackHead(indexHtml, metaLocale, translated));
  const seoMeta = metaHtml(payload, base, locale);
  const localeScript = `<script id="__FSTDESK_LOCALE_STATUS__" type="application/json">${escapeJsonScript({ locale, metaLocale, translated, status: payload.localized?.status ?? "complete" })}</script>`;
  const bootstrapScript = `<script id="__FSTDESK_BOOTSTRAP__" type="application/json">${escapeJsonScript(bootstrap.payload)}</script>`;
  const withMeta = /<meta\s+name="theme-color"[^>]*>\s*/i.test(withCleanHead)
    ? withCleanHead.replace(/(<meta\s+name="theme-color"[^>]*>\s*)/i, `$1\n    ${seoMeta}\n`)
    : withCleanHead.replace("<head>", `<head>\n    ${seoMeta}`);
  const withBootstrap = /<script\s+type="module"[^>]*src="[^"]+"[^>]*><\/script>/i.test(withMeta)
    ? withMeta.replace(/(<script\s+type="module"[^>]*src="[^"]+"[^>]*><\/script>)/i, `${localeScript}\n    ${bootstrapScript}\n    $1`)
    : withMeta.replace("</head>", `    ${localeScript}\n    ${bootstrapScript}\n  </head>`);
  const content = localizeHtmlLinks(payload.contentHtml ?? seoBlock(SITE_NAME, payload.description), locale);
  return withBootstrap.replace(
    /<div id="root"><\/div>/,
    `<div id="root">${staticShellHtml(content, contentPathname, bootstrap.categories, url.searchParams.get("embed") === "1", locale)}</div>`,
  );
}

export async function renderSeoHtml(c: AppContext): Promise<Response> {
  if (!shouldRenderHtml(c)) return c.env.ASSETS.fetch(c.req.raw);
  const url = new URL(c.req.url);
  const localeInfo = parseLocalePath(url.pathname);
  if (localeInfo.isLocalized && !shouldLocalizePath(localeInfo.path)) {
    const target = new URL(url.toString());
    target.pathname = localeInfo.path;
    return c.redirect(target.toString(), 302);
  }
  const contentUrl = new URL(url.toString());
  contentUrl.pathname = localeInfo.path;
  const cacheable = isPublicHtmlCacheable(c, url);
  const cacheKey = cacheable ? publicHtmlCacheKey(url) : null;
  if (cacheKey) {
    const cached = await caches.default.match(cacheKey);
    if (cached) {
      const response = new Response(cached.body, cached);
      response.headers.set("Cache-Control", publicHtmlCacheControl());
      response.headers.set("CDN-Cache-Control", `public, max-age=${PUBLIC_HTML_EDGE_TTL}`);
      response.headers.set("Cloudflare-CDN-Cache-Control", `public, max-age=${PUBLIC_HTML_EDGE_TTL}`);
      response.headers.set("X-FSTDESK-HTML-Cache", "HIT");
      return response;
    }
  }

  const assetResponse = await c.env.ASSETS.fetch(c.req.raw);
  const contentType = assetResponse.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return assetResponse;

  const fallbackResponse = assetResponse.clone();
  try {
    const base = `${url.protocol}//${url.host}`;
    const [anchors, bootstrap] = await Promise.all([
      shouldLoadSeoAnchors(contentUrl.pathname) ? loadSeoAnchors(c) : Promise.resolve([]),
      bootstrapForUrl(c, contentUrl),
    ]);
    const payload = await applyTranslationOrQueue(
      c,
      await payloadForPath(c, base, contentUrl.pathname, anchors),
      localeInfo.locale,
      contentUrl.pathname,
    );
    const html = injectHtml(await assetResponse.text(), payload, base, url, contentUrl.pathname, bootstrap, localeInfo.locale);
    const headers = new Headers(assetResponse.headers);
    const metaLocale = effectiveMetaLocale(payload, localeInfo.locale);
    const localeReady = isPayloadReadyForLocale(payload, localeInfo.locale);
    headers.set("content-type", "text/html; charset=utf-8");
    headers.set("content-language", LOCALE_DETAILS[metaLocale].contentLanguage);
    if (cacheable && localeReady && (payload.status ?? assetResponse.status) === 200) {
      headers.set("cache-control", publicHtmlCacheControl());
      headers.set("cdn-cache-control", `public, max-age=${PUBLIC_HTML_EDGE_TTL}`);
      headers.set("cloudflare-cdn-cache-control", `public, max-age=${PUBLIC_HTML_EDGE_TTL}`);
      headers.set("X-FSTDESK-HTML-Cache", "MISS");
    } else {
      headers.set("cache-control", "no-store, max-age=0, must-revalidate");
      headers.set("cdn-cache-control", "no-store");
      headers.set("cloudflare-cdn-cache-control", "no-store");
    }
    headers.set("vary", "Accept");
    const response = new Response(html, { status: payload.status ?? assetResponse.status, headers });
    if (cacheKey && response.status === 200) c.executionCtx.waitUntil(caches.default.put(cacheKey, response.clone()));
    return response;
  } catch (error) {
    console.warn("seo_render_fallback", error instanceof Error ? error.message : String(error));
    return fallbackResponse;
  }
}
