import { schema, type DB } from "../db";
import type { Bindings } from "../types";
import { addCloudflareSuppression, listCloudflareDeliveryFailures, listCloudflareSuppressions, cloudflareEmailApiConfigured } from "./email";
import { recordEmailSuppression } from "./email-suppression";
import { loadEmailSettings } from "./notifications";

export type EmailSuppressionSyncResult = {
  ok: boolean;
  configured: boolean;
  hours: number;
  cfSuppressions: number;
  deliveryFailures: number;
  localUpdates: number;
  cfWriteAttempts: number;
  cfWriteSynced: number;
  cfWriteErrors: number;
  errors: string[];
};

function failureDetail(row: Awaited<ReturnType<typeof listCloudflareDeliveryFailures>>[number]): string {
  return [
    row.datetime,
    row.status,
    row.eventType,
    row.errorCause,
    row.errorDetail,
    row.subject ? `subject=${row.subject}` : "",
    row.messageId ? `messageId=${row.messageId}` : "",
  ].filter(Boolean).join(" | ").slice(0, 2000);
}

async function importCloudflareSuppressionList(
  db: DB,
  env: Bindings,
): Promise<{ seen: Set<string>; cfSuppressions: number; localUpdates: number }> {
  const seen = new Set<string>();
  let cfSuppressions = 0;
  let localUpdates = 0;
  const suppressions = await listCloudflareSuppressions(env);
  for (const row of suppressions) {
    const email = String(row.email ?? "").trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    cfSuppressions += 1;

    const existing = await env.DB.prepare(
      `SELECT email, COALESCE(cf_suppression_status, '') AS cfSuppressionStatus
       FROM email_suppressions
       WHERE LOWER(email) = ?
       LIMIT 1`,
    ).bind(email).first<{ email: string; cfSuppressionStatus: string | null }>();

    if (existing) {
      if (existing.cfSuppressionStatus !== "synced") {
        await env.DB.prepare(
          `UPDATE email_suppressions
           SET cf_suppression_status = 'synced',
               cf_suppressed_at = COALESCE(cf_suppressed_at, ?),
               cf_suppression_error = NULL
           WHERE LOWER(email) = ?`,
        ).bind(Math.floor(Date.now() / 1000), email).run();
        localUpdates += 1;
      }
      continue;
    }

    const recorded = await recordEmailSuppression(db, env, email, {
      reason: row.reason || "cloudflare_suppression",
      source: "cf_suppression_sync",
      details: JSON.stringify(row).slice(0, 2000),
      skipCloudflareSync: true,
    });
    if (recorded.created || recorded.updated) localUpdates += 1;
  }
  return { seen, cfSuppressions, localUpdates };
}

async function retryCloudflareSuppressionWrites(
  env: Bindings,
  opts: { includeAuthErrors?: boolean; limit?: number } = {},
): Promise<{ attempted: number; synced: number; errors: number }> {
  if (!cloudflareEmailApiConfigured(env)) return { attempted: 0, synced: 0, errors: 0 };
  const limit = Math.max(1, Math.min(1000, opts.limit ?? 250));
  const rows = opts.includeAuthErrors
    ? await env.DB.prepare(
      `SELECT email
       FROM email_suppressions
       WHERE COALESCE(cf_suppression_status, '') IN ('pending', 'skipped', 'error', 'auth_error', '')
       ORDER BY updated_at DESC
       LIMIT ?`,
    ).bind(limit).all<{ email: string }>()
    : await env.DB.prepare(
      `SELECT email
       FROM email_suppressions
       WHERE COALESCE(cf_suppression_status, '') IN ('pending', 'skipped', 'error', '')
          OR (cf_suppression_status = 'auth_error' AND updated_at <= ?)
       ORDER BY updated_at DESC
       LIMIT ?`,
    ).bind(Math.floor(Date.now() / 1000) - 300, limit).all<{ email: string }>();

  let attempted = 0;
  let synced = 0;
  let errors = 0;
  for (const row of rows.results ?? []) {
    const email = String(row.email ?? "").trim().toLowerCase();
    if (!email) continue;
    attempted += 1;
    const result = await addCloudflareSuppression(env, email);
    const now = Math.floor(Date.now() / 1000);
    const status = result.ok ? "synced" : result.skipped ? "skipped" : result.code === "auth_error" ? "auth_error" : "error";
    if (result.ok) synced += 1;
    else errors += 1;
    await env.DB.prepare(
      `UPDATE email_suppressions
       SET cf_suppression_status = ?,
           cf_suppressed_at = CASE WHEN ? = 'synced' THEN ? ELSE cf_suppressed_at END,
           cf_suppression_error = ?,
           updated_at = ?
       WHERE LOWER(email) = ?`,
    ).bind(
      status,
      status,
      now,
      result.error?.slice(0, 1000) ?? null,
      now,
      email,
    ).run();
  }
  return { attempted, synced, errors };
}

