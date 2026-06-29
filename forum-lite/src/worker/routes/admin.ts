import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, eq, desc, sql } from "drizzle-orm";
import { getDb, schema } from "../db";
import { requireRole } from "../lib/middleware";
import { safeISO } from "../lib/auth";
import { toPublicUser, type AppEnv } from "../types";
import { DEFAULT_EMAIL_TEST_TO, loadEmailSettings, sendManagedEmail, weAreBackEmail } from "../lib/notifications";
import { ensureAnchorLinksSchema } from "../lib/anchor-links";
import { ensureErrorEventsSchema } from "../lib/error-events";
import { cloudflareEmailApiConfigured, isAwsSesConfigured, sendEmail, type CloudflareEmailFailure } from "../lib/email";
import { classifyCloudflareEmailFailure, type EmailFailureClassification } from "../lib/email-classification";
import { classificationForPreflight, preflightEmail, type EmailPreflightResult } from "../lib/email-preflight";
import { isEmailSuppressed, normalizeEmailAddress, recordEmailSuppression } from "../lib/email-suppression";
import { syncCloudflareEmailSuppressions } from "../lib/email-sync";

const app = new Hono<AppEnv>();
const WE_ARE_BACK_CAMPAIGN = "we-are-back";
const MARKETING_BLOCK_DUPLICATE_SENDS_KEY = "marketing_block_duplicate_sends";
const MARKETING_BULK_RECIPIENT_LIMIT = 250;
const MARKETING_JOB_MAX_CONCURRENCY = 24;
const MARKETING_JOB_SMTP_CONCURRENCY = 6;
const MARKETING_JOB_LOCK_SECONDS = 90;

app.use("/*", requireRole("admin"));

type EmailSettings = Awaited<ReturnType<typeof loadEmailSettings>>;
type MarketingJobRow = {
  id: string;
  campaignKey: string;
  userIdsJson: string;
  status: "queued" | "running" | "done" | "error";
  total: number;
  processed: number;
  sent: number;
  duplicate: number;
  skipped: number;
  suppressed: number;
  failed: number;
  createdByUserId: number | null;
  requestUrl: string;
  lockedUntil: number | null;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
};

type MarketingSendResult = {
  userId?: number;
  username?: string;
  email?: string;
  status: string;
  previousSentAt?: string | null;
  error?: string;
};

const nowSeconds = () => Math.floor(Date.now() / 1000);

function jobId() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 20);
}

async function ensureMarketingJobsSchema(db: D1Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS marketing_jobs (
    id TEXT PRIMARY KEY,
    campaign_key TEXT NOT NULL,
    user_ids_json TEXT NOT NULL,
    status TEXT NOT NULL,
    total INTEGER NOT NULL DEFAULT 0,
    processed INTEGER NOT NULL DEFAULT 0,
    sent INTEGER NOT NULL DEFAULT 0,
    duplicate INTEGER NOT NULL DEFAULT 0,
    skipped INTEGER NOT NULL DEFAULT 0,
    suppressed INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0,
    created_by_user_id INTEGER,
    request_url TEXT NOT NULL,
    locked_until INTEGER,
    error_message TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    started_at INTEGER,
    finished_at INTEGER
  )`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS marketing_jobs_status_idx ON marketing_jobs(status, locked_until, created_at)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS marketing_jobs_created_by_idx ON marketing_jobs(created_by_user_id, created_at)").run();
}

function mapMarketingJob(row: any): MarketingJobRow {
  return {
    id: String(row.id),
    campaignKey: String(row.campaignKey ?? row.campaign_key),
    userIdsJson: String(row.userIdsJson ?? row.user_ids_json ?? "[]"),
    status: String(row.status) as MarketingJobRow["status"],
    total: Number(row.total ?? 0),
    processed: Number(row.processed ?? 0),
    sent: Number(row.sent ?? 0),
    duplicate: Number(row.duplicate ?? 0),
    skipped: Number(row.skipped ?? 0),
    suppressed: Number(row.suppressed ?? 0),
    failed: Number(row.failed ?? 0),
    createdByUserId: row.createdByUserId ?? row.created_by_user_id ?? null,
    requestUrl: String(row.requestUrl ?? row.request_url ?? "https://fstdesk.com/"),
    lockedUntil: row.lockedUntil ?? row.locked_until ?? null,
    errorMessage: row.errorMessage ?? row.error_message ?? null,
    createdAt: Number(row.createdAt ?? row.created_at ?? 0),
    updatedAt: Number(row.updatedAt ?? row.updated_at ?? 0),
    startedAt: row.startedAt ?? row.started_at ?? null,
    finishedAt: row.finishedAt ?? row.finished_at ?? null,
  };
}

function publicMarketingJob(row: MarketingJobRow) {
  return {
    id: row.id,
    campaignKey: row.campaignKey,
    status: row.status,
    total: row.total,
    processed: row.processed,
    sent: row.sent,
    duplicate: row.duplicate,
    skipped: row.skipped,
    suppressed: row.suppressed,
    error: row.failed,
    errorMessage: row.errorMessage,
    createdAt: safeISO(row.createdAt),
    updatedAt: safeISO(row.updatedAt),
    startedAt: row.startedAt ? safeISO(row.startedAt) : null,
    finishedAt: row.finishedAt ? safeISO(row.finishedAt) : null,
  };
}

function countMarketingResult(acc: Record<string, number>, result: MarketingSendResult) {
  const key = result.status === "error" ? "failed" : result.status;
  acc[key] = (acc[key] ?? 0) + 1;
}

async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const current = index;
      index += 1;
      if (current >= items.length) return;
      results[current] = await worker(items[current]);
    }
  });
  await Promise.all(runners);
  return results;
}

function marketingJobConcurrency(settings: EmailSettings) {
  return settings.provider === "ses" && settings.sesTransport === "smtp"
    ? MARKETING_JOB_SMTP_CONCURRENCY
    : MARKETING_JOB_MAX_CONCURRENCY;
}

async function sendMarketingEmailToUser(input: {
  env: AppEnv["Bindings"];
  db: AppEnv["Variables"]["db"];
  adminId: number;
  campaignKey: string;
  requestUrl: string;
  user: typeof schema.users.$inferSelect;
  mode: "test" | "single" | "bulk";
  blockDuplicateSends: boolean;
  emailSettings: EmailSettings;
  waitUntil?: (promise: Promise<unknown>) => void;
}): Promise<MarketingSendResult> {
  const { env, db, adminId, campaignKey, user, mode, blockDuplicateSends, emailSettings, waitUntil } = input;
  const previous = await db.query.marketingSends.findFirst({
    where: and(eq(schema.marketingSends.campaignKey, campaignKey), eq(schema.marketingSends.userId, user.id)),
    orderBy: desc(schema.marketingSends.createdAt),
  });
  if (mode !== "test" && blockDuplicateSends && previous) {
    if (mode === "single") {
      await db.insert(schema.activityLog).values({
        userId: adminId,
        type: "marketing",
        summary: `Skipped duplicate ${campaignKey} to ${user.username}`,
        createdAt: new Date(),
      });
    }
    return {
      userId: user.id,
      username: user.username,
      email: user.email,
      status: "duplicate",
      previousSentAt: previous.createdAt ? safeISO(previous.createdAt) : null,
    };
  }

  const { siteUrl, from, provider, sesRegion, sesTransport, sesPort } = emailSettings;
  if (mode !== "test") {
    const risky = await env.DB.prepare(
      `SELECT status, error_code AS errorCode, created_at AS createdAt
       FROM email_events
       WHERE kind = 'email_verify'
         AND LOWER(email) = LOWER(?)
         AND status IN ('preflight_risky', 'error', 'suppressed')
       ORDER BY created_at DESC
       LIMIT 1`,
    ).bind(user.email).first<{ status: string; errorCode: string | null; createdAt: number | null }>();
    if (risky) {
      const mail = weAreBackEmail({ recipientName: user.displayName, siteUrl });
      const [event] = await db.insert(schema.emailEvents).values({
        userId: user.id,
        email: user.email.trim().toLowerCase(),
        kind: "marketing",
        subject: mail.subject,
        status: "skipped",
        relatedType: "marketing",
        campaignKey,
        message: `Marketing skipped because Email Verify marked this recipient risky${risky.errorCode ? `: ${risky.errorCode}` : ""}`,
        errorCode: "email_verify_risk",
        createdAt: new Date(),
      }).returning({ id: schema.emailEvents.id });
      await db.insert(schema.marketingSends).values({
        campaignKey,
        userId: user.id,
        email: user.email,
        status: "skipped",
        emailEventId: event?.id ?? null,
        sentByUserId: adminId,
        createdAt: new Date(),
      });
      if (mode !== "bulk") {
        await db.insert(schema.activityLog).values({
          userId: adminId,
          type: "marketing",
          summary: `Skipped ${campaignKey} to ${user.username} (email verify risk)`,
          createdAt: new Date(),
        });
      }
      return {
        userId: user.id,
        username: user.username,
        email: user.email,
        status: "skipped",
        error: "email_verify_risk",
        previousSentAt: previous?.createdAt ? safeISO(previous.createdAt) : null,
      };
    }
  }

  const mail = weAreBackEmail({ recipientName: user.displayName, siteUrl });
  const result = await sendManagedEmail({
    db,
    env,
    user,
    kind: "marketing",
    ...mail,
    siteUrl,
    from,
    provider,
    sesRegion,
    sesTransport,
    sesPort,
    campaignKey,
    ignorePreferences: mode === "test",
    waitUntil,
  });

  await db.insert(schema.marketingSends).values({
    campaignKey,
    userId: user.id,
    email: user.email,
    status: result.status,
    emailEventId: result.eventId,
    sentByUserId: adminId,
    createdAt: new Date(),
  });
  if (mode !== "bulk") {
    await db.insert(schema.activityLog).values({
      userId: adminId,
      type: "marketing",
      summary: `${mode === "test" ? "Tested" : "Sent"} ${campaignKey} to ${user.username} (${result.status})`,
    });
  }
  return {
    userId: user.id,
    username: user.username,
    email: user.email,
    status: result.status,
    previousSentAt: previous?.createdAt ? safeISO(previous.createdAt) : null,
  };
}

async function readMarketingJob(env: AppEnv["Bindings"], id: string): Promise<MarketingJobRow | null> {
  await ensureMarketingJobsSchema(env.DB);
  const row = await env.DB.prepare(
    `SELECT id, campaign_key AS campaignKey, user_ids_json AS userIdsJson, status, total, processed,
      sent, duplicate, skipped, suppressed, failed, created_by_user_id AS createdByUserId,
      request_url AS requestUrl, locked_until AS lockedUntil, error_message AS errorMessage,
      created_at AS createdAt, updated_at AS updatedAt, started_at AS startedAt, finished_at AS finishedAt
     FROM marketing_jobs
     WHERE id = ?`,
  ).bind(id).first();
  return row ? mapMarketingJob(row) : null;
}

async function claimMarketingJob(env: AppEnv["Bindings"], id?: string): Promise<MarketingJobRow | null> {
  await ensureMarketingJobsSchema(env.DB);
  const now = nowSeconds();
  const row = id
    ? await env.DB.prepare(
      `SELECT id, campaign_key AS campaignKey, user_ids_json AS userIdsJson, status, total, processed,
        sent, duplicate, skipped, suppressed, failed, created_by_user_id AS createdByUserId,
        request_url AS requestUrl, locked_until AS lockedUntil, error_message AS errorMessage,
        created_at AS createdAt, updated_at AS updatedAt, started_at AS startedAt, finished_at AS finishedAt
       FROM marketing_jobs
       WHERE id = ?
         AND status IN ('queued', 'running')
         AND (locked_until IS NULL OR locked_until < ?)`,
    ).bind(id, now).first()
    : await env.DB.prepare(
      `SELECT id, campaign_key AS campaignKey, user_ids_json AS userIdsJson, status, total, processed,
        sent, duplicate, skipped, suppressed, failed, created_by_user_id AS createdByUserId,
        request_url AS requestUrl, locked_until AS lockedUntil, error_message AS errorMessage,
        created_at AS createdAt, updated_at AS updatedAt, started_at AS startedAt, finished_at AS finishedAt
       FROM marketing_jobs
       WHERE status IN ('queued', 'running')
         AND (locked_until IS NULL OR locked_until < ?)
       ORDER BY created_at ASC
       LIMIT 1`,
    ).bind(now).first();
  if (!row) return null;

  const job = mapMarketingJob(row);
  await env.DB.prepare(
    `UPDATE marketing_jobs
     SET status = 'running', locked_until = ?, started_at = COALESCE(started_at, ?), updated_at = ?
     WHERE id = ?`,
  ).bind(now + MARKETING_JOB_LOCK_SECONDS, now, now, job.id).run();
  return (await readMarketingJob(env, job.id)) ?? job;
}

function parseJobIds(job: MarketingJobRow): number[] {
  try {
    const values = JSON.parse(job.userIdsJson);
    if (!Array.isArray(values)) return [];
    return values
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0)
      .slice(0, MARKETING_BULK_RECIPIENT_LIMIT);
  } catch {
    return [];
  }
}

async function processMarketingJob(env: AppEnv["Bindings"], job: MarketingJobRow, ctx?: ExecutionContext) {
  const db = getDb(env);
  const ids = parseJobIds(job);
  const adminId = Number(job.createdByUserId ?? 0);
  const emailSettings = await loadEmailSettings(db, job.requestUrl);
  const concurrency = marketingJobConcurrency(emailSettings);
  const blockDuplicateSends = await marketingDuplicateBlockingEnabled(db);
  let processed = Math.max(0, Math.min(job.processed, ids.length));
  const totals: Record<string, number> = {
    sent: job.sent,
    duplicate: job.duplicate,
    skipped: job.skipped,
    suppressed: job.suppressed,
    failed: job.failed,
  };

  while (processed < ids.length) {
    const batchIds = ids.slice(processed, processed + concurrency);
    const results = await mapLimit(batchIds, concurrency, async (id): Promise<MarketingSendResult> => {
      try {
        const user = await db.query.users.findFirst({ where: eq(schema.users.id, id) });
        if (!user) return { userId: id, status: "skipped", error: "User not found" };
        return await sendMarketingEmailToUser({
          env,
          db,
          adminId,
          campaignKey: job.campaignKey,
          requestUrl: job.requestUrl,
          user,
          mode: "bulk",
          blockDuplicateSends,
          emailSettings,
          waitUntil: ctx?.waitUntil.bind(ctx),
        });
      } catch (error) {
        return {
          userId: id,
          status: "error",
          error: error instanceof Error ? error.message : "marketing send failed",
        };
      }
    });

    for (const result of results) countMarketingResult(totals, result);
    processed += batchIds.length;
    const now = nowSeconds();
    await env.DB.prepare(
      `UPDATE marketing_jobs
       SET processed = ?, sent = ?, duplicate = ?, skipped = ?, suppressed = ?, failed = ?,
         locked_until = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(
      processed,
      totals.sent ?? 0,
      totals.duplicate ?? 0,
      totals.skipped ?? 0,
      totals.suppressed ?? 0,
      totals.failed ?? 0,
      now + MARKETING_JOB_LOCK_SECONDS,
      now,
      job.id,
    ).run();
  }

  const now = nowSeconds();
  await env.DB.prepare(
    `UPDATE marketing_jobs
     SET status = ?, locked_until = NULL, updated_at = ?, finished_at = ?
     WHERE id = ?`,
  ).bind("done", now, now, job.id).run();
  await db.insert(schema.activityLog).values({
    userId: adminId || null,
    type: "marketing",
    summary: `Marketing job ${job.id} finished ${job.campaignKey}: ${totals.sent ?? 0}/${ids.length} sent, ${totals.duplicate ?? 0} duplicate, ${totals.skipped ?? 0} skipped, ${totals.suppressed ?? 0} suppressed, ${totals.failed ?? 0} failed`,
    createdAt: new Date(),
  });
}

