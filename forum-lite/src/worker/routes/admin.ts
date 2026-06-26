import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, eq, desc, sql } from "drizzle-orm";
import { schema } from "../db";
import { requireRole } from "../lib/middleware";
import { safeISO } from "../lib/auth";
import { toPublicUser, type AppEnv } from "../types";
import { loadEmailSettings, sendManagedEmail, weAreBackEmail } from "../lib/notifications";
import { cloudflareEmailApiConfigured, listCloudflareDeliveryFailures, type CloudflareEmailFailure } from "../lib/email";
import { classifyCloudflareEmailFailure, failureDetail, type EmailFailureClassification } from "../lib/email-classification";
import { classificationForPreflight, preflightEmail, type EmailPreflightResult } from "../lib/email-preflight";
import { isEmailSuppressed, recordEmailSuppression } from "../lib/email-suppression";
import { syncCloudflareEmailSuppressions } from "../lib/email-sync";

const app = new Hono<AppEnv>();
const WE_ARE_BACK_CAMPAIGN = "we-are-back";
const MARKETING_BLOCK_DUPLICATE_SENDS_KEY = "marketing_block_duplicate_sends";

app.use("/*", requireRole("admin"));

function toAdminUser(u: typeof schema.users.$inferSelect) {
  return {
    ...toPublicUser(u),
    email: u.email,
    emailVerifiedAt: u.emailVerifiedAt ? safeISO(u.emailVerifiedAt) : null,
    lastLoginAt: u.lastLoginAt ? safeISO(u.lastLoginAt) : null,
    emailSuppressedAt: u.emailSuppressedAt ? safeISO(u.emailSuppressedAt) : null,
    emailSuppressionReason: u.emailSuppressionReason ?? null,
  };
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

function msFromCfDate(value: string | undefined): number {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
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
  const search = emailVerifyCandidateSearchSql(q);
  const rows = await c.env.DB.prepare(
    `SELECT u.id, u.username, u.display_name AS displayName, u.email
     FROM users u
     LEFT JOIN email_suppressions es ON LOWER(es.email) = LOWER(u.email)
     WHERE u.banned = 0
       AND u.email IS NOT NULL
       AND TRIM(u.email) != ''
       AND u.email_suppressed_at IS NULL
       AND es.email IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM email_events ee
         WHERE LOWER(ee.email) = LOWER(u.email)
       )
       ${search.clause}
     ORDER BY u.created_at ASC
     LIMIT ?`,
  ).bind(...search.bindings, limit).all<{
    id: number;
    username: string;
    displayName: string;
    email: string;
  }>();
  return rows.results ?? [];
}

async function emailVerifyCandidatesByEmails(c: any, emails: string[]) {
  const normalized = [...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean))].slice(0, 100);
  if (!normalized.length) return [];
  const placeholders = normalized.map(() => "?").join(",");
  const rows = await c.env.DB.prepare(
    `SELECT u.id, u.username, u.display_name AS displayName, u.email
     FROM users u
     LEFT JOIN email_suppressions es ON LOWER(es.email) = LOWER(u.email)
     WHERE u.banned = 0
       AND u.email IS NOT NULL
       AND TRIM(u.email) != ''
       AND u.email_suppressed_at IS NULL
       AND es.email IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM email_events ee
         WHERE LOWER(ee.email) = LOWER(u.email)
       )
       AND LOWER(u.email) IN (${placeholders})
     ORDER BY u.created_at ASC`,
  ).bind(...normalized).all<{
    id: number;
    username: string;
    displayName: string;
    email: string;
  }>();
  return rows.results ?? [];
}

async function emailVerifyCandidateCount(c: any, q = ""): Promise<number> {
  const search = emailVerifyCandidateSearchSql(q);
  const row = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM users u
     LEFT JOIN email_suppressions es ON LOWER(es.email) = LOWER(u.email)
     WHERE u.banned = 0
       AND u.email IS NOT NULL
       AND TRIM(u.email) != ''
       AND u.email_suppressed_at IS NULL
       AND es.email IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM email_events ee
         WHERE LOWER(ee.email) = LOWER(u.email)
       )
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
  const db = c.get("db");
  const page = Math.max(1, Number(c.req.query("page") ?? 1));
  const perPage = 25;
  const rows = await db
    .select()
    .from(schema.users)
    .orderBy(desc(schema.users.createdAt))
    .limit(perPage)
    .offset((page - 1) * perPage);
  const total = await db.$count(schema.users);
  return c.json({ users: rows.map(toAdminUser), total, page, perPage });
});

