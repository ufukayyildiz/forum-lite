import { eq } from "drizzle-orm";
import { schema, type DB } from "../db";
import type { Bindings } from "../types";
import { addCloudflareSuppression } from "./email";

export function normalizeEmailAddress(email: string): string {
  return email.trim().toLowerCase();
}

export async function isEmailSuppressed(db: DB, email: string): Promise<boolean> {
  const normalized = normalizeEmailAddress(email);
  const row = await db.query.emailSuppressions.findFirst({
    where: eq(schema.emailSuppressions.email, normalized),
    columns: { email: true },
  });
  return Boolean(row);
}

export async function recordEmailSuppression(
  db: DB,
  env: Bindings,
  email: string,
  opts: {
    reason: string;
    source: string;
    details?: string;
    waitUntil?: (promise: Promise<unknown>) => void;
  },
): Promise<void> {
  const normalized = normalizeEmailAddress(email);
  if (!normalized) return;

  const now = new Date();
  const details = opts.details ? opts.details.slice(0, 2000) : null;
  const initialCfStatus = env.CF_ACCOUNT_ID && env.CF_EMAIL_API_TOKEN ? "pending" : "skipped";

  await db
    .insert(schema.emailSuppressions)
    .values({
      email: normalized,
      reason: opts.reason,
      source: opts.source,
      details,
      cfSuppressionStatus: initialCfStatus,
      cfSuppressedAt: null,
      cfSuppressionError: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.emailSuppressions.email,
      set: {
        reason: opts.reason,
        source: opts.source,
        details,
        cfSuppressionStatus: initialCfStatus,
        cfSuppressionError: null,
        updatedAt: now,
      },
    });

  await db
    .update(schema.users)
    .set({ emailSuppressedAt: now, emailSuppressionReason: opts.reason })
    .where(eq(schema.users.email, normalized));

  await db.insert(schema.activityLog).values({
    type: "email_bounce",
    summary: `Suppressed ${normalized} (${opts.reason}) via ${opts.source}`,
    createdAt: now,
  });

  const promise = addCloudflareSuppression(env, normalized)
    .then(async (result) => {
      const doneAt = new Date();
      await db
        .update(schema.emailSuppressions)
        .set({
          cfSuppressionStatus: result.ok ? "synced" : result.skipped ? "skipped" : "error",
          cfSuppressedAt: result.ok ? doneAt : null,
          cfSuppressionError: result.error?.slice(0, 1000) ?? null,
          updatedAt: doneAt,
        })
        .where(eq(schema.emailSuppressions.email, normalized));
    })
    .catch(async (error) => {
      const doneAt = new Date();
      await db
        .update(schema.emailSuppressions)
        .set({
          cfSuppressionStatus: "error",
          cfSuppressionError: error instanceof Error ? error.message.slice(0, 1000) : "Cloudflare suppression sync failed",
          updatedAt: doneAt,
        })
        .where(eq(schema.emailSuppressions.email, normalized));
    });
  if (opts.waitUntil) opts.waitUntil(promise);
  else await promise;
}