export async function processMarketingJobs(env: AppEnv["Bindings"], ctx?: ExecutionContext, opts: { jobId?: string } = {}) {
  for (let i = 0; i < 3; i += 1) {
    const job = await claimMarketingJob(env, opts.jobId);
    if (!job) return;
    try {
      await processMarketingJob(env, job, ctx);
    } catch (error) {
      const now = nowSeconds();
      const message = error instanceof Error ? error.message : "marketing job failed";
      await env.DB.prepare(
        `UPDATE marketing_jobs
         SET status = 'error', locked_until = NULL, error_message = ?, updated_at = ?, finished_at = ?
         WHERE id = ?`,
      ).bind(message.slice(0, 1000), now, now, job.id).run();
      console.warn("marketing_job_failed", job.id, message);
      return;
    }
    if (opts.jobId) return;
  }
}

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function csvRows(headers: string[], rows: Array<Record<string, unknown>>): string {
  return [
    headers.map(csvCell).join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")),
  ].join("\n");
}

function downloadText(c: any, filename: string, body: string, contentType: string) {
  c.header("Content-Type", contentType);
  c.header("Content-Disposition", `attachment; filename="${filename}"`);
  c.header("Cache-Control", "private, no-store");
  return c.body(body);
}

function errorEventSearch(q: string) {
  if (!q) return { clause: "", bindings: [] as string[] };
  const like = `%${q.toLowerCase()}%`;
  return {
    clause: `AND (
      LOWER(message) LIKE ?
      OR LOWER(kind) LIKE ?
      OR LOWER(COALESCE(path, '')) LIKE ?
      OR LOWER(COALESCE(username, '')) LIKE ?
      OR LOWER(COALESCE(metadata, '')) LIKE ?
    )`,
    bindings: [like, like, like, like, like],
  };
}

function timestampSeconds(value: Date | number | string | null | undefined): number {
  if (!value) return 0;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? Math.floor(value.getTime() / 1000) : 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

function toAdminUser(u: typeof schema.users.$inferSelect, analyticsLastSeenAt?: Date | number | string | null) {
  const lastActiveSeconds = Math.max(
    timestampSeconds(analyticsLastSeenAt),
    timestampSeconds(u.lastLoginAt),
  );
  return {
    ...toPublicUser(u),
    email: u.email,
    emailVerifiedAt: u.emailVerifiedAt ? safeISO(u.emailVerifiedAt) : null,
    lastLoginAt: u.lastLoginAt ? safeISO(u.lastLoginAt) : null,
    lastActiveAt: lastActiveSeconds ? safeISO(lastActiveSeconds) : null,
    emailSuppressedAt: u.emailSuppressedAt ? safeISO(u.emailSuppressedAt) : null,
    emailSuppressionReason: u.emailSuppressionReason ?? null,
  };
}

type AdminUserSqlRow = {
  id: number;
  publicId: string;
  username: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  role: string;
  banned: number | boolean;
  emailVerifiedAt: number | null;
  lastLoginAt: number | null;
  emailSuppressedAt: number | null;
  emailSuppressionReason: string | null;
  postCount: number;
  threadCount: number;
  createdAt: number;
  analyticsLastSeenAt: number | null;
};

function sqlTimestamp(value: number | null | undefined): Date | null {
  if (!value) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? new Date(seconds * 1000) : null;
}

function userFromAdminSql(row: AdminUserSqlRow): typeof schema.users.$inferSelect {
  const role = row.role === "admin" || row.role === "moderator" ? row.role : "member";
  return {
    id: Number(row.id),
    publicId: String(row.publicId),
    username: String(row.username),
    email: String(row.email),
    passwordHash: "",
    displayName: String(row.displayName),
    avatarUrl: row.avatarUrl ?? null,
    bio: row.bio ?? null,
    role,
    banned: Boolean(row.banned),
    emailVerifiedAt: sqlTimestamp(row.emailVerifiedAt),
    lastLoginAt: sqlTimestamp(row.lastLoginAt),
    emailSuppressedAt: sqlTimestamp(row.emailSuppressedAt),
    emailSuppressionReason: row.emailSuppressionReason ?? null,
    postCount: Number(row.postCount ?? 0),
    threadCount: Number(row.threadCount ?? 0),
    createdAt: sqlTimestamp(row.createdAt) ?? new Date(0),
  };
}

function toAdminAnchor(row: typeof schema.anchorLinks.$inferSelect) {
  return {
    id: row.id,
    term: row.term,
    url: row.url,
    title: row.title,
    enabled: row.enabled,
    clickCount: row.clickCount,
    createdByUserId: row.createdByUserId,
    createdAt: safeISO(row.createdAt),
    updatedAt: safeISO(row.updatedAt),
  };
}

const anchorBody = z.object({
  term: z.string().trim().min(2).max(80),
  url: z.string().trim().min(1).max(500),
  title: z.string().trim().max(160).optional(),
  enabled: z.boolean().optional(),
});

const anchorAutoBody = z.object({
  term: z.string().trim().min(2).max(80),
  limit: z.number().int().min(1).max(50).default(50),
  enabled: z.boolean().optional(),
});

const emailSuppressionImportBody = z.object({
  text: z.string().min(1).max(2_000_000),
  reason: z.string().trim().min(1).max(120).optional(),
});

const EMAIL_IMPORT_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

function extractImportEmails(text: string) {
  const seen = new Set<string>();
  const emails: string[] = [];
  let duplicateInUpload = 0;
  const rawMatches = text.match(EMAIL_IMPORT_RE) ?? [];

  for (const raw of rawMatches) {
    const email = normalizeEmailAddress(raw);
    if (!z.string().email().safeParse(email).success) continue;
    if (seen.has(email)) {
      duplicateInUpload += 1;
      continue;
    }
    seen.add(email);
    emails.push(email);
  }

  return { emails, duplicateInUpload, rawMatches: rawMatches.length };
}

function chunksOf<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

const SQLITE_IN_CHUNK_SIZE = 80;
const SUPPRESSION_INSERT_BATCH_SIZE = 50;

async function existingSuppressionEmails(db: D1Database, emails: string[]): Promise<Set<string>> {
  const existing = new Set<string>();
  for (const chunk of chunksOf(emails, SQLITE_IN_CHUNK_SIZE)) {
    if (!chunk.length) continue;
    const placeholders = chunk.map(() => "?").join(",");
    const rows = await db.prepare(
      `SELECT LOWER(email) AS email
       FROM email_suppressions
       WHERE email IN (${placeholders})`,
    ).bind(...chunk).all<{ email: string }>();
    for (const row of rows.results ?? []) {
      const email = String(row.email ?? "").trim().toLowerCase();
      if (email) existing.add(email);
    }
  }
  return existing;
}

async function existingEmailEventEmails(db: D1Database, emails: string[]): Promise<Set<string>> {
  const existing = new Set<string>();
  for (const chunk of chunksOf(emails, SQLITE_IN_CHUNK_SIZE)) {
    if (!chunk.length) continue;
    const placeholders = chunk.map(() => "?").join(",");
    const rows = await db.prepare(
      `SELECT DISTINCT email
       FROM email_events
       WHERE email IN (${placeholders})`,
    ).bind(...chunk).all<{ email: string }>();
    for (const row of rows.results ?? []) {
      const email = String(row.email ?? "").trim().toLowerCase();
      if (email) existing.add(email);
    }
  }
  return existing;
}

async function markEmailsSuppressedEverywhere(
  db: D1Database,
  emails: string[],
  reason: string,
  message: string,
  now: number,
) {
  for (const chunk of chunksOf(emails, SQLITE_IN_CHUNK_SIZE)) {
    if (!chunk.length) continue;
    const placeholders = chunk.map(() => "?").join(",");
    await db.prepare(
      `UPDATE users
       SET email_suppressed_at = ?,
           email_suppression_reason = ?
       WHERE LOWER(email) IN (${placeholders})`,
    ).bind(now, reason, ...chunk).run();
    await db.prepare(
      `UPDATE email_events
       SET status = 'suppressed',
           message = ?,
           error_code = ?
       WHERE LOWER(email) IN (${placeholders})`,
    ).bind(message, reason, ...chunk).run();
    await db.prepare(
      `UPDATE marketing_sends
       SET status = 'suppressed'
       WHERE LOWER(email) IN (${placeholders})`,
    ).bind(...chunk).run();
  }
}

function normalizeAnchorTerm(term: string): string {
  return term.trim().replace(/\s+/g, " ");
}

function anchorTermWords(term: string): string[] {
  return normalizeAnchorTerm(term).toLowerCase().split(/\s+/).filter(Boolean);
}

function escapeAnchorRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function anchorTermPattern(term: string): RegExp {
  const words = anchorTermWords(term).map(escapeAnchorRegExp);
  return new RegExp(`(^|[^\\p{L}\\p{N}_])(${words.join("\\s+")})(?=$|[^\\p{L}\\p{N}_])`, "iu");
}

function contentHasAnchorTerm(content: string, term: string): boolean {
  return anchorTermPattern(term).test(content);
}

function anchorTermsOverlap(existingTerm: string, nextTerm: string): boolean {
  const existingWords = new Set(anchorTermWords(existingTerm));
  const nextWords = anchorTermWords(nextTerm);
  if (!existingWords.size || !nextWords.length) return false;
  return nextWords.some((word) => existingWords.has(word));
}

async function marketingDuplicateBlockingEnabled(db: AppEnv["Variables"]["db"]) {
  const setting = await db.query.settings.findFirst({
    where: eq(schema.settings.key, MARKETING_BLOCK_DUPLICATE_SENDS_KEY),
  });
  return setting?.value !== "false";
}

function riskRank(risk: string): number {
  if (risk === "critical") return 5;
  if (risk === "high") return 4;
  if (risk === "medium") return 3;
  if (risk === "system") return 2;
  return 1;
}

function classifyLocalEmailError(email: string, detail: string): EmailFailureClassification {
  const text = detail.toLowerCase();
  const local = (category: string, label: string, risk: EmailFailureClassification["risk"], action: EmailFailureClassification["action"], score: number, reason: string): EmailFailureClassification => ({
    email,
    category,
    label,
    risk,
    action,
    score,
    temporary: false,
    reason,
    evidence: detail ? [detail.slice(0, 500)] : [],
  });
  if (text.includes("preflight_invalid_syntax")) {
    return local("invalid_syntax", "invalid syntax", "critical", "suppress", 98, "The email address syntax is invalid.");
  }
  if (text.includes("preflight_domain_typo")) {
    return local("domain_typo", "domain typo", "high", "review", 88, "The domain looks like a typo and should be corrected before sending.");
  }
  if (text.includes("preflight_disposable_email")) {
    return local("disposable_email", "disposable email", "high", "suppress", 86, "The recipient domain is a known disposable or temporary email provider.");
  }
  if (text.includes("preflight_domain_no_dns")) {
    return local("domain_no_dns", "domain has no DNS", "critical", "suppress", 96, "The recipient domain has no MX, A or AAAA records.");
  }
  if (text.includes("preflight_domain_no_mx")) {
    return local("domain_no_mx", "domain has no MX", "medium", "review", 60, "The domain has no MX record. A/AAAA fallback exists, but mail delivery may be unreliable.");
  }
  if (text.includes("preflight_ok") || text.includes("preflight_reachable")) {
    return local("preflight_ok", "DNS/MX passed", "low", "ignore", 5, "Syntax, typo, disposable, domain and MX checks passed. Mailbox existence and inbox quota are unknown until a real delivery failure is returned.");
  }
  return classifyCloudflareEmailFailure({
    to: email,
    status: "local_error",
    eventType: "local",
    errorCause: detail,
    errorDetail: detail,
  });
}

function preflightDetail(result: EmailPreflightResult, classification: EmailFailureClassification): string {
  return [
    "preflight",
    classification.category,
    classification.reason,
    `domain=${result.domain || "-"}`,
    `mx=${result.hasMx ? "yes" : "no"}`,
    `a=${result.hasA ? "yes" : "no"}`,
    `aaaa=${result.hasAaaa ? "yes" : "no"}`,
    result.typoSuggestion ? `suggestion=${result.typoSuggestion}` : "",
    result.disposable ? "disposable=yes" : "",
    ...result.errors,
  ].filter(Boolean).join(" | ").slice(0, 2000);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  run: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await run(items[index], index);
    }
  }));
  return results;
}