export async function syncCloudflareEmailSuppressions(
  db: DB,
  env: Bindings,
  opts: {
    requestUrl: string;
    hours?: number;
    userId?: number | null;
    logMissingConfig?: boolean;
    forceCloudflareSync?: boolean;
  },
): Promise<EmailSuppressionSyncResult> {
  const hours = Math.max(1, Math.min(720, Math.round(opts.hours ?? 72)));
  const configured = cloudflareEmailApiConfigured(env);
  const errors: string[] = [];
  let cfSuppressions = 0;
  let deliveryFailures = 0;
  let localUpdates = 0;
  let cfWriteAttempts = 0;
  let cfWriteSynced = 0;
  let cfWriteErrors = 0;
  const seen = new Set<string>();

  if (!configured) {
    errors.push("CF_ACCOUNT_ID / CF_EMAIL_API_TOKEN missing in Worker secrets");
  } else {
    try {
      const imported = await importCloudflareSuppressionList(db, env);
      for (const email of imported.seen) seen.add(email);
      cfSuppressions = imported.cfSuppressions;
      localUpdates += imported.localUpdates;
    } catch (error) {
      errors.push(`suppression list: ${error instanceof Error ? error.message : "sync failed"}`);
    }

    try {
      const { cloudflareFrom: from } = await loadEmailSettings(db, opts.requestUrl);
      const sendingDomain = from.replace(/^.*@/, "").toLowerCase();
      const failures = await listCloudflareDeliveryFailures(env, { sendingDomain, hours });
      deliveryFailures = failures.length;
      const since = Math.floor(Date.now() / 1000) - hours * 3600;

      for (const row of failures) {
        const email = String(row.to ?? "").trim().toLowerCase();
        if (!email || seen.has(email)) continue;
        seen.add(email);
        const detail = failureDetail(row);
        const code = row.errorCause || row.status || row.eventType || "delivery_failed";
        const recorded = await recordEmailSuppression(db, env, email, {
          reason: String(row.status ?? "").toLowerCase().includes("reject") ? "delivery_rejected" : "delivery_failed",
          source: "cf_activity_sync",
          details: detail,
          forceCloudflareSync: opts.forceCloudflareSync,
        });
        await env.DB.prepare(
          `UPDATE email_events
           SET status = 'suppressed', message = ?, error_code = ?
           WHERE LOWER(email) = ? AND created_at >= ?`,
        ).bind(detail || "Cloudflare delivery failed", code, email, since).run();
        await env.DB.prepare(
          `UPDATE marketing_sends
           SET status = 'suppressed'
           WHERE LOWER(email) = ? AND created_at >= ?`,
        ).bind(email, since).run();
        if (recorded.created || recorded.updated) localUpdates += 1;
      }
    } catch (error) {
      errors.push(`delivery failures: ${error instanceof Error ? error.message : "sync failed"}`);
    }

    try {
      const retry = await retryCloudflareSuppressionWrites(env, {
        includeAuthErrors: opts.forceCloudflareSync,
      });
      cfWriteAttempts = retry.attempted;
      cfWriteSynced = retry.synced;
      cfWriteErrors = retry.errors;
    } catch (error) {
      errors.push(`suppression write retry: ${error instanceof Error ? error.message : "retry failed"}`);
    }
  }

  const shouldLog = errors.length > 0 || localUpdates > 0 || cfWriteAttempts > 0 || cfWriteSynced > 0 || cfWriteErrors > 0;
  if ((configured || opts.logMissingConfig !== false) && shouldLog) {
    await db.insert(schema.activityLog).values({
      userId: opts.userId ?? null,
      type: "email_bounce",
      summary: [
        `Synced CF bounces: ${localUpdates} local updates`,
        `${deliveryFailures} failures`,
        `${cfSuppressions} suppressions`,
        `${cfWriteSynced}/${cfWriteAttempts} CF writes synced`,
        configured ? "configured" : "not configured",
        errors.length ? `errors=${errors.join(" | ").slice(0, 500)}` : "",
      ].filter(Boolean).join(", "),
      createdAt: new Date(),
    });
  }

  return {
    ok: configured && errors.length === 0,
    configured,
    hours,
    cfSuppressions,
    deliveryFailures,
    localUpdates,
    cfWriteAttempts,
    cfWriteSynced,
    cfWriteErrors,
    errors,
  };
}
