import { schema, type DB } from "../db";
import type { Bindings } from "../types";
import { listCloudflareDeliveryFailures, listCloudflareSuppressions, cloudflareEmailApiConfigured } from "./email";
import { recordEmailSuppression } from "./email-suppression";
import { loadEmailSettings } from "./notifications";

export type EmailSuppressionSyncResult = {
  ok: boolean;
  configured: boolean;
  hours: number;
  cfSuppressions: number;
  deliveryFailures: number;
  localUpdates: number;
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

export async function syncCloudflareEmailSuppressions(
  db: DB,
  env: Bindings,
  opts: {
    requestUrl: string;
    hours?: number;
    userId?: number | null;
    logMissingConfig?: boolean;
  },
): Promise<EmailSuppressionSyncResult> {
  const hours = Math.max(1, Math.min(720, Math.round(opts.hours ?? 72)));
  const configured = cloudflareEmailApiConfigured(env);
  const errors: string[] = [];
  let cfSuppressions = 0;
  let deliveryFailures = 0;
  let localUpdates = 0;
  const seen = new Set<string>();

  if (!configured) {
    errors.push("CF_ACCOUNT_ID / CF_EMAIL_API_TOKEN missing in Worker secrets");
  } else {
    try {
      const suppressions = await listCloudflareSuppressions(env);
      for (const row of suppressions) {
        const email = String(row.email ?? "").trim().toLowerCase();
        if (!email || seen.has(email)) continue;
        seen.add(email);
        cfSuppressions += 1;
        await recordEmailSuppression(db, env, email, {
          reason: row.reason || "cloudflare_suppression",
          source: "cf_suppression_sync",
          details: JSON.stringify(row).slice(0, 2000),
          skipCloudflareSync: true,
        });
        localUpdates += 1;
      }
    } catch (error) {
      errors.push(`suppression list: ${error instanceof Error ? error.message : "sync failed"}`);
    }

    try {
      const { from } = await loadEmailSettings(db, opts.requestUrl);
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
        await recordEmailSuppression(db, env, email, {
          reason: String(row.status ?? "").toLowerCase().includes("reject") ? "delivery_rejected" : "delivery_failed",
          source: "cf_activity_sync",
          details: detail,
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
        localUpdates += 1;
      }
    } catch (error) {
      errors.push(`delivery failures: ${error instanceof Error ? error.message : "sync failed"}`);
    }
  }

  if (configured || opts.logMissingConfig !== false) {
    await db.insert(schema.activityLog).values({
      userId: opts.userId ?? null,
      type: "email_bounce",
      summary: [
        `Synced CF bounces: ${localUpdates} local updates`,
        `${deliveryFailures} failures`,
        `${cfSuppressions} suppressions`,
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
    errors,
  };
}