function emailVerifyCandidateSearchSql(q: string) {
  if (!q) return { clause: "", bindings: [] as string[] };
  const like = `%${q.toLowerCase()}%`;
  return {
    clause: `AND (
         LOWER(u.email) LIKE ?
         OR LOWER(u.username) LIKE ?
         OR LOWER(COALESCE(u.display_name, '')) LIKE ?
       )`,
    bindings: [like, like, like],
  };
}

async function emailVerifyCandidates(c: any, limit: number, q = "") {
  const target = Math.max(1, Math.min(100, limit));
  const search = emailVerifyCandidateSearchSql(q);
  const candidates: Array<{
    id: number;
    username: string;
    displayName: string;
    email: string;
  }> = [];
  const batchSize = Math.min(600, Math.max(200, target * 5));
  let offset = 0;

  for (let attempts = 0; attempts < 20 && candidates.length < target; attempts += 1) {
    const rows = await c.env.DB.prepare(
      `SELECT u.id, u.username, u.display_name AS displayName, u.email
       FROM users u
       WHERE u.banned = 0
         AND u.email IS NOT NULL
         AND TRIM(u.email) != ''
         AND u.email_suppressed_at IS NULL
         ${search.clause}
       ORDER BY u.created_at ASC
       LIMIT ? OFFSET ?`,
    ).bind(...search.bindings, batchSize, offset).all<{
      id: number;
      username: string;
      displayName: string;
      email: string;
    }>();
    const users = rows.results ?? [];
    if (!users.length) break;

    const emails = users.map((user) => String(user.email ?? "").trim().toLowerCase()).filter(Boolean);
    const [suppressedEmails, eventEmails] = await Promise.all([
      existingSuppressionEmails(c.env.DB, emails),
      existingEmailEventEmails(c.env.DB, emails),
    ]);

    for (const user of users) {
      const email = String(user.email ?? "").trim().toLowerCase();
      if (!email || suppressedEmails.has(email) || eventEmails.has(email)) continue;
      candidates.push({ ...user, email });
      if (candidates.length >= target) break;
    }

    offset += users.length;
    if (users.length < batchSize) break;
  }

  return candidates;
}

async function emailVerifyCandidatesByEmails(c: any, emails: string[]) {
  const normalized = [...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean))].slice(0, 100);
  if (!normalized.length) return [];
  const placeholders = normalized.map(() => "?").join(",");
  const rows = await c.env.DB.prepare(
    `SELECT u.id, u.username, u.display_name AS displayName, u.email
     FROM users u
     WHERE u.banned = 0
       AND u.email IS NOT NULL
       AND TRIM(u.email) != ''
       AND u.email_suppressed_at IS NULL
       AND LOWER(u.email) IN (${placeholders})
     ORDER BY u.created_at ASC`,
  ).bind(...normalized).all<{
    id: number;
    username: string;
    displayName: string;
    email: string;
  }>();
  const users = rows.results ?? [];
  const userEmails = users.map((user) => String(user.email ?? "").trim().toLowerCase()).filter(Boolean);
  const [suppressedEmails, eventEmails] = await Promise.all([
    existingSuppressionEmails(c.env.DB, userEmails),
    existingEmailEventEmails(c.env.DB, userEmails),
  ]);
  return users
    .map((user) => ({ ...user, email: String(user.email ?? "").trim().toLowerCase() }))
    .filter((user) => user.email && !suppressedEmails.has(user.email) && !eventEmails.has(user.email));
}

async function emailVerifyCandidateCount(c: any, q = ""): Promise<number> {
  const search = emailVerifyCandidateSearchSql(q);
  const row = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM users u
     WHERE u.banned = 0
       AND u.email IS NOT NULL
       AND TRIM(u.email) != ''
       AND u.email_suppressed_at IS NULL
       ${search.clause}`,
  ).bind(...search.bindings).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

app.get("/stats", async (c) => {
  const db = c.get("db");
  const [userCount, threadCount, postCount] = await Promise.all([
    db.$count(schema.users),
    db.$count(schema.threads),
    db.$count(schema.posts),
  ]);
  const recentActivity = await db
    .select()
    .from(schema.activityLog)
    .orderBy(desc(schema.activityLog.createdAt))
    .limit(20);
  return c.json({
    userCount,
    threadCount,
    postCount,
    recentActivity: recentActivity.map((a) => ({ ...a, createdAt: safeISO(a.createdAt) })),
  });
});

app.get("/users", async (c) => {
  const page = Math.max(1, Number(c.req.query("page") ?? 1));
  const perPage = 25;
  const q = (c.req.query("q") ?? "").trim().toLowerCase();
  const like = `%${q}%`;
  const searchWhere = q
    ? `WHERE LOWER(u.username) LIKE ?
       OR LOWER(u.email) LIKE ?
       OR LOWER(COALESCE(u.display_name, '')) LIKE ?`
    : "";
  const bindings = q ? [like, like, like] : [];
  const [totalRow, usersResult] = await Promise.all([
    c.env.DB.prepare(`SELECT COUNT(*) AS total FROM users u ${searchWhere}`).bind(...bindings).first<{ total: number }>(),
    c.env.DB.prepare(
      `SELECT
         u.id,
         u.public_id AS publicId,
         u.username,
         u.email,
         u.display_name AS displayName,
         u.avatar_url AS avatarUrl,
         u.bio,
         u.role,
         u.banned,
         u.email_verified_at AS emailVerifiedAt,
         u.last_login_at AS lastLoginAt,
         u.email_suppressed_at AS emailSuppressedAt,
         u.email_suppression_reason AS emailSuppressionReason,
         u.post_count AS postCount,
         u.thread_count AS threadCount,
         u.created_at AS createdAt,
         ap.analyticsLastSeenAt AS analyticsLastSeenAt
       FROM users u
       LEFT JOIN (
         SELECT user_id, MAX(last_seen_at) AS analyticsLastSeenAt
         FROM analytics_pageviews
         WHERE user_id IS NOT NULL
         GROUP BY user_id
       ) ap ON ap.user_id = u.id
       ${searchWhere}
       ORDER BY MAX(COALESCE(u.last_login_at, 0), COALESCE(ap.analyticsLastSeenAt, 0)) DESC,
                u.created_at DESC,
                u.id DESC
       LIMIT ? OFFSET ?`,
    ).bind(...bindings, perPage, (page - 1) * perPage).all<AdminUserSqlRow>(),
  ]);
  const rows = usersResult.results ?? [];
  return c.json({
    users: rows.map((row) => toAdminUser(userFromAdminSql(row), row.analyticsLastSeenAt)),
    total: Number(totalRow?.total ?? 0),
    page,
    perPage,
    q,
  });
});

app.get("/email-suppressions", async (c) => {
  const page = Math.max(1, Number(c.req.query("page") ?? 1));
  const perPage = Math.max(1, Math.min(500, Number(c.req.query("perPage") ?? 100) || 100));
  const q = (c.req.query("q") ?? "").trim().toLowerCase();
  const where = q
    ? `WHERE LOWER(es.email) LIKE ?
       OR LOWER(es.reason) LIKE ?
       OR LOWER(es.source) LIKE ?
       OR LOWER(COALESCE(u.username, '')) LIKE ?
       OR LOWER(COALESCE(u.display_name, '')) LIKE ?`
    : "";
  const bindings = q ? Array(5).fill(`%${q}%`) : [];
  const rows = await c.env.DB.prepare(
    `SELECT
       es.email,
       es.reason,
       es.source,
       es.details,
       es.cf_suppression_status AS cfSuppressionStatus,
       es.cf_suppressed_at AS cfSuppressedAt,
       es.cf_suppression_error AS cfSuppressionError,
       es.created_at AS createdAt,
       es.updated_at AS updatedAt,
       u.id AS userId,
       u.username,
       u.display_name AS displayName,
       COALESCE(u.thread_count, 0) AS threadCount,
       COALESCE(u.post_count, 0) AS postCount
     FROM email_suppressions es
     LEFT JOIN users u ON LOWER(u.email) = LOWER(es.email)
     ${where}
     ORDER BY es.updated_at DESC
     LIMIT ? OFFSET ?`,
  ).bind(...bindings, perPage, (page - 1) * perPage).all<any>();
  const totalRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM email_suppressions es
     LEFT JOIN users u ON LOWER(u.email) = LOWER(es.email)
     ${where}`,
  ).bind(...bindings).first<{ count: number }>();
  return c.json({
    suppressions: (rows.results ?? []).map((row) => ({
      ...row,
      createdAt: safeISO(row.createdAt),
      updatedAt: safeISO(row.updatedAt),
      cfSuppressedAt: row.cfSuppressedAt ? safeISO(row.cfSuppressedAt) : null,
    })),
    syncConfigured: cloudflareEmailApiConfigured(c.env),
    total: Number(totalRow?.count ?? 0),
    page,
    perPage,
  });
});

app.get("/email-suppressions/export", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT
       es.email,
       COALESCE(u.username, '') AS username,
       COALESCE(u.display_name, '') AS displayName,
       COALESCE(u.thread_count, 0) AS threadCount,
       COALESCE(u.post_count, 0) AS postCount,
       es.reason,
       es.source,
       COALESCE(es.cf_suppression_status, '') AS cfSuppressionStatus,
       es.updated_at AS updatedAt
     FROM email_suppressions es
     LEFT JOIN users u ON LOWER(u.email) = LOWER(es.email)
     ORDER BY es.updated_at DESC`,
  ).all<any>();
  const header = ["email", "username", "display_name", "threads", "replies", "reason", "source", "cf_status", "updated_at"];
  const lines = [
    header.join(","),
    ...(rows.results ?? []).map((row) => [
      row.email,
      row.username,
      row.displayName,
      row.threadCount,
      row.postCount,
      row.reason,
      row.source,
      row.cfSuppressionStatus,
      safeISO(row.updatedAt),
    ].map(csvCell).join(",")),
  ];
  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="fstdesk-suppressions.csv"`,
      "Cache-Control": "no-store",
    },
  });
});

app.post("/email-suppressions", zValidator("json", z.object({
  email: z.string().email(),
  reason: z.string().min(1).max(120).optional(),
})), async (c) => {
  const db = c.get("db");
  const body = c.req.valid("json");
  const email = body.email.trim().toLowerCase();
  const reason = body.reason || "manual_admin_suppression";
  const existing = await db.query.emailSuppressions.findFirst({
    where: eq(schema.emailSuppressions.email, email),
    columns: {
      email: true,
      reason: true,
      source: true,
      updatedAt: true,
      cfSuppressionStatus: true,
    },
  });
  if (existing) {
    return c.json({
      ok: false,
      status: "already_added",
      email,
      reason: existing.reason,
      source: existing.source,
      updatedAt: safeISO(existing.updatedAt),
      cfSuppressionStatus: existing.cfSuppressionStatus ?? null,
      error: "This email is already in the suppression list",
    }, 409);
  }
  await recordEmailSuppression(db, c.env, email, {
    reason,
    source: "admin_manual",
    details: `Suppressed manually by ${c.get("user")?.username ?? "admin"}`,
  });
  await c.env.DB.prepare(
    `UPDATE email_events
     SET status = 'suppressed', message = ?, error_code = ?
     WHERE LOWER(email) = ?`,
  ).bind("Suppressed manually by admin", reason, email).run();
  await c.env.DB.prepare(
    `UPDATE marketing_sends
     SET status = 'suppressed'
     WHERE LOWER(email) = ?`,
  ).bind(email).run();
  return c.json({ ok: true, email });
});

app.post("/email-suppressions/import", zValidator("json", emailSuppressionImportBody), async (c) => {
  const db = c.get("db");
  const body = c.req.valid("json");
  const user = c.get("user");
  const reason = body.reason || "csv_import_suppression";
  const { emails, duplicateInUpload, rawMatches } = extractImportEmails(body.text);
  const maxEmails = 5_000;
  const limitedEmails = emails.slice(0, maxEmails);
  const results: Array<{ email: string; status: "added" | "skipped_existing" | "error"; message?: string }> = [];
  let errors = 0;

  const existing = await existingSuppressionEmails(c.env.DB, limitedEmails);
  const toAdd = limitedEmails.filter((email) => !existing.has(email));
  const skippedExisting = limitedEmails.length - toAdd.length;
  const now = Math.floor(Date.now() / 1000);
  const details = `csv upload by ${user?.username ?? "admin"}`;
  const cfStatus = cloudflareEmailApiConfigured(c.env) ? "pending" : "skipped";

  for (const email of limitedEmails) {
    results.push({ email, status: existing.has(email) ? "skipped_existing" : "added" });
  }

  for (const chunk of chunksOf(toAdd, SUPPRESSION_INSERT_BATCH_SIZE)) {
    try {
      await c.env.DB.batch(
        chunk.map((email) => c.env.DB.prepare(
          `INSERT OR IGNORE INTO email_suppressions
             (email, reason, source, details, cf_suppression_status, cf_suppressed_at, cf_suppression_error, created_at, updated_at)
           VALUES (?, ?, 'admin_csv_import', ?, ?, NULL, NULL, ?, ?)`,
        ).bind(email, reason, details, cfStatus, now, now)),
      );
    } catch (error) {
      errors += chunk.length;
      for (const email of chunk) {
        const row = results.find((item) => item.email === email);
        if (row) {
          row.status = "error";
          row.message = error instanceof Error ? error.message : "Import failed";
        }
      }
    }
  }

  const locallySuppressedEmails = results
    .filter((row) => row.status !== "error")
    .map((row) => row.email);
  if (locallySuppressedEmails.length) {
    await markEmailsSuppressedEverywhere(
      c.env.DB,
      locallySuppressedEmails,
      reason,
      "Suppressed by admin CSV import",
      now,
    );
  }

  await db.insert(schema.activityLog).values({
    userId: user?.id ?? null,
    type: "email_bounce",
    summary: `Imported suppression CSV: ${toAdd.length - errors} added, ${skippedExisting} skipped, ${errors} errors`,
  });

  return c.json({
    ok: true,
    rawMatches,
    unique: emails.length,
    processed: limitedEmails.length,
    truncated: emails.length > maxEmails,
    duplicateInUpload,
    added: toAdd.length - errors,
    skippedExisting,
    errors,
    resultLimit: 500,
    results: results.slice(0, 500),
  });
});