app.get("/email-suppressions", async (c) => {
  const db = c.get("db");
  const page = Math.max(1, Number(c.req.query("page") ?? 1));
  const perPage = 50;
  const rows = await db
    .select()
    .from(schema.emailSuppressions)
    .orderBy(desc(schema.emailSuppressions.updatedAt))
    .limit(perPage)
    .offset((page - 1) * perPage);
  const total = await db.$count(schema.emailSuppressions);
  return c.json({
    suppressions: rows.map((row) => ({
      ...row,
      createdAt: safeISO(row.createdAt),
      updatedAt: safeISO(row.updatedAt),
      cfSuppressedAt: row.cfSuppressedAt ? safeISO(row.cfSuppressedAt) : null,
    })),
    syncConfigured: cloudflareEmailApiConfigured(c.env),
    total,
    page,
    perPage,
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
  const db = c.get("db");
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

  if (configured) {
    try {
      const { from } = await loadEmailSettings(db, c.req.url);
      const sendingDomain = from.replace(/^.*@/, "").toLowerCase();
      const failures = await listCloudflareDeliveryFailures(c.env, { sendingDomain, hours });
      for (const row of failures) {
        const email = String(row.to ?? "").trim().toLowerCase();
        if (!email) continue;
        const classification = classifyCloudflareEmailFailure(row);
        const seenMs = msFromCfDate(row.datetime);
        const existing = groups.get(email);
        if (!existing) {
          groups.set(email, {
            email,
            classification,
            attempts: 1,
            firstSeenMs: seenMs,
            lastSeenMs: seenMs,
            statuses: new Set([row.status, row.eventType, row.errorCause].filter(Boolean).map(String)),
            subjects: new Set(row.subject ? [row.subject] : []),
            latest: row,
            details: failureDetail(row),
          });
          continue;
        }
        existing.attempts += 1;
        existing.firstSeenMs = existing.firstSeenMs ? Math.min(existing.firstSeenMs, seenMs || existing.firstSeenMs) : seenMs;
        existing.lastSeenMs = Math.max(existing.lastSeenMs, seenMs);
        if (row.status) existing.statuses.add(row.status);
        if (row.eventType) existing.statuses.add(row.eventType);
        if (row.errorCause) existing.statuses.add(row.errorCause);
        if (row.subject) existing.subjects.add(row.subject);
        if (seenMs >= existing.lastSeenMs) {
          existing.latest = row;
          existing.details = failureDetail(row);
        }
        const currentRank = riskRank(existing.classification.risk);
        const nextRank = riskRank(classification.risk);
        if (nextRank > currentRank || (nextRank === currentRank && classification.score > existing.classification.score)) {
          existing.classification = classification;
        }
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Cloudflare delivery failure scan failed");
    }
  } else {
    errors.push("CF_ACCOUNT_ID / CF_EMAIL_API_TOKEN missing in Worker secrets");
  }

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

app.patch("/users/:id/ban", requireRole("admin"), async (c) => {
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

app.get("/logs", async (c) => {
  const db = c.get("db");
  const page = Math.max(1, Number(c.req.query("page") ?? 1));
  const type = c.req.query("type") ?? "";
  const where = type ? eq(schema.activityLog.type, type) : undefined;
  const perPage = 30;
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
        COUNT(DISTINCT visitor_id) AS visitors,
        SUM(CASE WHEN user_id IS NOT NULL THEN 1 ELSE 0 END) AS userViews,
        SUM(CASE WHEN user_id IS NULL THEN 1 ELSE 0 END) AS anonymousViews,
        SUM(CASE WHEN is_repeat = 1 THEN 1 ELSE 0 END) AS repeatViews,
        SUM(CASE WHEN is_bot = 1 THEN 1 ELSE 0 END) AS botViews,
        AVG(NULLIF(duration_ms, 0)) AS avgDurationMs,
        MAX(created_at) AS lastSeenAt
       FROM analytics_pageviews
       WHERE created_at >= ?`,
    ).first<Record<string, unknown>>(),
    c.env.DB.prepare(
      `SELECT
        COUNT(DISTINCT visitor_id) AS onlineVisitors,
        COUNT(DISTINCT CASE WHEN user_id IS NOT NULL THEN visitor_id END) AS onlineSignedIn,
        COUNT(DISTINCT CASE WHEN user_id IS NULL THEN visitor_id END) AS onlineAnonymous,
        COUNT(DISTINCT CASE WHEN is_repeat = 1 THEN visitor_id END) AS onlineRepeat,
        COUNT(DISTINCT CASE WHEN is_bot = 1 THEN visitor_id END) AS onlineBots,
        MAX(last_seen_at) AS lastSeenAt
       FROM analytics_pageviews
       WHERE last_seen_at >= ?`,
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
      `SELECT COALESCE(NULLIF(referrer_host, ''), 'direct') AS referrerHost, COUNT(*) AS views, COUNT(DISTINCT visitor_id) AS visitors
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
      )
      SELECT ap.id, ap.path, ap.route_type AS routeType, ap.source, ap.medium, ap.country, ap.city, ap.colo,
        ap.device_type AS deviceType, ap.browser, ap.os, ap.is_repeat AS isRepeat, ap.is_bot AS isBot,
        ap.duration_ms AS durationMs, ap.created_at AS createdAt, ap.last_seen_at AS lastSeenAt,
        u.username, u.display_name AS displayName
       FROM latest
       INNER JOIN analytics_pageviews ap ON ap.id = latest.id
       LEFT JOIN users u ON u.id = ap.user_id
       ORDER BY ap.last_seen_at DESC
       LIMIT 80`,
    ).bind(onlineSince).all<Record<string, unknown>>(),
    bindSince(
      `SELECT ap.id, ap.path, ap.route_type AS routeType, ap.source, ap.medium, ap.country, ap.city, ap.colo,
        ap.device_type AS deviceType, ap.browser, ap.os, ap.is_repeat AS isRepeat, ap.is_bot AS isBot,
        ap.duration_ms AS durationMs, ap.created_at AS createdAt, ap.last_seen_at AS lastSeenAt,
        u.username, u.display_name AS displayName
       FROM analytics_pageviews ap
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

app.post("/marketing/send", zValidator("json", z.object({
  campaignKey: z.literal(WE_ARE_BACK_CAMPAIGN).default(WE_ARE_BACK_CAMPAIGN),
  userId: z.number().int().optional(),
  userIds: z.array(z.number().int()).max(20).optional(),
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
    const { siteUrl, from } = emailSettings;
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
    const ids = [...new Set(body.userIds)].slice(0, 20);
    if (!ids.length) return c.json({ error: "Select users" }, 400);
    const results = [];
    for (const id of ids) {
      const user = await db.query.users.findFirst({ where: eq(schema.users.id, id) });
      if (!user) {
        results.push({ userId: id, status: "skipped", error: "User not found" });
        continue;
      }
      results.push(await sendOne(user, "bulk"));
    }
    const counts = results.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = (acc[row.status] ?? 0) + 1;
      return acc;
    }, {});
    await db.insert(schema.activityLog).values({
      userId: admin.id,
      type: "marketing",
      summary: `Bulk sent ${body.campaignKey} to ${ids.length} users (${counts.sent ?? 0} sent, ${counts.duplicate ?? 0} duplicate blocked)`,
    });
    return c.json({
      ok: true,
      status: "bulk",
      total: results.length,
      sent: counts.sent ?? 0,
      duplicate: counts.duplicate ?? 0,
      skipped: counts.skipped ?? 0,
      suppressed: counts.suppressed ?? 0,
      error: counts.error ?? 0,
      results,
    });
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

export default app;