app.delete("/email-suppressions/:email", async (c) => {
  const db = c.get("db");
  const email = normalizeEmailAddress(decodeURIComponent(c.req.param("email")));
  if (!z.string().email().safeParse(email).success) return c.json({ error: "Invalid email" }, 400);

  await db.delete(schema.emailSuppressions).where(eq(schema.emailSuppressions.email, email));
  await c.env.DB.prepare(
    `UPDATE users
     SET email_suppressed_at = NULL,
         email_suppression_reason = NULL
     WHERE LOWER(email) = ?`,
  ).bind(email).run();
  await db.insert(schema.activityLog).values({
    userId: c.get("user")?.id ?? null,
    type: "email_bounce",
    summary: `Removed local suppression for ${email}`,
  });
  return c.json({ ok: true, email });
});

app.post("/email-suppressions/sync", zValidator("json", z.object({
  hours: z.number().int().min(1).max(720).optional(),
}).default({})), async (c) => {
  const db = c.get("db");
  const body = c.req.valid("json");
  const result = await syncCloudflareEmailSuppressions(db, c.env, {
    requestUrl: c.req.url,
    hours: body.hours ?? 72,
    userId: c.get("user")?.id ?? null,
    forceCloudflareSync: true,
  });
  return c.json(result);
});

app.get("/email-verify", async (c) => {
  const hours = Math.max(1, Math.min(720, Number(c.req.query("hours") ?? 72) || 72));
  const q = (c.req.query("q") ?? "").trim().toLowerCase();
  const riskFilter = (c.req.query("risk") ?? "all").trim().toLowerCase();
  const actionFilter = (c.req.query("action") ?? "all").trim().toLowerCase();
  const includeSuppressed = c.req.query("includeSuppressed") !== "false";
  const candidateLimit = Math.max(1, Math.min(100, Number(c.req.query("candidateLimit") ?? 100) || 100));
  const configured = cloudflareEmailApiConfigured(c.env);
  const errors: string[] = [];
  const groups = new Map<string, {
    email: string;
    classification: EmailFailureClassification;
    attempts: number;
    firstSeenMs: number;
    lastSeenMs: number;
    statuses: Set<string>;
    subjects: Set<string>;
    latest: CloudflareEmailFailure;
    details: string;
    preflight?: EmailPreflightResult | null;
  }>();

  const [users, suppressions, localVerifyErrors, candidateTotal, candidates] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, username, display_name AS displayName, email FROM users WHERE email IS NOT NULL AND TRIM(email) != ''`,
    ).all<{ id: number; username: string; displayName: string; email: string }>(),
    c.env.DB.prepare(
      `SELECT email, reason, updated_at AS updatedAt, cf_suppression_status AS cfSuppressionStatus
       FROM email_suppressions`,
    ).all<{ email: string; reason: string; updatedAt: number; cfSuppressionStatus: string | null }>(),
    c.env.DB.prepare(
      `SELECT email, subject, status, message, error_code AS errorCode, created_at AS createdAt
       FROM email_events
       WHERE kind = 'email_verify' AND status IN ('error', 'suppressed', 'preflight_risky', 'preflight_ok')
       ORDER BY created_at DESC
       LIMIT 500`,
    ).all<{ email: string; subject: string; status: string; message: string | null; errorCode: string | null; createdAt: number }>(),
    emailVerifyCandidateCount(c, q),
    emailVerifyCandidates(c, candidateLimit, q),
  ]);

  for (const row of localVerifyErrors.results ?? []) {
    const email = String(row.email ?? "").trim().toLowerCase();
    if (!email || groups.has(email)) continue;
    const detail = [row.status, row.errorCode, row.message].filter(Boolean).join(" | ");
    groups.set(email, {
      email,
      classification: classifyLocalEmailError(email, detail || "local verify send failed"),
      attempts: 1,
      firstSeenMs: Number(row.createdAt ?? 0) * 1000,
      lastSeenMs: Number(row.createdAt ?? 0) * 1000,
      statuses: new Set([row.status, row.errorCode].filter(Boolean).map(String)),
      subjects: new Set(row.subject ? [row.subject] : []),
      latest: {
        datetime: row.createdAt ? safeISO(row.createdAt) : undefined,
        to: email,
        subject: row.subject,
        status: row.status,
        errorCause: row.errorCode ?? undefined,
        errorDetail: row.message ?? undefined,
      },
      details: detail,
    });
  }

  const userByEmail = new Map((users.results ?? []).map((row) => [String(row.email).toLowerCase(), row]));
  const suppressionByEmail = new Map((suppressions.results ?? []).map((row) => [String(row.email).toLowerCase(), row]));
  const candidateRows = candidates.map((user) => {
    const email = String(user.email ?? "").trim().toLowerCase();
    return {
      rowType: "candidate" as const,
      email,
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      suppressed: false,
      suppressionReason: null,
      suppressionUpdatedAt: null,
      cfSuppressionStatus: null,
      attempts: 0,
      firstSeenAt: null,
      lastSeenAt: null,
      statuses: ["never_emailed"],
      subjects: ["Email preflight candidate"],
      latest: null,
      details: "Never emailed; selected rows run syntax, typo, disposable, MX and A/AAAA checks only. No email will be sent.",
      preflight: null,
      category: "not_checked",
      label: "not checked",
      risk: "system" as const,
      action: "review" as const,
      score: 0,
      temporary: false,
      reason: "Never emailed. Select and run preflight checks.",
      evidence: ["no previous email event"],
    };
  }).filter((row) => row.email && !groups.has(row.email));

  const riskRows = [...groups.values()].map((group) => {
    const user = userByEmail.get(group.email);
    const suppression = suppressionByEmail.get(group.email);
    return {
      rowType: "risk" as const,
      email: group.email,
      userId: user?.id ?? null,
      username: user?.username ?? null,
      displayName: user?.displayName ?? null,
      suppressed: Boolean(suppression),
      suppressionReason: suppression?.reason ?? null,
      suppressionUpdatedAt: suppression?.updatedAt ? safeISO(suppression.updatedAt) : null,
      cfSuppressionStatus: suppression?.cfSuppressionStatus ?? null,
      attempts: group.attempts,
      firstSeenAt: group.firstSeenMs ? new Date(group.firstSeenMs).toISOString() : null,
      lastSeenAt: group.lastSeenMs ? new Date(group.lastSeenMs).toISOString() : null,
      statuses: [...group.statuses].slice(0, 6),
      subjects: [...group.subjects].slice(0, 3),
      latest: group.latest,
      details: group.details,
      preflight: group.preflight ?? null,
      ...group.classification,
    };
  });

  const rows = [...candidateRows, ...riskRows].filter((row) => {
    if (!includeSuppressed && row.suppressed) return false;
    if (riskFilter !== "all" && row.risk !== riskFilter) return false;
    if (actionFilter !== "all" && row.action !== actionFilter) return false;
    if (!q) return true;
    return [
      row.email,
      row.username,
      row.displayName,
      row.category,
      row.reason,
      row.details,
    ].filter(Boolean).join(" ").toLowerCase().includes(q);
  }).sort((a, b) => {
    if (a.suppressed !== b.suppressed) return a.suppressed ? 1 : -1;
    if (a.rowType !== b.rowType) return a.rowType === "candidate" ? -1 : 1;
    const risk = riskRank(b.risk) - riskRank(a.risk);
    if (risk) return risk;
    if (b.score !== a.score) return b.score - a.score;
    return Date.parse(b.lastSeenAt ?? "") - Date.parse(a.lastSeenAt ?? "");
  });

  const summary = rows.reduce((acc, row) => {
    acc.risk[row.risk] = (acc.risk[row.risk] ?? 0) + 1;
    acc.category[row.category] = (acc.category[row.category] ?? 0) + 1;
    acc.action[row.action] = (acc.action[row.action] ?? 0) + 1;
    if (row.suppressed) acc.suppressed += 1;
    return acc;
  }, {
    risk: {} as Record<string, number>,
    category: {} as Record<string, number>,
    action: {} as Record<string, number>,
    suppressed: 0,
  });

  return c.json({
    configured,
    hours,
    errors,
    total: rows.length,
    candidateLimit,
    candidateTotal,
    candidatePreview: candidates,
    summary,
    rows,
  });
});

app.post("/email-verify/suppress", zValidator("json", z.object({
  emails: z.array(z.string().min(3).max(254)).min(1).max(200),
  reason: z.string().min(1).max(120).optional(),
})), async (c) => {
  const db = c.get("db");
  const body = c.req.valid("json");
  const admin = c.get("user");
  const emails = [...new Set(body.emails.map((email) => email.trim().toLowerCase()))];
  const reason = body.reason ?? "admin_email_verify_risky";
  const results: Array<{ email: string; ok: boolean; error?: string }> = [];

  for (const email of emails) {
    try {
      const cloudflareSyncable = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      await recordEmailSuppression(db, c.env, email, {
        reason,
        source: "admin_email_verify",
        details: `Suppressed from Email Verify by ${admin?.username ?? "admin"}`,
        forceCloudflareSync: cloudflareSyncable,
        skipCloudflareSync: !cloudflareSyncable,
        waitUntil: c.executionCtx.waitUntil.bind(c.executionCtx),
      });
      await c.env.DB.prepare(
        `UPDATE email_events
         SET status = 'suppressed', message = ?, error_code = ?
         WHERE LOWER(email) = ?`,
      ).bind("Suppressed from Email Verify", reason, email).run();
      await c.env.DB.prepare(
        `UPDATE marketing_sends
         SET status = 'suppressed'
         WHERE LOWER(email) = ?`,
      ).bind(email).run();
      results.push({ email, ok: true });
    } catch (error) {
      results.push({ email, ok: false, error: error instanceof Error ? error.message : "suppression failed" });
    }
  }

  await db.insert(schema.activityLog).values({
    userId: admin?.id ?? null,
    type: "email_bounce",
    summary: `Email Verify suppressed ${results.filter((row) => row.ok).length}/${emails.length} selected emails`,
    createdAt: new Date(),
  });

  return c.json({
    ok: results.every((row) => row.ok),
    total: results.length,
    suppressed: results.filter((row) => row.ok).length,
    errors: results.filter((row) => !row.ok),
    results,
  });
});

app.post("/email-verify/run", zValidator("json", z.object({
  limit: z.number().int().min(1).max(100).optional(),
  emails: z.array(z.string().min(3).max(254)).max(100).optional(),
}).default({})), async (c) => {
  const db = c.get("db");
  const admin = c.get("user");
  const body = c.req.valid("json");
  const selectedEmails = body.emails?.map((email) => email.trim().toLowerCase()).filter(Boolean) ?? [];
  const limit = Math.max(1, Math.min(100, body.limit ?? 100));
  const users = selectedEmails.length
    ? await emailVerifyCandidatesByEmails(c, selectedEmails)
    : await emailVerifyCandidates(c, limit);
  const skipped = selectedEmails.length ? Math.max(0, [...new Set(selectedEmails)].length - users.length) : 0;
  const preflightResults = await mapWithConcurrency(users, 10, async (user) => {
    const preflight = await preflightEmail(user.email);
    const classification = classificationForPreflight(preflight);
    return {
      user,
      preflight,
      classification,
    };
  });

  const results: Array<{
    userId: number;
    username: string;
    email: string;
    status: string;
    eventId: number | null;
    preflight: EmailPreflightResult;
  }> = [];

  for (const { user, preflight, classification } of preflightResults) {
    const status = classification.action === "ignore" ? "preflight_ok" : "preflight_risky";
    const [event] = await db
      .insert(schema.emailEvents)
      .values({
        userId: user.id,
        email: preflight.email || user.email.trim().toLowerCase(),
        kind: "email_verify",
        subject: "FSTDESK Forum email preflight",
        status,
        relatedType: "admin_email_verify",
        message: preflightDetail(preflight, classification),
        errorCode: `preflight_${classification.category}`,
        createdAt: new Date(),
      })
      .returning({ id: schema.emailEvents.id });
    results.push({
      userId: user.id,
      username: user.username,
      email: user.email,
      status,
      eventId: event?.id ?? null,
      preflight,
    });
  }

  const counts = results.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {});
  const passed = counts.preflight_ok ?? 0;
  const risky = counts.preflight_risky ?? 0;
  const remaining = await emailVerifyCandidateCount(c);
  await db.insert(schema.activityLog).values({
    userId: admin?.id ?? null,
    type: "email_verify",
    summary: `Email Verify checked ${results.length} ${selectedEmails.length ? "selected" : "batch"} users with passive preflight (${passed} passed, ${risky} risky, ${skipped} already checked, ${remaining} remaining, 0 emails sent)`,
    createdAt: new Date(),
  });

  return c.json({
    ok: true,
    total: results.length,
    remaining,
    okPreflight: passed,
    risky,
    sent: 0,
    skipped,
    suppressed: counts.suppressed ?? 0,
    preflightBlocked: counts.preflight_risky ?? 0,
    error: counts.error ?? 0,
    results,
  });
});

app.patch("/users/:id/role", requireRole("admin"), zValidator("json", z.object({ role: z.enum(["admin", "moderator", "member"]) })), async (c) => {
  const db = c.get("db");
  const id = Number(c.req.param("id"));
  const { role } = c.req.valid("json");
  await db.update(schema.users).set({ role }).where(eq(schema.users.id, id));
  return c.json({ ok: true });
});

app.on(["PATCH", "POST"], "/users/:id/ban", requireRole("admin"), async (c) => {
  const db = c.get("db");
  const id = Number(c.req.param("id"));
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, id) });
  if (!user) return c.json({ error: "Not found" }, 404);
  await db.update(schema.users).set({ banned: !user.banned }).where(eq(schema.users.id, id));
  return c.json({ ok: true, banned: !user.banned });
});

app.patch("/users/:id",
  requireRole("admin"),
  zValidator("json", z.object({
    displayName: z.string().min(1).max(80).optional(),
    email: z.string().email().optional(),
    bio: z.string().max(500).optional(),
    avatarUrl: z.string().url().optional().or(z.literal("")),
  })),
  async (c) => {
    const db = c.get("db");
    const id = Number(c.req.param("id"));
    const body = c.req.valid("json");
    const target = await db.query.users.findFirst({ where: eq(schema.users.id, id) });
    if (!target) return c.json({ error: "Not found" }, 404);
    const update: Record<string, unknown> = {};
    if (body.displayName !== undefined) update.displayName = body.displayName;
    if (body.email !== undefined) {
      const email = body.email.trim().toLowerCase();
      if (email !== target.email.toLowerCase()) {
        const existing = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
        if (existing && existing.id !== target.id) return c.json({ error: "Email is already used by another account" }, 409);
        if (await isEmailSuppressed(db, email)) return c.json({ error: "This email is suppressed and cannot receive mail" }, 409);
        update.email = email;
        update.emailVerifiedAt = null;
        update.emailSuppressedAt = null;
        update.emailSuppressionReason = null;
      }
    }
    if (body.bio !== undefined) update.bio = body.bio;
    if (body.avatarUrl !== undefined) update.avatarUrl = body.avatarUrl || null;
    if (!Object.keys(update).length) return c.json({ ok: true });
    await db.update(schema.users).set(update).where(eq(schema.users.id, id));
    const updated = await db.query.users.findFirst({ where: eq(schema.users.id, id) });
    return c.json({ ok: true, user: updated ? toPublicUser(updated) : null });
  }
);

app.delete("/users/:id", requireRole("admin"), async (c) => {
  const db = c.get("db");
  const admin = c.get("user");
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: "Invalid user id" }, 400);
  if (admin?.id === id) return c.json({ error: "You cannot delete your own account" }, 409);

  const target = await db.query.users.findFirst({ where: eq(schema.users.id, id) });
  if (!target) return c.json({ error: "Not found" }, 404);

  const [threadRow, postRow] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) AS count FROM threads WHERE user_id = ?").bind(id).first<{ count: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS count FROM posts WHERE user_id = ?").bind(id).first<{ count: number }>(),
  ]);
  const threadCount = Number(threadRow?.count ?? 0);
  const postCount = Number(postRow?.count ?? 0);
  if (threadCount > 0 || postCount > 0) {
    return c.json({
      error: `User has ${threadCount} topics and ${postCount} replies; delete blocked`,
      threadCount,
      postCount,
    }, 409);
  }

  const deleted = await c.env.DB.prepare(
    `DELETE FROM users
     WHERE id = ?
       AND NOT EXISTS (SELECT 1 FROM threads WHERE user_id = ?)
       AND NOT EXISTS (SELECT 1 FROM posts WHERE user_id = ?)`,
  ).bind(id, id, id).run();
  if (Number(deleted.meta?.changes ?? 0) !== 1) {
    return c.json({ error: "User has topics or replies; delete blocked" }, 409);
  }

  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM notification_preferences WHERE user_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM likes WHERE user_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM attachments WHERE user_id = ?").bind(id),
    c.env.DB.prepare("UPDATE activity_log SET user_id = NULL WHERE user_id = ?").bind(id),
    c.env.DB.prepare("UPDATE error_events SET user_id = NULL WHERE user_id = ?").bind(id),
    c.env.DB.prepare("UPDATE email_events SET user_id = NULL WHERE user_id = ?").bind(id),
    c.env.DB.prepare("UPDATE marketing_sends SET user_id = NULL WHERE user_id = ?").bind(id),
    c.env.DB.prepare("UPDATE marketing_sends SET sent_by_user_id = NULL WHERE sent_by_user_id = ?").bind(id),
    c.env.DB.prepare("UPDATE analytics_pageviews SET user_id = NULL WHERE user_id = ?").bind(id),
    c.env.DB.prepare("UPDATE anchor_links SET created_by_user_id = NULL WHERE created_by_user_id = ?").bind(id),
  ]);

  await db.insert(schema.activityLog).values({
    userId: admin?.id ?? null,
    type: "admin",
    summary: `Deleted user ${target.username}`,
    createdAt: new Date(),
  });

  return c.json({ ok: true, deleted: id });
});

app.get("/logs", async (c) => {
  const db = c.get("db");
  const page = Math.max(1, Number(c.req.query("page") ?? 1));
  const type = c.req.query("type") ?? "";
  const perPage = Math.min(200, Math.max(10, Number(c.req.query("perPage") ?? 30)));
  const where = type ? eq(schema.activityLog.type, type) : undefined;
  const rows = await db
    .select()
    .from(schema.activityLog)
    .where(where)
    .orderBy(desc(schema.activityLog.createdAt))
    .limit(perPage)
    .offset((page - 1) * perPage);
  const total = await db.$count(schema.activityLog, where);
  return c.json({
    logs: rows.map((r) => ({ ...r, createdAt: safeISO(r.createdAt) })),
    total, page, perPage,
  });
});

app.delete("/logs", async (c) => {
  const db = c.get("db");
  const total = await db.$count(schema.activityLog);
  await db.delete(schema.activityLog);
  return c.json({ ok: true, deleted: total });
});

app.get("/logs/export", async (c) => {
  const db = c.get("db");
  const type = c.req.query("type") ?? "";
  const format = c.req.query("format") === "json" ? "json" : "csv";
  const where = type ? eq(schema.activityLog.type, type) : undefined;
  const rows = await db
    .select()
    .from(schema.activityLog)
    .where(where)
    .orderBy(desc(schema.activityLog.createdAt))
    .limit(5000);
  const mapped = rows.map((row) => ({
    id: row.id,
    type: row.type,
    userId: row.userId,
    summary: row.summary,
    createdAt: safeISO(row.createdAt),
  }));
  if (format === "json") {
    return downloadText(c, "fstdesk-activity-logs.json", JSON.stringify(mapped, null, 2), "application/json; charset=utf-8");
  }
  return downloadText(c, "fstdesk-activity-logs.csv", csvRows(["id", "type", "userId", "summary", "createdAt"], mapped), "text/csv; charset=utf-8");
});

app.get("/error-events", async (c) => {
  if (!(await ensureErrorEventsSchema(c.env.DB))) return c.json({ events: [], total: 0, page: 1, perPage: 50 });
  const page = Math.max(1, Number(c.req.query("page") ?? 1));
  const perPage = Math.min(200, Math.max(10, Number(c.req.query("perPage") ?? 50)));
  const level = (c.req.query("level") ?? "").trim().toLowerCase();
  const source = (c.req.query("source") ?? "").trim().toLowerCase();
  const q = (c.req.query("q") ?? "").trim().toLowerCase();
  const search = errorEventSearch(q);
  const clauses = ["1=1"];
  const bindings: Array<string | number> = [];
  if (level) {
    clauses.push("level = ?");
    bindings.push(level);
  }
  if (source) {
    clauses.push("source = ?");
    bindings.push(source);
  }
  if (search.clause) {
    clauses.push(search.clause.replace(/^AND\s+/i, ""));
    bindings.push(...search.bindings);
  }
  const where = clauses.join(" AND ");
  const rows = await c.env.DB.prepare(
    `SELECT id, request_id AS requestId, source, level, kind, message, stack, status, method, path, url,
            user_id AS userId, username, ip, country, colo, user_agent AS userAgent, referrer, metadata, created_at AS createdAt
     FROM error_events
     WHERE ${where}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
  ).bind(...bindings, perPage, (page - 1) * perPage).all();
  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS total FROM error_events WHERE ${where}`).bind(...bindings).first<{ total: number }>();
  return c.json({
    events: (rows.results ?? []).map((row: any) => ({ ...row, createdAt: safeISO(row.createdAt) })),
    total: Number(total?.total ?? 0),
    page,
    perPage,
  });
});

app.delete("/error-events", async (c) => {
  if (!(await ensureErrorEventsSchema(c.env.DB))) return c.json({ ok: true, deleted: 0 });
  const total = await c.env.DB.prepare("SELECT COUNT(*) AS total FROM error_events").first<{ total: number }>();
  await c.env.DB.prepare("DELETE FROM error_events").run();
  return c.json({ ok: true, deleted: Number(total?.total ?? 0) });
});

app.get("/error-events/export", async (c) => {
  if (!(await ensureErrorEventsSchema(c.env.DB))) return downloadText(c, "fstdesk-error-events.csv", "", "text/csv; charset=utf-8");
  const level = (c.req.query("level") ?? "").trim().toLowerCase();
  const source = (c.req.query("source") ?? "").trim().toLowerCase();
  const q = (c.req.query("q") ?? "").trim().toLowerCase();
  const format = c.req.query("format") === "json" ? "json" : "csv";
  const search = errorEventSearch(q);
  const clauses = ["1=1"];
  const bindings: Array<string | number> = [];
  if (level) {
    clauses.push("level = ?");
    bindings.push(level);
  }
  if (source) {
    clauses.push("source = ?");
    bindings.push(source);
  }
  if (search.clause) {
    clauses.push(search.clause.replace(/^AND\s+/i, ""));
    bindings.push(...search.bindings);
  }
  const rows = await c.env.DB.prepare(
    `SELECT id, request_id AS requestId, source, level, kind, message, stack, status, method, path, url,
            user_id AS userId, username, ip, country, colo, user_agent AS userAgent, referrer, metadata, created_at AS createdAt
     FROM error_events
     WHERE ${clauses.join(" AND ")}
     ORDER BY created_at DESC
     LIMIT 10000`,
  ).bind(...bindings).all();
  const mapped = (rows.results ?? []).map((row: any) => ({ ...row, createdAt: safeISO(row.createdAt) }));
  if (format === "json") {
    return downloadText(c, "fstdesk-error-events.json", JSON.stringify(mapped, null, 2), "application/json; charset=utf-8");
  }
  return downloadText(
    c,
    "fstdesk-error-events.csv",
    csvRows(["id", "createdAt", "level", "source", "kind", "status", "method", "path", "message", "username", "ip", "country", "colo", "requestId", "metadata", "stack"], mapped),
    "text/csv; charset=utf-8",
  );
});

app.get("/email-events", async (c) => {
  const db = c.get("db");
  const page = Math.max(1, Number(c.req.query("page") ?? 1));
  const kind = c.req.query("kind") ?? "";
  const perPage = 40;
  const where = kind ? eq(schema.emailEvents.kind, kind) : undefined;
  const rows = await db
    .select()
    .from(schema.emailEvents)
    .where(where)
    .orderBy(desc(schema.emailEvents.createdAt))
    .limit(perPage)
    .offset((page - 1) * perPage);
  const total = await db.$count(schema.emailEvents, where);
  return c.json({
    events: rows.map((row) => ({
      ...row,
      createdAt: safeISO(row.createdAt),
      openedAt: row.openedAt ? safeISO(row.openedAt) : null,
      lastOpenedAt: row.lastOpenedAt ? safeISO(row.lastOpenedAt) : null,
      clickedAt: row.clickedAt ? safeISO(row.clickedAt) : null,
      lastClickedAt: row.lastClickedAt ? safeISO(row.lastClickedAt) : null,
    })),
    total,
    page,
    perPage,
  });
});

app.get("/notifications", async (c) => {
  const db = c.get("db");
  const [eventCount, suppressionCount, prefCount] = await Promise.all([
    db.$count(schema.emailEvents),
    db.$count(schema.emailSuppressions),
    db.$count(schema.notificationPreferences),
  ]);
  const statusRows = await c.env.DB.prepare(
    "SELECT status, COUNT(*) AS count FROM email_events GROUP BY status ORDER BY count DESC",
  ).all<{ status: string; count: number }>();
  const kindRows = await c.env.DB.prepare(
    "SELECT kind, COUNT(*) AS count FROM email_events GROUP BY kind ORDER BY count DESC",
  ).all<{ kind: string; count: number }>();
  const cfRows = await c.env.DB.prepare(
    "SELECT COALESCE(cf_suppression_status, 'unknown') AS status, COUNT(*) AS count FROM email_suppressions GROUP BY COALESCE(cf_suppression_status, 'unknown') ORDER BY count DESC",
  ).all<{ status: string; count: number }>();
  return c.json({
    eventCount,
    suppressionCount,
    preferenceCount: prefCount,
    byStatus: statusRows.results ?? [],
    byKind: kindRows.results ?? [],
    cfSuppressionStatus: cfRows.results ?? [],
  });
});

app.get("/analytics", async (c) => {
  const days = Math.max(1, Math.min(90, Number(c.req.query("days") ?? 7) || 7));
  const onlineWindowSeconds = 300;
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const onlineSince = Math.floor(Date.now() / 1000) - onlineWindowSeconds;
  const bindSince = (sqlText: string) => c.env.DB.prepare(sqlText).bind(since);

  const [
    summary,
    onlineSummary,
    sourceRows,
    campaignRows,
    countryRows,
    routeRows,
    deviceRows,
    pathRows,
    userRows,
    referrerRows,
    timelineRows,
    onlineRows,
    recentRows,
  ] = await Promise.all([
    bindSince(
      `SELECT
        COUNT(*) AS pageviews,
        COUNT(DISTINCT ap.visitor_id) AS visitors,
        SUM(CASE WHEN ap.user_id IS NOT NULL THEN 1 ELSE 0 END) AS userViews,
        SUM(CASE WHEN ap.user_id IS NULL THEN 1 ELSE 0 END) AS anonymousViews,
        SUM(CASE WHEN ap.is_repeat = 1 THEN 1 ELSE 0 END) AS repeatViews,
        0 AS botViews,
        AVG(NULLIF(ap.duration_ms, 0)) AS avgDurationMs,
        MAX(ap.created_at) AS lastSeenAt
       FROM analytics_pageviews ap
       LEFT JOIN users u ON u.id = ap.user_id
       WHERE ap.created_at >= ?
        AND COALESCE(ap.is_bot, 0) = 0
        AND (u.id IS NULL OR COALESCE(u.role, 'member') != 'admin')`,
    ).first<Record<string, unknown>>(),
    c.env.DB.prepare(
      `SELECT
        COUNT(DISTINCT ap.visitor_id) AS onlineVisitors,
        COUNT(DISTINCT CASE WHEN ap.user_id IS NOT NULL THEN ap.visitor_id END) AS onlineSignedIn,
        COUNT(DISTINCT CASE WHEN ap.user_id IS NULL THEN ap.visitor_id END) AS onlineAnonymous,
        COUNT(DISTINCT CASE WHEN ap.is_repeat = 1 THEN ap.visitor_id END) AS onlineRepeat,
        0 AS onlineBots,
        MAX(ap.last_seen_at) AS lastSeenAt
       FROM analytics_pageviews ap
       LEFT JOIN users u ON u.id = ap.user_id
       WHERE ap.last_seen_at >= ?
        AND COALESCE(ap.is_bot, 0) = 0
        AND (u.id IS NULL OR COALESCE(u.role, 'member') != 'admin')`,
    ).bind(onlineSince).first<Record<string, unknown>>(),
    bindSince(
      `SELECT source, medium, COUNT(*) AS views, COUNT(DISTINCT visitor_id) AS visitors, AVG(NULLIF(duration_ms, 0)) AS avgDurationMs
       FROM analytics_pageviews
       WHERE created_at >= ?
       GROUP BY source, medium
       ORDER BY views DESC
       LIMIT 12`,
    ).all<Record<string, unknown>>(),
    bindSince(
      `SELECT source, medium, campaign,
        utm_source AS utmSource, utm_medium AS utmMedium, utm_campaign AS utmCampaign,
        utm_term AS utmTerm, utm_content AS utmContent,
        COUNT(*) AS views, COUNT(DISTINCT visitor_id) AS visitors, AVG(NULLIF(duration_ms, 0)) AS avgDurationMs
       FROM analytics_pageviews
       WHERE created_at >= ?
        AND (
          utm_source IS NOT NULL OR utm_medium IS NOT NULL OR utm_campaign IS NOT NULL
          OR utm_term IS NOT NULL OR utm_content IS NOT NULL OR campaign IS NOT NULL
        )
       GROUP BY source, medium, campaign, utm_source, utm_medium, utm_campaign, utm_term, utm_content
       ORDER BY views DESC
       LIMIT 20`,
    ).all<Record<string, unknown>>(),
    bindSince(
      `SELECT COALESCE(NULLIF(country, ''), 'unknown') AS country, COUNT(*) AS views, COUNT(DISTINCT visitor_id) AS visitors
       FROM analytics_pageviews
       WHERE created_at >= ?
       GROUP BY COALESCE(NULLIF(country, ''), 'unknown')
       ORDER BY views DESC
       LIMIT 16`,
    ).all<Record<string, unknown>>(),
    bindSince(
      `SELECT route_type AS routeType, COUNT(*) AS views, COUNT(DISTINCT visitor_id) AS visitors, AVG(NULLIF(duration_ms, 0)) AS avgDurationMs
       FROM analytics_pageviews
       WHERE created_at >= ?
       GROUP BY route_type
       ORDER BY views DESC`,
    ).all<Record<string, unknown>>(),
    bindSince(
      `SELECT device_type AS deviceType, browser, os, COUNT(*) AS views, COUNT(DISTINCT visitor_id) AS visitors
       FROM analytics_pageviews
       WHERE created_at >= ?
       GROUP BY device_type, browser, os
       ORDER BY views DESC
       LIMIT 16`,
    ).all<Record<string, unknown>>(),
    bindSince(
      `SELECT path, route_type AS routeType, COUNT(*) AS views, COUNT(DISTINCT visitor_id) AS visitors,
        SUM(CASE WHEN user_id IS NOT NULL THEN 1 ELSE 0 END) AS userViews,
        AVG(NULLIF(duration_ms, 0)) AS avgDurationMs
       FROM analytics_pageviews
       WHERE created_at >= ?
       GROUP BY path, route_type
       ORDER BY views DESC
       LIMIT 30`,
    ).all<Record<string, unknown>>(),
    bindSince(
      `SELECT u.username, u.display_name AS displayName, COUNT(*) AS views, COUNT(DISTINCT ap.visitor_id) AS visitors,
        MAX(ap.created_at) AS lastSeenAt, AVG(NULLIF(ap.duration_ms, 0)) AS avgDurationMs
       FROM analytics_pageviews ap
       INNER JOIN users u ON u.id = ap.user_id
       WHERE ap.created_at >= ?
       GROUP BY ap.user_id
       ORDER BY views DESC
       LIMIT 20`,
    ).all<Record<string, unknown>>(),
    bindSince(
      `SELECT COALESCE(NULLIF(referrer_host, ''), 'direct') AS referrerHost,
        MIN(NULLIF(referrer, '')) AS sampleReferrer,
        COUNT(*) AS views, COUNT(DISTINCT visitor_id) AS visitors
       FROM analytics_pageviews
       WHERE created_at >= ?
       GROUP BY COALESCE(NULLIF(referrer_host, ''), 'direct')
       ORDER BY views DESC
       LIMIT 16`,
    ).all<Record<string, unknown>>(),
    bindSince(
      `SELECT strftime('%Y-%m-%d %H:00', created_at, 'unixepoch') AS bucket, COUNT(*) AS views, COUNT(DISTINCT visitor_id) AS visitors
       FROM analytics_pageviews
       WHERE created_at >= ?
       GROUP BY bucket
       ORDER BY bucket ASC`,
    ).all<Record<string, unknown>>(),
    c.env.DB.prepare(
      `WITH latest_seen AS (
        SELECT visitor_id, MAX(last_seen_at) AS lastSeenAt
        FROM analytics_pageviews
        WHERE last_seen_at >= ?
        GROUP BY visitor_id
      ),
      latest AS (
        SELECT MAX(ap.id) AS id
        FROM analytics_pageviews ap
        INNER JOIN latest_seen ls ON ls.visitor_id = ap.visitor_id AND ls.lastSeenAt = ap.last_seen_at
        GROUP BY ap.visitor_id
      ),
      visitor_entry AS (
        SELECT visitor_id, MIN(id) AS entryId
        FROM analytics_pageviews
        GROUP BY visitor_id
      )
      SELECT ap.id, ap.path, ap.route_type AS routeType, ap.source, ap.medium, ap.campaign,
        ap.referrer, ap.referrer_host AS referrerHost,
        ap.utm_source AS utmSource, ap.utm_medium AS utmMedium, ap.utm_campaign AS utmCampaign,
        ap.utm_term AS utmTerm, ap.utm_content AS utmContent,
        entry.path AS entryPath, entry.source AS entrySource, entry.medium AS entryMedium,
        entry.campaign AS entryCampaign, entry.referrer_host AS entryReferrerHost,
        entry.utm_source AS entryUtmSource, entry.utm_medium AS entryUtmMedium, entry.utm_campaign AS entryUtmCampaign,
        entry.utm_term AS entryUtmTerm, entry.utm_content AS entryUtmContent,
        ap.country, ap.city, ap.colo,
        ap.device_type AS deviceType, ap.browser, ap.os, ap.is_repeat AS isRepeat, ap.is_bot AS isBot,
        ap.duration_ms AS durationMs, ap.created_at AS createdAt, ap.last_seen_at AS lastSeenAt,
        u.username, u.display_name AS displayName
       FROM latest
       INNER JOIN analytics_pageviews ap ON ap.id = latest.id
       LEFT JOIN visitor_entry ve ON ve.visitor_id = ap.visitor_id
       LEFT JOIN analytics_pageviews entry ON entry.id = ve.entryId
       LEFT JOIN users u ON u.id = ap.user_id
       ORDER BY ap.last_seen_at DESC
       LIMIT 80`,
    ).bind(onlineSince).all<Record<string, unknown>>(),
    bindSince(
      `WITH visitor_entry AS (
        SELECT visitor_id, MIN(id) AS entryId
        FROM analytics_pageviews
        GROUP BY visitor_id
      )
      SELECT ap.id, ap.path, ap.route_type AS routeType, ap.source, ap.medium, ap.campaign,
        ap.referrer, ap.referrer_host AS referrerHost,
        ap.utm_source AS utmSource, ap.utm_medium AS utmMedium, ap.utm_campaign AS utmCampaign,
        ap.utm_term AS utmTerm, ap.utm_content AS utmContent,
        entry.path AS entryPath, entry.source AS entrySource, entry.medium AS entryMedium,
        entry.campaign AS entryCampaign, entry.referrer_host AS entryReferrerHost,
        entry.utm_source AS entryUtmSource, entry.utm_medium AS entryUtmMedium, entry.utm_campaign AS entryUtmCampaign,
        entry.utm_term AS entryUtmTerm, entry.utm_content AS entryUtmContent,
        ap.country, ap.city, ap.colo,
        ap.device_type AS deviceType, ap.browser, ap.os, ap.is_repeat AS isRepeat, ap.is_bot AS isBot,
        ap.duration_ms AS durationMs, ap.created_at AS createdAt, ap.last_seen_at AS lastSeenAt,
        u.username, u.display_name AS displayName
       FROM analytics_pageviews ap
       LEFT JOIN visitor_entry ve ON ve.visitor_id = ap.visitor_id
       LEFT JOIN analytics_pageviews entry ON entry.id = ve.entryId
       LEFT JOIN users u ON u.id = ap.user_id
       WHERE ap.created_at >= ?
       ORDER BY ap.created_at DESC
       LIMIT 60`,
    ).all<Record<string, unknown>>(),
  ]);

  const asNumber = (value: unknown) => Number(value ?? 0);
  const rows = (result: D1Result<Record<string, unknown>>) => result.results ?? [];
  return c.json({
    days,
    summary: {
      pageviews: asNumber(summary?.pageviews),
      visitors: asNumber(summary?.visitors),
      userViews: asNumber(summary?.userViews),
      anonymousViews: asNumber(summary?.anonymousViews),
      repeatViews: asNumber(summary?.repeatViews),
      botViews: asNumber(summary?.botViews),
      avgDurationMs: Math.round(asNumber(summary?.avgDurationMs)),
      lastSeenAt: summary?.lastSeenAt ? safeISO(asNumber(summary.lastSeenAt)) : null,
      onlineVisitors: asNumber(onlineSummary?.onlineVisitors),
      onlineSignedIn: asNumber(onlineSummary?.onlineSignedIn),
      onlineAnonymous: asNumber(onlineSummary?.onlineAnonymous),
      onlineRepeat: asNumber(onlineSummary?.onlineRepeat),
      onlineBots: asNumber(onlineSummary?.onlineBots),
      onlineWindowSeconds,
      onlineLastSeenAt: onlineSummary?.lastSeenAt ? safeISO(asNumber(onlineSummary.lastSeenAt)) : null,
    },
    sources: rows(sourceRows).map((row) => ({ ...row, views: asNumber(row.views), visitors: asNumber(row.visitors), avgDurationMs: Math.round(asNumber(row.avgDurationMs)) })),
    campaigns: rows(campaignRows).map((row) => ({ ...row, views: asNumber(row.views), visitors: asNumber(row.visitors), avgDurationMs: Math.round(asNumber(row.avgDurationMs)) })),
    countries: rows(countryRows).map((row) => ({ ...row, views: asNumber(row.views), visitors: asNumber(row.visitors) })),
    routes: rows(routeRows).map((row) => ({ ...row, views: asNumber(row.views), visitors: asNumber(row.visitors), avgDurationMs: Math.round(asNumber(row.avgDurationMs)) })),
    devices: rows(deviceRows).map((row) => ({ ...row, views: asNumber(row.views), visitors: asNumber(row.visitors) })),
    paths: rows(pathRows).map((row) => ({ ...row, views: asNumber(row.views), visitors: asNumber(row.visitors), userViews: asNumber(row.userViews), avgDurationMs: Math.round(asNumber(row.avgDurationMs)) })),
    users: rows(userRows).map((row) => ({ ...row, views: asNumber(row.views), visitors: asNumber(row.visitors), avgDurationMs: Math.round(asNumber(row.avgDurationMs)), lastSeenAt: row.lastSeenAt ? safeISO(asNumber(row.lastSeenAt)) : null })),
    referrers: rows(referrerRows).map((row) => ({ ...row, views: asNumber(row.views), visitors: asNumber(row.visitors) })),
    timeline: rows(timelineRows).map((row) => ({ ...row, views: asNumber(row.views), visitors: asNumber(row.visitors) })),
    online: rows(onlineRows).map((row) => ({
      ...row,
      isRepeat: Boolean(row.isRepeat),
      isBot: Boolean(row.isBot),
      durationMs: asNumber(row.durationMs),
      createdAt: safeISO(asNumber(row.createdAt)),
      lastSeenAt: safeISO(asNumber(row.lastSeenAt)),
    })),
    recent: rows(recentRows).map((row) => ({
      ...row,
      isRepeat: Boolean(row.isRepeat),
      isBot: Boolean(row.isBot),
      durationMs: asNumber(row.durationMs),
      createdAt: safeISO(asNumber(row.createdAt)),
      lastSeenAt: safeISO(asNumber(row.lastSeenAt)),
    })),
  });
});

app.get("/marketing/template", async (c) => {
  const db = c.get("db");
  const { siteUrl } = await loadEmailSettings(db, c.req.url);
  const mail = weAreBackEmail({ recipientName: "Ufuk", siteUrl });
  return c.json({
    campaignKey: WE_ARE_BACK_CAMPAIGN,
    name: "We are back",
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });
});

app.get("/marketing/users", async (c) => {
  const q = (c.req.query("q") ?? "").trim().toLowerCase();
  const campaign = c.req.query("campaign") || WE_ARE_BACK_CAMPAIGN;
  const like = `%${q}%`;
  const riskJoin = `LEFT JOIN (
        SELECT LOWER(email) AS email, MAX(created_at) AS riskCheckedAt, MAX(error_code) AS riskCode
        FROM email_events
        WHERE kind = 'email_verify' AND status IN ('preflight_risky', 'error', 'suppressed')
        GROUP BY LOWER(email)
       ) evr ON evr.email = LOWER(u.email)`;
  const marketingOrder = `CASE
    WHEN es.email IS NOT NULL OR u.email_suppressed_at IS NOT NULL THEN 1
    WHEN np.all_email = 0 OR np.marketing_email = 0 THEN 1
    WHEN evr.email IS NOT NULL THEN 1
    WHEN COALESCE(ms.sendCount, 0) > 0 THEN 2
    ELSE 0
  END`;
  const query = q
    ? `SELECT u.id, u.username, u.display_name AS displayName, u.email, u.email_suppressed_at AS emailSuppressedAt,
        np.all_email AS allEmail, np.marketing_email AS marketingEmail,
        es.email AS suppressedEmail, es.reason AS suppressionReason, es.updated_at AS suppressionUpdatedAt,
        evr.riskCheckedAt AS riskCheckedAt, evr.riskCode AS riskCode,
        ms.lastSentAt AS lastSentAt,
        COALESCE(ms.sendCount, 0) AS sendCount
       FROM users u
       LEFT JOIN notification_preferences np ON np.user_id = u.id
       LEFT JOIN email_suppressions es ON LOWER(es.email) = LOWER(u.email)
       ${riskJoin}
       LEFT JOIN (
        SELECT user_id, MAX(created_at) AS lastSentAt, COUNT(*) AS sendCount
        FROM marketing_sends
        WHERE campaign_key = ?
        GROUP BY user_id
       ) ms ON ms.user_id = u.id
       WHERE u.banned = 0 AND (LOWER(u.username) LIKE ? OR LOWER(u.display_name) LIKE ? OR LOWER(u.email) LIKE ?)
       ORDER BY ${marketingOrder} ASC, COALESCE(ms.lastSentAt, 0) DESC, u.username COLLATE NOCASE ASC`
    : `SELECT u.id, u.username, u.display_name AS displayName, u.email, u.email_suppressed_at AS emailSuppressedAt,
        np.all_email AS allEmail, np.marketing_email AS marketingEmail,
        es.email AS suppressedEmail, es.reason AS suppressionReason, es.updated_at AS suppressionUpdatedAt,
        evr.riskCheckedAt AS riskCheckedAt, evr.riskCode AS riskCode,
        ms.lastSentAt AS lastSentAt,
        COALESCE(ms.sendCount, 0) AS sendCount
       FROM users u
       LEFT JOIN notification_preferences np ON np.user_id = u.id
       LEFT JOIN email_suppressions es ON LOWER(es.email) = LOWER(u.email)
       ${riskJoin}
       LEFT JOIN (
        SELECT user_id, MAX(created_at) AS lastSentAt, COUNT(*) AS sendCount
        FROM marketing_sends
        WHERE campaign_key = ?
        GROUP BY user_id
       ) ms ON ms.user_id = u.id
       WHERE u.banned = 0
       ORDER BY ${marketingOrder} ASC, COALESCE(ms.lastSentAt, 0) DESC, u.created_at DESC`;
  const stmt = c.env.DB.prepare(query).bind(...(q ? [campaign, like, like, like] : [campaign]));
  const rows = await stmt.all<{
    id: number;
    username: string;
    displayName: string;
    email: string;
    emailSuppressedAt: number | null;
    allEmail: number | null;
    marketingEmail: number | null;
    suppressedEmail: string | null;
    suppressionReason: string | null;
    suppressionUpdatedAt: number | null;
    riskCheckedAt: number | null;
    riskCode: string | null;
    lastSentAt: number | null;
    sendCount: number;
  }>();
  const totalRows = await c.env.DB.prepare(
    `SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN es.email IS NULL AND u.email_suppressed_at IS NULL AND COALESCE(np.all_email, 1) != 0 AND COALESCE(np.marketing_email, 1) != 0 AND evr.email IS NULL THEN 1 ELSE 0 END) AS subscribed,
      SUM(CASE WHEN es.email IS NULL AND u.email_suppressed_at IS NULL AND (np.all_email = 0 OR np.marketing_email = 0) THEN 1 ELSE 0 END) AS unsubscribed,
      SUM(CASE WHEN es.email IS NOT NULL OR u.email_suppressed_at IS NOT NULL THEN 1 ELSE 0 END) AS suppressed,
      SUM(CASE WHEN es.email IS NULL AND u.email_suppressed_at IS NULL AND COALESCE(np.all_email, 1) != 0 AND COALESCE(np.marketing_email, 1) != 0 AND evr.email IS NOT NULL THEN 1 ELSE 0 END) AS risk
     FROM users u
     LEFT JOIN notification_preferences np ON np.user_id = u.id
     LEFT JOIN email_suppressions es ON LOWER(es.email) = LOWER(u.email)
     ${riskJoin}
     WHERE u.banned = 0`,
  ).first<{ total: number; subscribed: number | null; unsubscribed: number | null; suppressed: number | null; risk: number | null }>();
  return c.json({
    total: Number(totalRows?.total ?? 0),
    summary: {
      subscribed: Number(totalRows?.subscribed ?? 0),
      unsubscribed: Number(totalRows?.unsubscribed ?? 0),
      suppressed: Number(totalRows?.suppressed ?? 0),
      risk: Number(totalRows?.risk ?? 0),
    },
    users: (rows.results ?? []).map((row) => {
      const suppressed = Boolean(row.emailSuppressedAt || row.suppressedEmail);
      const marketingUnsubscribed = row.allEmail === 0 || row.marketingEmail === 0;
      const riskBlocked = Boolean(row.riskCheckedAt);
      return {
        ...row,
        allEmail: row.allEmail !== 0,
        marketingEmail: row.marketingEmail !== 0,
        marketingUnsubscribed,
        canReceiveMarketing: !suppressed && !marketingUnsubscribed && !riskBlocked,
        marketingStatus: suppressed ? "suppressed" : marketingUnsubscribed ? "unsubscribed" : riskBlocked ? "risk" : "subscribed",
        riskReason: row.riskCode ? `email verify risk: ${row.riskCode}` : null,
        riskCheckedAt: row.riskCheckedAt ? safeISO(row.riskCheckedAt) : null,
        emailSuppressedAt: row.emailSuppressedAt ? safeISO(row.emailSuppressedAt) : row.suppressionUpdatedAt ? safeISO(row.suppressionUpdatedAt) : null,
        lastSentAt: row.lastSentAt ? safeISO(row.lastSentAt) : null,
        sendCount: Number(row.sendCount ?? 0),
      };
    }),
  });
});

app.get("/marketing/sends", async (c) => {
  const page = Math.max(1, Number(c.req.query("page") ?? 1));
  const perPage = 30;
  const rows = await c.env.DB.prepare(
    `SELECT ms.id, ms.campaign_key AS campaignKey, ms.email, ms.status, ms.created_at AS createdAt,
      u.username, u.display_name AS displayName,
      admin.username AS sentByUsername,
      ee.open_count AS openCount, ee.opened_at AS openedAt, ee.last_opened_at AS lastOpenedAt,
      ee.click_count AS clickCount, ee.clicked_at AS clickedAt, ee.last_clicked_at AS lastClickedAt
     FROM marketing_sends ms
     LEFT JOIN users u ON u.id = ms.user_id
     LEFT JOIN users admin ON admin.id = ms.sent_by_user_id
     LEFT JOIN email_events ee ON ee.id = ms.email_event_id
     ORDER BY ms.created_at DESC
     LIMIT ? OFFSET ?`,
  ).bind(perPage, (page - 1) * perPage).all();
  const total = await c.get("db").$count(schema.marketingSends);
  return c.json({
    sends: (rows.results ?? []).map((row: any) => ({
      ...row,
      openCount: Number(row.openCount ?? 0),
      clickCount: Number(row.clickCount ?? 0),
      createdAt: safeISO(row.createdAt),
      openedAt: row.openedAt ? safeISO(row.openedAt) : null,
      lastOpenedAt: row.lastOpenedAt ? safeISO(row.lastOpenedAt) : null,
      clickedAt: row.clickedAt ? safeISO(row.clickedAt) : null,
      lastClickedAt: row.lastClickedAt ? safeISO(row.lastClickedAt) : null,
    })),
    total,
    page,
    perPage,
  });
});

app.get("/marketing/jobs/:id", async (c) => {
  const id = c.req.param("id").trim();
  if (!/^[a-f0-9]{20}$/i.test(id)) return c.json({ error: "Invalid job" }, 400);
  const job = await readMarketingJob(c.env, id);
  if (!job) return c.json({ error: "Job not found" }, 404);
  return c.json({ job: publicMarketingJob(job) });
});

app.get("/anchors", async (c) => {
  const schemaReady = await ensureAnchorLinksSchema(c.env.DB);
  if (!schemaReady) return c.json({ anchors: [], total: 0, warning: "anchor_schema_unavailable" });
  const db = c.get("db");
  const q = (c.req.query("q") ?? "").trim().toLowerCase();
  const rows = await db
    .select()
    .from(schema.anchorLinks)
    .where(
      q
        ? sql`lower(${schema.anchorLinks.term}) like ${`%${q}%`} or lower(${schema.anchorLinks.url}) like ${`%${q}%`} or lower(${schema.anchorLinks.title}) like ${`%${q}%`}`
        : undefined,
    )
    .orderBy(desc(schema.anchorLinks.updatedAt), desc(schema.anchorLinks.clickCount), schema.anchorLinks.term)
    .limit(1000);
  return c.json({ anchors: rows.map(toAdminAnchor), total: rows.length });
});

app.post("/anchors/auto", zValidator("json", anchorAutoBody), async (c) => {
  const schemaReady = await ensureAnchorLinksSchema(c.env.DB);
  if (!schemaReady) return c.json({ error: "anchor_schema_unavailable" }, 503);
  const db = c.get("db");
  const me = c.get("user");
  const body = c.req.valid("json");
  const term = normalizeAnchorTerm(body.term);
  const termWords = anchorTermWords(term);
  if (termWords.length > 3) {
    return c.json({ error: "Anchor terms support up to 3 words" }, 400);
  }
  const needle = `%${term.toLowerCase()}%`;
  const limit = body.limit ?? 50;

  const found = await c.env.DB.prepare(
    `WITH matches AS (
      SELECT id AS thread_id, 3 AS score, updated_at AS touched_at
      FROM threads
      WHERE lower(title) LIKE ?
      UNION ALL
      SELECT id AS thread_id, 2 AS score, updated_at AS touched_at
      FROM threads
      WHERE lower(content) LIKE ?
      UNION ALL
      SELECT thread_id, 1 AS score, created_at AS touched_at
      FROM posts
      WHERE lower(content) LIKE ?
    )
    SELECT
      t.id,
      t.public_id AS publicId,
      t.title,
      t.content,
      COALESCE((SELECT group_concat(p.content, '\n') FROM posts p WHERE p.thread_id = t.id), '') AS repliesText,
      MAX(matches.score) AS score,
      MAX(matches.touched_at) AS touchedAt
    FROM matches
    JOIN threads t ON t.id = matches.thread_id
    GROUP BY t.id
    ORDER BY score DESC, touchedAt DESC
    LIMIT ?`,
  ).bind(needle, needle, needle, limit).all<{
    id: number;
    publicId: string;
    title: string;
    content: string | null;
    repliesText: string | null;
    score: number;
    touchedAt: number | string | null;
  }>();

  const details: string[] = [];
  const targets = (found.results ?? [])
    .filter((row) => row.publicId && row.title)
    .map((row) => {
      const url = `/t/${row.publicId}`;
      const visibleContent = `${row.content ?? ""}\n${row.repliesText ?? ""}`;
      const visible = contentHasAnchorTerm(visibleContent, term);
      return {
        term,
        url,
        title: row.title,
        enabled: body.enabled ?? true,
        visible,
      };
    });

  const existing = await db
    .select({ term: schema.anchorLinks.term, url: schema.anchorLinks.url })
    .from(schema.anchorLinks)
    .where(eq(schema.anchorLinks.enabled, true));
  const existingSameTermUrls = new Set(
    existing
      .filter((row) => normalizeAnchorTerm(row.term).toLowerCase() === term.toLowerCase())
      .map((row) => row.url.toLowerCase()),
  );
  const created: typeof schema.anchorLinks.$inferSelect[] = [];
  let skipped = 0;

  for (const target of targets) {
    const targetUrl = target.url.toLowerCase();
    if (!target.visible) {
      skipped++;
      details.push(`skip ${target.url}: phrase is title-only or not visible in post/reply content`);
      continue;
    }
    if (existingSameTermUrls.has(targetUrl)) {
      skipped++;
      details.push(`skip ${target.url}: duplicate target for "${term}"`);
      continue;
    }
    const overlap = existing.find((row) => {
      if (row.url.toLowerCase() !== targetUrl) return false;
      const existingTerm = normalizeAnchorTerm(row.term);
      if (existingTerm.toLowerCase() === term.toLowerCase()) return false;
      return anchorTermsOverlap(existingTerm, term);
    });
    if (overlap) {
      skipped++;
      details.push(`skip ${target.url}: overlaps existing "${overlap.term}" on the same target`);
      continue;
    }
    const [row] = await db
      .insert(schema.anchorLinks)
      .values({
        ...target,
        createdByUserId: me?.id ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    if (row) {
      created.push(row);
      existing.push({ term, url: target.url });
      existingSameTermUrls.add(targetUrl);
    }
  }

  await db.insert(schema.activityLog).values({
    userId: me?.id ?? null,
    type: "anchor",
    summary: `Auto-created ${created.length} anchors for "${term}" (${skipped} skipped, ${targets.length} found)${
      details.length ? `; ${details.slice(0, 3).join("; ")}` : ""
    }`,
  });

  return c.json({
    anchors: created.map(toAdminAnchor),
    created: created.length,
    skipped,
    found: targets.length,
    details: details.slice(0, 20),
  });
});

app.post("/anchors", zValidator("json", anchorBody), async (c) => {
  const schemaReady = await ensureAnchorLinksSchema(c.env.DB);
  if (!schemaReady) return c.json({ error: "anchor_schema_unavailable" }, 503);
  const db = c.get("db");
  const me = c.get("user");
  const body = c.req.valid("json");
  const [row] = await db
    .insert(schema.anchorLinks)
    .values({
      term: body.term,
      url: body.url,
      title: body.title || body.term,
      enabled: body.enabled ?? true,
      createdByUserId: me?.id ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  await db.insert(schema.activityLog).values({
    userId: me?.id ?? null,
    type: "anchor",
    summary: `Created anchor "${body.term}" -> ${body.url}`,
  });
  return c.json({ anchor: toAdminAnchor(row) }, 201);
});

app.patch("/anchors/:id", zValidator("json", anchorBody.partial()), async (c) => {
  const schemaReady = await ensureAnchorLinksSchema(c.env.DB);
  if (!schemaReady) return c.json({ error: "anchor_schema_unavailable" }, 503);
  const db = c.get("db");
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: "Invalid anchor" }, 400);
  const body = c.req.valid("json");
  const patch: Partial<typeof schema.anchorLinks.$inferInsert> = { updatedAt: new Date() };
  if (body.term !== undefined) patch.term = body.term;
  if (body.url !== undefined) patch.url = body.url;
  if (body.title !== undefined) patch.title = body.title || body.term || "";
  if (body.enabled !== undefined) patch.enabled = body.enabled;
  const [row] = await db
    .update(schema.anchorLinks)
    .set(patch)
    .where(eq(schema.anchorLinks.id, id))
    .returning();
  if (!row) return c.json({ error: "Anchor not found" }, 404);
  return c.json({ anchor: toAdminAnchor(row) });
});

app.delete("/anchors/:id", async (c) => {
  const schemaReady = await ensureAnchorLinksSchema(c.env.DB);
  if (!schemaReady) return c.json({ error: "anchor_schema_unavailable" }, 503);
  const db = c.get("db");
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: "Invalid anchor" }, 400);
  await db.delete(schema.anchorLinks).where(eq(schema.anchorLinks.id, id));
  return c.json({ ok: true });
});

app.post("/marketing/send", zValidator("json", z.object({
  campaignKey: z.literal(WE_ARE_BACK_CAMPAIGN).default(WE_ARE_BACK_CAMPAIGN),
  userId: z.number().int().optional(),
  userIds: z.array(z.number().int()).max(MARKETING_BULK_RECIPIENT_LIMIT).optional(),
  test: z.boolean().optional(),
})), async (c) => {
  const db = c.get("db");
  const admin = c.get("user")!;
  const body = c.req.valid("json");
  const emailSettings = await loadEmailSettings(db, c.req.url);
  const blockDuplicateSends = !body.test && await marketingDuplicateBlockingEnabled(db);
  const sendOne = async (user: typeof schema.users.$inferSelect, mode: "test" | "single" | "bulk") => {
    const previous = await db.query.marketingSends.findFirst({
      where: and(eq(schema.marketingSends.campaignKey, body.campaignKey), eq(schema.marketingSends.userId, user.id)),
      orderBy: desc(schema.marketingSends.createdAt),
    });
    if (mode !== "test" && blockDuplicateSends && previous) {
      if (mode === "single") {
        await db.insert(schema.activityLog).values({
          userId: admin.id,
          type: "marketing",
          summary: `Skipped duplicate ${body.campaignKey} to ${user.username}`,
          createdAt: new Date(),
        });
      }
      return {
        userId: user.id,
        username: user.username,
        email: user.email,
        status: "duplicate",
        previousSentAt: previous.createdAt ? safeISO(previous.createdAt) : null,
      };
    }
    const { siteUrl, from, provider, sesRegion, sesTransport, sesPort } = emailSettings;
    if (mode !== "test") {
      const risky = await c.env.DB.prepare(
        `SELECT status, error_code AS errorCode, created_at AS createdAt
         FROM email_events
         WHERE kind = 'email_verify'
           AND LOWER(email) = LOWER(?)
           AND status IN ('preflight_risky', 'error', 'suppressed')
         ORDER BY created_at DESC
         LIMIT 1`,
      ).bind(user.email).first<{ status: string; errorCode: string | null; createdAt: number | null }>();
      if (risky) {
        const mail = weAreBackEmail({ recipientName: user.displayName, siteUrl });
        const [event] = await db.insert(schema.emailEvents).values({
          userId: user.id,
          email: user.email.trim().toLowerCase(),
          kind: "marketing",
          subject: mail.subject,
          status: "skipped",
          relatedType: "marketing",
          campaignKey: body.campaignKey,
          message: `Marketing skipped because Email Verify marked this recipient risky${risky.errorCode ? `: ${risky.errorCode}` : ""}`,
          errorCode: "email_verify_risk",
          createdAt: new Date(),
        }).returning({ id: schema.emailEvents.id });
        await db.insert(schema.marketingSends).values({
          campaignKey: body.campaignKey,
          userId: user.id,
          email: user.email,
          status: "skipped",
          emailEventId: event?.id ?? null,
          sentByUserId: admin.id,
          createdAt: new Date(),
        });
        await db.insert(schema.activityLog).values({
          userId: admin.id,
          type: "marketing",
          summary: `Skipped ${body.campaignKey} to ${user.username} (email verify risk)`,
          createdAt: new Date(),
        });
        return {
          userId: user.id,
          username: user.username,
          email: user.email,
          status: "skipped",
          error: "email_verify_risk",
          previousSentAt: previous?.createdAt ? safeISO(previous.createdAt) : null,
        };
      }
    }
    const mail = weAreBackEmail({ recipientName: user.displayName, siteUrl });
    const result = await sendManagedEmail({
      db,
      env: c.env,
      user,
      kind: "marketing",
      ...mail,
      siteUrl,
      from,
      provider,
      sesRegion,
      sesTransport,
      sesPort,
      campaignKey: body.campaignKey,
      ignorePreferences: mode === "test",
      waitUntil: c.executionCtx.waitUntil.bind(c.executionCtx),
    });

    await db.insert(schema.marketingSends).values({
      campaignKey: body.campaignKey,
      userId: user.id,
      email: user.email,
      status: result.status,
      emailEventId: result.eventId,
      sentByUserId: admin.id,
      createdAt: new Date(),
    });
    await db.insert(schema.activityLog).values({
      userId: admin.id,
      type: "marketing",
      summary: `${mode === "test" ? "Tested" : "Sent"} ${body.campaignKey} to ${user.username} (${result.status})`,
    });
    return {
      userId: user.id,
      username: user.username,
      email: user.email,
      status: result.status,
      previousSentAt: previous?.createdAt ? safeISO(previous.createdAt) : null,
    };
  };

  if (!body.test && body.userIds?.length) {
    const ids = [...new Set(body.userIds)].slice(0, MARKETING_BULK_RECIPIENT_LIMIT);
    if (!ids.length) return c.json({ error: "Select users" }, 400);
    await ensureMarketingJobsSchema(c.env.DB);
    const newJobId = jobId();
    const now = nowSeconds();
    await c.env.DB.prepare(
      `INSERT INTO marketing_jobs (
        id, campaign_key, user_ids_json, status, total, processed, sent, duplicate, skipped, suppressed, failed,
        created_by_user_id, request_url, created_at, updated_at
      ) VALUES (?, ?, ?, 'queued', ?, 0, 0, 0, 0, 0, 0, ?, ?, ?, ?)`,
    ).bind(newJobId, body.campaignKey, JSON.stringify(ids), ids.length, admin.id, c.req.url, now, now).run();
    await db.insert(schema.activityLog).values({
      userId: admin.id,
      type: "marketing",
      summary: `Queued marketing job ${newJobId} for ${ids.length} users (${body.campaignKey})`,
    });
    if (c.env.MARKETING_QUEUE) {
      c.executionCtx.waitUntil(
        c.env.MARKETING_QUEUE.send({ jobId: newJobId }).catch((error) => {
          console.warn("marketing_queue_send_failed", newJobId, error instanceof Error ? error.message : String(error));
          return processMarketingJobs(c.env, c.executionCtx, { jobId: newJobId });
        }),
      );
    } else {
      c.executionCtx.waitUntil(processMarketingJobs(c.env, c.executionCtx, { jobId: newJobId }));
    }
    return c.json({
      ok: true,
      status: "queued",
      jobId: newJobId,
      total: ids.length,
      sent: 0,
      duplicate: 0,
      skipped: 0,
      suppressed: 0,
      error: 0,
      results: [],
    }, 202);
  }

  const targetId = body.test ? admin.id : body.userId;
  if (!targetId) return c.json({ error: "Select a user" }, 400);

  const user = await db.query.users.findFirst({ where: eq(schema.users.id, targetId) });
  if (!user) return c.json({ error: "User not found" }, 404);

  const result = await sendOne(user, body.test ? "test" : "single");

  return c.json({
    ok: result.status === "sent",
    status: result.status,
    previousSentAt: result.previousSentAt,
  });
});

app.get("/settings", async (c) => {
  const db = c.get("db");
  const rows = await db.select().from(schema.settings);
  const result: Record<string, string> = {};
  for (const r of rows) result[r.key] = r.value;
  const emailSettings = await loadEmailSettings(db, c.req.url);
  result.email_provider = result.email_provider || emailSettings.provider;
  result.email_from = result.email_from || emailSettings.cloudflareFrom;
  result.email_ses_from = result.email_ses_from || emailSettings.sesFrom;
  result.email_ses_region = result.email_ses_region || emailSettings.sesRegion;
  result.email_ses_transport = result.email_ses_transport || emailSettings.sesTransport;
  result.email_ses_port = result.email_ses_port || String(emailSettings.sesPort);
  result.email_test_to = result.email_test_to || emailSettings.testTo;
  result._email_cf_configured = c.env.SEND_EMAIL ? "true" : "false";
  result._email_ses_configured = isAwsSesConfigured(c.env, emailSettings.sesTransport) ? "true" : "false";
  result._email_ses_smtp_configured = isAwsSesConfigured(c.env, "smtp") ? "true" : "false";
  result._email_ses_api_configured = isAwsSesConfigured(c.env, "api") ? "true" : "false";
  return c.json(result);
});

app.post("/settings", zValidator("json", z.record(z.string())), async (c) => {
  const db = c.get("db");
  const body = c.req.valid("json");
  for (const [key, value] of Object.entries(body)) {
    await db
      .insert(schema.settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value } });
  }
  return c.json({ ok: true });
});

app.post("/settings/email-test", zValidator("json", z.object({
  to: z.string().trim().email().optional(),
})), async (c) => {
  const db = c.get("db");
  const admin = c.get("user")!;
  const body = c.req.valid("json");
  const settings = await loadEmailSettings(db, c.req.url);
  const to = (body.to || settings.testTo || DEFAULT_EMAIL_TEST_TO).trim().toLowerCase();
  if (await isEmailSuppressed(db, to)) {
    return c.json({ ok: false, status: "suppressed", error: "Recipient is locally suppressed", to }, 409);
  }

  const subject = `FSTDESK test email via ${settings.provider.toUpperCase()}${settings.provider === "ses" ? ` ${settings.sesTransport.toUpperCase()}` : ""}`;
  const text = [
    "FSTDESK email provider test",
    "",
    `Provider: ${settings.provider}`,
    ...(settings.provider === "ses" ? [`Transport: ${settings.sesTransport}`, `Port: ${settings.sesPort}`] : []),
    `From: ${settings.from}`,
    `To: ${to}`,
    `Site: ${settings.siteUrl}`,
    "",
    "If you received this, the selected provider can send mail.",
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#282828;color:#ebdbb2;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace">
<div style="max-width:640px;margin:0 auto;padding:28px 20px">
  <div style="color:#fabd2f;font-weight:700;font-size:15px;margin-bottom:20px">FSTDESK</div>
  <div style="border:1px solid #504945;background:#3c3836;padding:22px">
    <h1 style="font-size:21px;color:#fabd2f;margin:0 0 16px">Email provider test</h1>
    <p>Provider: <strong>${settings.provider}</strong></p>
    ${settings.provider === "ses" ? `<p>Transport: <strong>${settings.sesTransport}:${settings.sesPort}</strong></p>` : ""}
    <p>From: <strong>${settings.from}</strong></p>
    <p>To: <strong>${to}</strong></p>
    <p>If you received this, the selected provider can send mail.</p>
  </div>
</div>
</body></html>`;
  const [event] = await db.insert(schema.emailEvents).values({
    userId: null,
    email: to,
    kind: "email_test",
    subject,
    status: "pending",
    message: `Testing ${settings.provider} provider`,
    createdAt: new Date(),
  }).returning({ id: schema.emailEvents.id });

  const sent = await sendEmail(c.env, {
    to,
    from: settings.from,
    provider: settings.provider,
    sesRegion: settings.sesRegion,
    sesTransport: settings.sesTransport,
    sesPort: settings.sesPort,
    subject,
    text,
    html,
    headers: { "X-FSTDESK-Mail-Type": "email_test" },
  });

  const status = sent.ok ? "sent" : sent.suppressed ? "suppressed" : "error";
  await db.update(schema.emailEvents)
    .set({
      status,
      message: sent.ok ? `Sent via ${settings.provider}` : sent.message?.slice(0, 1000) ?? null,
      errorCode: sent.code ?? null,
    })
    .where(eq(schema.emailEvents.id, event.id));

  if (sent.suppressed) {
    await recordEmailSuppression(db, c.env, to, {
      reason: "recipient_suppressed",
      source: "admin_email_test",
      details: sent.code,
      waitUntil: c.executionCtx.waitUntil.bind(c.executionCtx),
    });
  }

  await db.insert(schema.activityLog).values({
    userId: admin.id,
    type: "settings",
    summary: sent.ok
      ? `Sent ${settings.provider} test email to ${to}`
      : `Failed ${settings.provider} test email to ${to}: ${sent.code ?? "email_error"}`,
    createdAt: new Date(),
  });

  return c.json({
    ok: sent.ok,
    status,
    error: sent.ok ? null : sent.message ?? sent.code ?? "Email test failed",
    provider: settings.provider,
    from: settings.from,
    to,
    code: sent.code ?? null,
    message: sent.message ?? null,
    eventId: event.id,
  }, sent.ok ? 200 : 502);
});

export default app;
